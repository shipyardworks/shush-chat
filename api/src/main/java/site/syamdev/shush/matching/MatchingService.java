package site.syamdev.shush.matching;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import site.syamdev.shush.common.ApiException;
import site.syamdev.shush.conversation.Conversation;
import site.syamdev.shush.conversation.ConversationService;
import site.syamdev.shush.realtime.BackplanePublisher;
import site.syamdev.shush.realtime.ServerFrame;
import site.syamdev.shush.social.SocialGraph;
import site.syamdev.shush.user.InterestService;
import site.syamdev.shush.user.User;
import site.syamdev.shush.user.UserRepository;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.Collectors;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Pairs waiting users, honestly.
 *
 * <p>The patience dial is a speed-versus-quality trade the product states out loud: five
 * seconds means "try for a shared interest, then give me anyone", and zero means "only ever
 * someone who actually shares one". The conversation header then says which of the two it was,
 * because a random match presented as an interest match is a small lie the user will notice
 * the moment they start talking (pre-plan.md 3, steps 4-5).
 */
@Service
public class MatchingService {

    private static final Logger log = LoggerFactory.getLogger(MatchingService.class);
    private static final int FALLBACK_CANDIDATES = 20;

    private final WaitPool pool;
    private final WaitingIndex index;
    private final ConversationService conversations;
    private final SocialGraph social;
    private final InterestService interests;
    private final UserRepository users;
    private final BackplanePublisher backplane;
    private final Clock clock;
    private final Counter matchedOnInterests;
    private final Counter matchedAtRandom;

    MatchingService(WaitPool pool, WaitingIndex index, ConversationService conversations,
                    SocialGraph social, InterestService interests, UserRepository users,
                    BackplanePublisher backplane, Clock clock, MeterRegistry meters) {
        this.pool = pool;
        this.index = index;
        this.conversations = conversations;
        this.social = social;
        this.interests = interests;
        this.users = users;
        this.backplane = backplane;
        this.clock = clock;
        this.matchedOnInterests = Counter.builder("shush.matches").tag("kind", "interests")
                .description("conversations opened by matching").register(meters);
        this.matchedAtRandom = Counter.builder("shush.matches").tag("kind", "random")
                .description("conversations opened by matching").register(meters);
    }

    /**
     * Joins the pool and tries immediately, because the common case is that somebody is already
     * waiting and there is no reason to make either of them sit through a tick.
     */
    public Optional<Match> find(UUID userId, List<Short> interestIds, int patienceSeconds) {
        if (interestIds == null || interestIds.isEmpty()) {
            throw ApiException.badRequest("no_interests", "pick at least one interest first");
        }
        if (patienceSeconds != 0 && patienceSeconds != 5 && patienceSeconds != 10 && patienceSeconds != 30) {
            throw ApiException.badRequest("invalid_patience", "patience is 5, 10, 30, or 0 for no limit");
        }

        interests.recordSelection(userId, interestIds);

        WaitingUser waiting = new WaitingUser(userId, interestIds, patienceSeconds, clock.instant());
        pool.enqueue(waiting);
        try {
            index.index(waiting);
        } catch (IOException | RuntimeException searchUnavailable) {
            log.warn("could not index a waiting user; interest matching is degraded", searchUnavailable);
        }
        return attempt(waiting);
    }

    public void cancel(UUID userId) {
        pool.remove(userId);
        index.remove(userId);
    }

    /**
     * One attempt for one waiting user. Called on arrival and again on every tick, so it must be
     * safe to lose: a failed claim simply means somebody else got there first.
     */
    public Optional<Match> attempt(WaitingUser waiting) {
        if (!pool.isWaiting(waiting.userId())) {
            return Optional.empty();
        }

        Optional<Match> onInterests = matchOnInterests(waiting);
        if (onInterests.isPresent()) {
            return onInterests;
        }
        if (waiting.patienceExpired(clock.instant())) {
            // The dial said "then give me anyone", and it meant it.
            return matchAtRandom(waiting);
        }
        return Optional.empty();
    }

    private Optional<Match> matchOnInterests(WaitingUser waiting) {
        Set<UUID> excluded = excludedFor(waiting.userId());
        WaitingIndex.Candidate candidate;
        try {
            candidate = index.bestMatchFor(waiting, excluded).orElse(null);
        } catch (IOException | RuntimeException searchUnavailable) {
            log.warn("interest matching is unavailable; falling back to patience only", searchUnavailable);
            return Optional.empty();
        }
        if (candidate == null) {
            return Optional.empty();
        }

        List<Short> shared = new ArrayList<>(new LinkedHashSet<>(waiting.interestIds()));
        shared.retainAll(candidate.interestIds());
        if (shared.isEmpty()) {
            return Optional.empty();
        }
        return pairUp(waiting.userId(), candidate.userId(), shared);
    }

    private Optional<Match> matchAtRandom(WaitingUser waiting) {
        Set<UUID> excluded = excludedFor(waiting.userId());
        for (UUID candidateId : pool.longestWaiting(FALLBACK_CANDIDATES)) {
            if (candidateId.equals(waiting.userId()) || excluded.contains(candidateId)) {
                continue;
            }
            Optional<Match> match = pairUp(waiting.userId(), candidateId, null);
            if (match.isPresent()) {
                return match;
            }
        }
        return Optional.empty();
    }

    /**
     * @param sharedInterests null when the patience window ran out and this is a random match --
     *                        which is recorded as {@code matched_on = null} and shown as such
     */
    private Optional<Match> pairUp(UUID first, UUID second, List<Short> sharedInterests) {
        // The one place that must be atomic. Losing here is normal and costs nothing: the
        // caller stays in the pool and tries again on the next tick.
        if (!pool.claimBoth(first, second)) {
            return Optional.empty();
        }

        index.remove(first);
        index.remove(second);
        pool.remove(first);
        pool.remove(second);

        Conversation conversation = conversations.createMatched(first, second, sharedInterests);
        Match match = new Match(conversation.getId(), first, second, sharedInterests,
                clock.instant());

        if (sharedInterests == null) {
            matchedAtRandom.increment();
        } else {
            matchedOnInterests.increment();
        }

        announce(match);
        return Optional.of(match);
    }

    private void announce(Match match) {
        // Both names in one lookup. The client needs the other person's name to head the
        // conversation with, and "A stranger" is not a name -- it is the app refusing to say.
        Map<UUID, String> names = users.findAllById(
                        List.of(match.firstUserId(), match.secondUserId())).stream()
                .collect(Collectors.toMap(User::getId, User::getDisplayName));

        List.of(match.firstUserId(), match.secondUserId()).forEach(userId -> {
            UUID otherId = userId.equals(match.firstUserId())
                    ? match.secondUserId()
                    : match.firstUserId();
            backplane.publish(userId, new ServerFrame.Matched(
                    match.conversationId(),
                    otherId,
                    names.get(otherId),
                    match.sharedInterestIds(),
                    match.sharedInterestIds() == null));
        });
    }

    private Set<UUID> excludedFor(UUID userId) {
        Set<UUID> excluded = new LinkedHashSet<>(social.blockedEitherWay(userId));
        excluded.addAll(social.friendIdsOf(userId));
        return excluded;
    }

    /** @param sharedInterestIds null for a random match */
    public record Match(UUID conversationId, UUID firstUserId, UUID secondUserId,
                        List<Short> sharedInterestIds, Instant matchedAt) {
    }
}

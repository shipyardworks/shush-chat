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
    private final Counter gaveUp;

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
        this.gaveUp = Counter.builder("shush.matches.abandoned")
                .description("searches ended because the patience window ran out with nobody there")
                .register(meters);
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
            RandomAttempt atRandom = matchAtRandom(waiting);
            if (atRandom.match().isPresent()) {
                return atRandom.match();
            }
            // Only when there was genuinely nobody. Two matchers can expire in the same
            // instant and reach for each other, and exactly one of them loses that claim --
            // "nobody is around" is the wrong thing to tell the loser when the pool was full
            // of people a millisecond ago. It waits for the next tick instead, half a second
            // later, and gives up then if the pool really is empty.
            //
            // The other half of the same race: we may have been the one claimed, in which
            // case a `matched` frame is already on its way and we are no longer waiting.
            if (!atRandom.sawSomeone() && pool.isWaiting(waiting.userId())) {
                giveUp(waiting.userId());
            }
        }
        return Optional.empty();
    }

    /**
     * Five seconds means five seconds, even when the answer is nobody.
     *
     * <p>The window used to govern only *how* we matched -- after it elapsed we stopped holding
     * out for a shared interest and took anyone. With nobody at all in the pool that second
     * branch found nothing either, and the searcher simply stayed in it: the button span "Still
     * looking" indefinitely against a dial that had promised an answer in five seconds. A
     * patience setting the product cannot honour is worse than not offering one, so the search
     * ends and the person is told, which also puts the choice back in their hands -- press it
     * again, pick differently, or wait it out with "Forever", which is the one setting that
     * genuinely never gives up.
     */
    private void giveUp(UUID userId) {
        cancel(userId);
        gaveUp.increment();
        backplane.publish(userId, new ServerFrame.NoMatch());
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

    private RandomAttempt matchAtRandom(WaitingUser waiting) {
        Set<UUID> excluded = excludedFor(waiting.userId());
        boolean sawSomeone = false;
        for (UUID candidateId : pool.longestWaiting(FALLBACK_CANDIDATES)) {
            if (candidateId.equals(waiting.userId()) || excluded.contains(candidateId)) {
                continue;
            }
            sawSomeone = true;
            Optional<Match> match = pairUp(waiting.userId(), candidateId, null);
            if (match.isPresent()) {
                return new RandomAttempt(match, true);
            }
        }
        return new RandomAttempt(Optional.empty(), sawSomeone);
    }

    /**
     * @param sawSomeone whether anyone was there to try for at all, which is a different
     *                   thing from having matched: losing a claim race means somebody was
     *                   there and somebody else got them
     */
    private record RandomAttempt(Optional<Match> match, boolean sawSomeone) {}

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

    /**
     * Blocks only. Friends are candidates like anybody else.
     *
     * <p>They used to be excluded, on the reading that somebody already in your friends list is
     * someone you can message directly. The cost of that was not obvious until the pool was
     * small: keep two or three people and the matcher starts refusing the only people who are
     * ever around, with a screen that says nothing about why -- and once two accounts had kept
     * each other, no amount of searching could ever put them together again. Being matched with
     * a friend is a worse outcome than a stranger and a much better one than nobody, so the
     * exclusion is gone and the conversation simply does not offer to keep someone already
     * kept.
     */
    private Set<UUID> excludedFor(UUID userId) {
        return new LinkedHashSet<>(social.blockedEitherWay(userId));
    }

    /** @param sharedInterestIds null for a random match */
    public record Match(UUID conversationId, UUID firstUserId, UUID secondUserId,
                        List<Short> sharedInterestIds, Instant matchedAt) {
    }
}

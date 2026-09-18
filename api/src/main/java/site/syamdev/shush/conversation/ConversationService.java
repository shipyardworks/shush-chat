package site.syamdev.shush.conversation;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import site.syamdev.shush.common.AfterCommit;
import site.syamdev.shush.common.ApiException;
import site.syamdev.shush.realtime.BackplanePublisher;
import site.syamdev.shush.realtime.ServerFrame;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Collection;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ConversationService {

    private final ConversationRepository conversations;
    private final ConversationParticipantRepository participants;
    private final BackplanePublisher backplane;
    private final Clock clock;
    private final Duration purgeAfterEnding;

    ConversationService(ConversationRepository conversations,
                        ConversationParticipantRepository participants,
                        BackplanePublisher backplane,
                        Clock clock,
                        @Value("${shush.conversation.purge-after-ending}") Duration purgeAfterEnding) {
        this.conversations = conversations;
        this.participants = participants;
        this.backplane = backplane;
        this.clock = clock;
        this.purgeAfterEnding = purgeAfterEnding;
    }

    @Transactional
    public Conversation create(Conversation.Kind kind, UUID firstUserId, UUID secondUserId) {
        if (firstUserId.equals(secondUserId)) {
            throw ApiException.badRequest("self_conversation", "a conversation needs two distinct users");
        }
        Conversation conversation = conversations.save(
                new Conversation(UUID.randomUUID(), kind, clock.instant()));
        participants.saveAll(List.of(
                new ConversationParticipant(conversation.getId(), firstUserId),
                new ConversationParticipant(conversation.getId(), secondUserId)));
        return conversation;
    }

    /**
     * Opens the conversation a match produced.
     *
     * @param sharedInterestIds null for a random match, which is stored as {@code matched_on
     *                          = null} and shown to both people as such -- the header says
     *                          whether this was an interest match or a random one, because
     *                          presenting one as the other is a small lie they will notice
     */
    @Transactional
    public Conversation createMatched(UUID firstUserId, UUID secondUserId,
                                      List<Short> sharedInterestIds) {
        endOpenStrangerConversations(firstUserId);
        endOpenStrangerConversations(secondUserId);
        Conversation conversation = create(Conversation.Kind.STRANGER, firstUserId, secondUserId);
        conversation.matchedOn(sharedInterestIds == null || sharedInterestIds.isEmpty()
                ? null
                : sharedInterestIds.stream().mapToInt(Short::intValue).toArray());
        // Until somebody asks to keep it, this conversation is on the clock.
        conversation.scheduleForPurge(clock.instant().plus(purgeAfterEnding));
        return conversation;
    }

    /**
     * One stranger conversation at a time (pre-plan.md 3): walking into a new one walks out of
     * whatever was still open, exactly as if Leave had been pressed. Without this every match
     * left the previous one live, so the history list filled with threads that still took
     * messages -- one screen could send into a conversation the other had long since moved on
     * from. Friend conversations are kept, not active, and are never touched here.
     */
    private void endOpenStrangerConversations(UUID userId) {
        Instant now = clock.instant();
        for (UUID conversationId : conversations.findOpenStrangerConversationIds(userId)) {
            Conversation open = require(conversationId);
            // Two people rematched share their old thread; the first pass already ended it.
            if (open.getState() != Conversation.State.ACTIVE) {
                continue;
            }
            participants.markLeft(conversationId, userId, now);
            open.end(now, now.plus(purgeAfterEnding));
            List<UUID> everyone = participantIds(conversationId);
            ServerFrame.Left left = new ServerFrame.Left(conversationId, userId);
            AfterCommit.run(() -> backplane.publish(everyone, left));
        }
    }

    /** Somebody wants this kept, so stop counting down to its deletion. */
    @Transactional
    public void cancelPurge(UUID conversationId) {
        require(conversationId).scheduleForPurge(null);
    }

    @Transactional
    public void schedulePurge(UUID conversationId) {
        require(conversationId).scheduleForPurge(clock.instant().plus(purgeAfterEnding));
    }

    /** Accepted: the conversation and its history survive, and either of you can pick it up. */
    @Transactional
    public void keep(UUID conversationId) {
        require(conversationId).keep();
    }

    @Transactional(readOnly = true)
    public Conversation require(UUID conversationId) {
        return conversations.findById(conversationId)
                .orElseThrow(() -> ApiException.notFound("unknown_conversation", "no such conversation"));
    }

    /**
     * Refuses anything but talking in a conversation that is still open.
     *
     * <p>Once either person leaves, a stranger conversation is over -- which has to mean it is
     * over. Being able to keep sending into it makes "leave" a suggestion, and on a service
     * whose whole promise is that a stranger conversation ends when somebody ends it, that is
     * not a cosmetic gap. Asking to keep them is still allowed; that is the one thing left.
     */
    @Transactional(readOnly = true)
    public void requireActive(UUID conversationId) {
        Conversation conversation = conversations.findById(conversationId)
                .orElseThrow(() -> ApiException.notFound("unknown_conversation", "no such conversation"));
        if (conversation.getState() == Conversation.State.ENDED) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "conversation_ended",
                    "this conversation is over");
        }
    }

    @Transactional(readOnly = true)
    public void requireParticipant(UUID conversationId, UUID userId) {
        if (!participants.existsByConversationIdAndUserId(conversationId, userId)) {
            // Deliberately not "no such conversation": membership and existence are the same
            // answer to a caller who is not in it.
            throw ApiException.forbidden("not_a_participant", "you are not in this conversation");
        }
    }

    /**
     * Every conversation this person has had, newest first. See the query for why one call.
     *
     * <p>Repeat matches with the same person collapse into one row once a {@code friend} row
     * exists among them -- accepting a request only ever kept the one conversation it came from,
     * so without this, earlier matches with the same person stayed separate forever. A peer with
     * no {@code friend} row is left exactly as returned: never-kept strangers stay separate.
     */
    @Transactional(readOnly = true)
    public List<ConversationParticipantRepository.ConversationSummaryRow> historyFor(UUID userId) {
        List<ConversationParticipantRepository.ConversationSummaryRow> rows =
                participants.findConversationSummaries(userId);

        Set<UUID> peersToMerge = rows.stream()
                .collect(Collectors.groupingBy(ConversationParticipantRepository.ConversationSummaryRow::getPeerId))
                .values().stream()
                .filter(group -> group.size() > 1
                        && group.stream().anyMatch(row -> "friend".equals(row.getKind())))
                .map(group -> group.get(0).getPeerId())
                .collect(Collectors.toSet());

        if (peersToMerge.isEmpty()) {
            return rows;
        }

        Map<UUID, List<ConversationParticipantRepository.ConversationSummaryRow>> byPeer = rows.stream()
                .filter(row -> peersToMerge.contains(row.getPeerId()))
                .collect(Collectors.groupingBy(ConversationParticipantRepository.ConversationSummaryRow::getPeerId));

        List<ConversationParticipantRepository.ConversationSummaryRow> result = new ArrayList<>();
        Set<UUID> alreadyMerged = new HashSet<>();
        // Substituting only at each peer's first occurrence in the already-sorted list keeps
        // every row's position -- the merged row lands where that peer's latest activity sorted it.
        for (ConversationParticipantRepository.ConversationSummaryRow row : rows) {
            if (!peersToMerge.contains(row.getPeerId())) {
                result.add(row);
                continue;
            }
            if (!alreadyMerged.add(row.getPeerId())) {
                continue;
            }
            List<ConversationParticipantRepository.ConversationSummaryRow> group = byPeer.get(row.getPeerId());
            ConversationParticipantRepository.ConversationSummaryRow canonical = group.stream()
                    .filter(candidate -> "friend".equals(candidate.getKind()))
                    .findFirst()
                    .orElseThrow();
            int unread = group.stream()
                    .mapToInt(ConversationParticipantRepository.ConversationSummaryRow::getUnreadCount)
                    .sum();
            result.add(new MergedSummaryRow(canonical.getConversationId(), canonical.getKind(),
                    canonical.getState(), unread, canonical.getPeerId(), canonical.getPeerName(),
                    row.getLastBody(), row.getLastKind(), row.getLastSenderId(), row.getLastAt()));
        }
        return result;
    }

    /**
     * The other conversation ids this person shares with {@code conversationId}'s peer -- used
     * to pull in messages from earlier, separate matches once they are friends (see
     * {@link #historyFor}). Empty, not an error, when there is only ever the one.
     */
    @Transactional(readOnly = true)
    public List<UUID> siblingConversationIds(UUID conversationId, UUID callerId) {
        List<ConversationParticipant> rows = participants.findByConversationId(conversationId);
        UUID peerId = rows.stream()
                .map(ConversationParticipant::getUserId)
                .filter(userId -> !userId.equals(callerId))
                .findFirst()
                .orElse(null);
        if (peerId == null) {
            return List.of();
        }
        return participants.findConversationIdsBetween(callerId, peerId);
    }

    private record MergedSummaryRow(UUID conversationId, String kind, String state, int unreadCount,
                                    UUID peerId, String peerName, String lastBody, String lastKind,
                                    UUID lastSenderId, Instant lastAt)
            implements ConversationParticipantRepository.ConversationSummaryRow {

        @Override
        public UUID getConversationId() {
            return conversationId;
        }

        @Override
        public String getKind() {
            return kind;
        }

        @Override
        public String getState() {
            return state;
        }

        @Override
        public int getUnreadCount() {
            return unreadCount;
        }

        @Override
        public UUID getPeerId() {
            return peerId;
        }

        @Override
        public String getPeerName() {
            return peerName;
        }

        @Override
        public String getLastBody() {
            return lastBody;
        }

        @Override
        public String getLastKind() {
            return lastKind;
        }

        @Override
        public UUID getLastSenderId() {
            return lastSenderId;
        }

        @Override
        public Instant getLastAt() {
            return lastAt;
        }
    }

    /**
     * Unread counts for several conversations at once, keyed by conversation.
     *
     * <p>The friends list needs one of these per friend and must not do one query per friend
     * to get them (pre-plan.md, step 8: the list shows how many messages are waiting from
     * each person).
     */
    @Transactional(readOnly = true)
    public Map<UUID, Integer> unreadCountsFor(UUID userId, Collection<UUID> conversationIds) {
        if (conversationIds.isEmpty()) {
            return Map.of();
        }
        return participants.findByUserIdAndConversationIdIn(userId, conversationIds).stream()
                .collect(Collectors.toMap(ConversationParticipant::getConversationId,
                        ConversationParticipant::getUnreadCount));
    }

    public List<UUID> participantIds(UUID conversationId) {
        return participants.findByConversationId(conversationId).stream()
                .map(ConversationParticipant::getUserId)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<Counterpart> activeCounterparts(UUID userId) {
        return participants.findActiveCounterparts(userId).stream()
                .map(row -> new Counterpart(row.getConversationId(), row.getUserId()))
                .toList();
    }

    /**
     * @return true if the cursor actually moved. A repeated or stale read is not an error and
     *         is simply not announced -- read receipts that fire on every scroll are noise.
     */
    @Transactional
    public boolean markRead(UUID conversationId, UUID userId, long seq) {
        return participants.advanceReadCursor(conversationId, userId, seq) > 0;
    }

    /**
     * Deliberately leaving, as distinct from losing connection.
     *
     * <p>The conversation ends and is scheduled for purge: a stranger conversation nobody wanted
     * to keep does not survive (pre-plan.md 6). Phase 6 clears {@code purgeAfter} when a friend
     * request exists, which is what "conversations only survive if at least one person wanted
     * them to" means in practice.
     *
     * @return true if this call ended it, false if it had already ended
     */
    @Transactional
    public boolean leave(UUID conversationId, UUID userId) {
        Instant now = clock.instant();
        if (participants.markLeft(conversationId, userId, now) == 0) {
            return false;
        }
        Conversation conversation = conversations.findById(conversationId)
                .orElseThrow(() -> ApiException.notFound("unknown_conversation", "no such conversation"));
        if (conversation.getState() != Conversation.State.ACTIVE) {
            return false;
        }
        conversation.end(now, now.plus(purgeAfterEnding));
        return true;
    }

    @Transactional(readOnly = true)
    public View view(UUID conversationId, UUID callerId) {
        requireParticipant(conversationId, callerId);
        Conversation conversation = conversations.findById(conversationId)
                .orElseThrow(() -> ApiException.notFound("unknown_conversation", "no such conversation"));

        List<ConversationParticipant> rows = participants.findByConversationId(conversationId);
        ConversationParticipant me = rows.stream()
                .filter(row -> row.getUserId().equals(callerId))
                .findFirst()
                .orElseThrow(() -> ApiException.forbidden("not_a_participant",
                        "you are not in this conversation"));

        return new View(conversation, me, rows.stream()
                .filter(row -> !row.getUserId().equals(callerId))
                .toList());
    }

    public record Counterpart(UUID conversationId, UUID userId) {}

    public record View(Conversation conversation,
                       ConversationParticipant me,
                       List<ConversationParticipant> others) {
    }
}

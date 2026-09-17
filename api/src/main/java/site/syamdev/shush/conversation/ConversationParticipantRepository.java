package site.syamdev.shush.conversation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ConversationParticipantRepository
        extends JpaRepository<ConversationParticipant, ConversationParticipant.Key> {

    List<ConversationParticipant> findByConversationId(UUID conversationId);

    /**
     * One query for a whole friends list. The count is a maintained column, never a COUNT(*)
     * at read time -- that is the query that collapses first as conversations grow, and a
     * friends list runs it once per friend.
     */
    List<ConversationParticipant> findByUserIdAndConversationIdIn(UUID userId,
                                                                 Collection<UUID> conversationIds);

    boolean existsByConversationIdAndUserId(UUID conversationId, UUID userId);

    Optional<ConversationParticipant> findByConversationIdAndUserId(UUID conversationId, UUID userId);

    @Modifying
    @Query("""
            update ConversationParticipant p
            set p.unreadCount = p.unreadCount + 1
            where p.conversationId = :conversationId and p.userId <> :senderId
            """)
    int incrementUnreadForRecipients(@Param("conversationId") UUID conversationId,
                                     @Param("senderId") UUID senderId);

    /**
     * The read cursor only ever moves forward. Two devices reading the same conversation at
     * once would otherwise let the slower one drag it backwards and resurrect read messages.
     */
    @Modifying
    @Query("""
            update ConversationParticipant p
            set p.readCursorSeq = :seq, p.unreadCount = 0
            where p.conversationId = :conversationId and p.userId = :userId and p.readCursorSeq < :seq
            """)
    int advanceReadCursor(@Param("conversationId") UUID conversationId,
                          @Param("userId") UUID userId,
                          @Param("seq") long seq);

    @Modifying
    @Query("""
            update ConversationParticipant p
            set p.leftAt = :leftAt
            where p.conversationId = :conversationId and p.userId = :userId and p.leftAt is null
            """)
    int markLeft(@Param("conversationId") UUID conversationId,
                 @Param("userId") UUID userId,
                 @Param("leftAt") Instant leftAt);

    /**
     * The other person in each of this user's still-open conversations. Used to tell exactly
     * the people who would notice that someone came online or went away.
     */
    @Query("""
            select p2.conversationId as conversationId, p2.userId as userId
            from ConversationParticipant p1
            join Conversation c on c.id = p1.conversationId
            join ConversationParticipant p2 on p2.conversationId = c.id
            where p1.userId = :userId
              and p2.userId <> :userId
              and c.state = 'active'
              and p1.leftAt is null
            """)
    List<CounterpartRow> findActiveCounterparts(@Param("userId") UUID userId);

    /**
     * Every conversation this person is in, newest activity first, with the other person and a
     * preview of the last thing said.
     *
     * <p>One query, and a lateral join for the preview rather than a message table scan per
     * row. A history list that costs N+1 queries is the one that stops working first, and this
     * is the screen people open every time.
     */
    @Query(value = """
            select c.id                                   as conversationId,
                   c.kind                                 as kind,
                   c.state                                as state,
                   p.unread_count                         as unreadCount,
                   other.user_id                          as peerId,
                   u.display_name                         as peerName,
                   last.body                              as lastBody,
                   last.kind                              as lastKind,
                   last.sender_id                         as lastSenderId,
                   last.created_at                        as lastAt,
                   coalesce(last.created_at, c.created_at) as activityAt
            from conversation_participants p
            join conversations c              on c.id = p.conversation_id
            join conversation_participants other
                                              on other.conversation_id = c.id
                                             and other.user_id <> p.user_id
            join users u                      on u.id = other.user_id
            left join lateral (
                select m.body, m.kind, m.sender_id, m.created_at
                from messages m
                where m.conversation_id = c.id and m.deleted_at is null
                order by m.seq desc
                limit 1
            ) last on true
            where p.user_id = :userId
              -- Hidden, not deleted: nothing under conversations/messages changes, so an unblock
              -- feature later has everything still there to restore into view.
              and not exists (
                  select 1 from blocks b
                  where (b.blocker_id = p.user_id and b.blocked_id = other.user_id)
                     or (b.blocker_id = other.user_id and b.blocked_id = p.user_id)
              )
            order by coalesce(last.created_at, c.created_at) desc
            """, nativeQuery = true)
    List<ConversationSummaryRow> findConversationSummaries(@Param("userId") UUID userId);

    /** Every conversation id two people have ever shared. Folds repeat matches into one thread
     *  once they are friends -- see ConversationService#historyFor. */
    @Query(value = """
            select p1.conversation_id
            from conversation_participants p1
            join conversation_participants p2
                              on p2.conversation_id = p1.conversation_id
                             and p2.user_id = :userB
            where p1.user_id = :userA
            """, nativeQuery = true)
    List<UUID> findConversationIdsBetween(@Param("userA") UUID userA, @Param("userB") UUID userB);

    interface ConversationSummaryRow {
        UUID getConversationId();

        String getKind();

        String getState();

        int getUnreadCount();

        UUID getPeerId();

        String getPeerName();

        String getLastBody();

        String getLastKind();

        UUID getLastSenderId();

        Instant getLastAt();
    }

    interface CounterpartRow {
        UUID getConversationId();

        UUID getUserId();
    }
}

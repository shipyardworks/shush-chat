package site.syamdev.shush.conversation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ConversationRepository extends JpaRepository<Conversation, UUID> {

    /**
     * Claims the next sequence number for a conversation. The row lock this takes is what
     * serialises concurrent senders, so {@code seq} is dense and gap-free -- and it is why
     * the bump and the message insert must share one transaction.
     */
    @Query(value = "update conversations set last_seq = last_seq + 1 where id = :id returning last_seq",
            nativeQuery = true)
    Long claimNextSeq(@Param("id") UUID conversationId);

    @Query(value = """
            select c.id
            from conversations c
            join conversation_participants p on p.conversation_id = c.id
            where p.user_id = :userId and c.state = 'active' and c.kind = 'stranger'
            """, nativeQuery = true)
    List<UUID> findOpenStrangerConversationIds(@Param("userId") UUID userId);
}

package site.syamdev.shush.realtime;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import site.syamdev.shush.message.Message;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = ServerFrame.Ack.class, name = "ack"),
        @JsonSubTypes.Type(value = ServerFrame.MessageFrame.class, name = "message"),
        @JsonSubTypes.Type(value = ServerFrame.Error.class, name = "error"),
        @JsonSubTypes.Type(value = ServerFrame.Hello.class, name = "hello"),
        @JsonSubTypes.Type(value = ServerFrame.Presence.class, name = "presence"),
        @JsonSubTypes.Type(value = ServerFrame.Typing.class, name = "typing"),
        @JsonSubTypes.Type(value = ServerFrame.ReadReceipt.class, name = "read"),
        @JsonSubTypes.Type(value = ServerFrame.Left.class, name = "left"),
        @JsonSubTypes.Type(value = ServerFrame.Matched.class, name = "matched"),
        @JsonSubTypes.Type(value = ServerFrame.NoMatch.class, name = "noMatch"),
        @JsonSubTypes.Type(value = ServerFrame.FriendRequested.class, name = "friendRequested"),
        @JsonSubTypes.Type(value = ServerFrame.FriendRequestAccepted.class, name = "friendRequestAccepted"),
        @JsonSubTypes.Type(value = ServerFrame.FriendshipEnded.class, name = "friendshipEnded"),
        @JsonSubTypes.Type(value = ServerFrame.Reaction.class, name = "reaction"),
        @JsonSubTypes.Type(value = ServerFrame.Deleted.class, name = "deleted")
})
public sealed interface ServerFrame {

    /**
     * Two-stage on purpose. {@code sent} means the log accepted it and it will not be lost;
     * {@code delivered} means it is committed to Postgres with a sequence number, which is the
     * first moment anything can say where it sits in the conversation's order.
     *
     * @param seq null on {@code sent} -- no sequence number exists until the writer assigns one
     */
    record Ack(UUID clientMsgId, String status, UUID messageId, Long seq, boolean duplicate)
            implements ServerFrame {

        static Ack sent(UUID clientMsgId) {
            return new Ack(clientMsgId, "sent", null, null, false);
        }

        static Ack delivered(Message message, boolean duplicate) {
            return new Ack(message.getClientMsgId(), "delivered", message.getId(),
                    message.getSeq(), duplicate);
        }
    }

    record MessageFrame(UUID conversationId, UUID messageId, long seq, UUID senderId,
                        String kind, String body, String mediaKey, UUID clientMsgId,
                        Instant createdAt, Long replyToSeq, boolean deleted)
            implements ServerFrame {

        static MessageFrame of(Message message) {
            return new MessageFrame(message.getConversationId(), message.getId(), message.getSeq(),
                    message.getSenderId(), message.getKind().wireValue(), message.getBody(),
                    message.getMediaKey(), message.getClientMsgId(), message.getCreatedAt(),
                    message.getReplyToSeq(), message.isDeleted());
        }
    }

    /**
     * Somebody reacted, or took their reaction back -- {@code emoji} is null for the latter.
     * One reaction per person per message, so this replaces rather than adds.
     */
    record Reaction(UUID conversationId, long seq, UUID userId, String emoji)
            implements ServerFrame {}

    /**
     * A message was deleted for everyone. Sent to both sides, because "deleted for everyone"
     * that only the deleter sees is not what it says.
     */
    record Deleted(UUID conversationId, long seq, UUID byUserId) implements ServerFrame {}

    record Error(String code, String message, UUID clientMsgId) implements ServerFrame {}

    /**
     * Sent once, immediately after the socket opens.
     *
     * <p>{@code nodeId} is diagnostic only -- nothing addresses a node, and a client that
     * reconnects will usually land somewhere else. It exists so an operator, and the load
     * harness, can tell that a run genuinely spanned replicas instead of quietly proving
     * nothing on one.
     */
    record Hello(UUID userId, String nodeId) implements ServerFrame {}

    /**
     * Someone's connection came or went. Distinct from {@link Left}: going offline is not
     * leaving, the conversation stays open, and anything sent meanwhile is waiting when they
     * return (pre-plan.md 3).
     *
     * @param lastSeenAt only meaningful when {@code online} is false
     */
    record Presence(UUID conversationId, UUID userId, boolean online, Instant lastSeenAt)
            implements ServerFrame {
    }

    record Typing(UUID conversationId, UUID userId) implements ServerFrame {}

    /** @param seq the highest sequence number that user has read */
    record ReadReceipt(UUID conversationId, UUID userId, long seq) implements ServerFrame {}

    /** Deliberately gone. The conversation is over; this is not a reconnect. */
    record Left(UUID conversationId, UUID userId) implements ServerFrame {}

    /**
     * @param sharedInterestIds null when the patience window ran out
     * @param randomMatch       stated plainly, because the conversation header says which of the
     *                          two this was and presenting a random match as an interest match
     *                          is a lie the user notices as soon as they start talking
     */
    record Matched(UUID conversationId, UUID withUserId, String withDisplayName,
                   List<Short> sharedInterestIds,
                   boolean randomMatch) implements ServerFrame {
    }

    /**
     * The patience window ran out and there was nobody to pair with -- not even at random.
     *
     * <p>Carries nothing: there is no state to report, only the fact that the search the
     * client is drawing is over. Without it a five-second dial could leave somebody watching
     * "Still looking" for as long as they cared to, which makes the setting a lie.
     */
    record NoMatch() implements ServerFrame {}

    record FriendRequested(UUID conversationId, UUID requestId, UUID fromUserId) implements ServerFrame {}

    /**
     * Only acceptance is announced. A decline says nothing at all -- the sender simply never
     * hears back, which is the whole point of it being silent (pre-plan.md 6).
     */
    record FriendRequestAccepted(UUID conversationId, UUID requestId, UUID byUserId)
            implements ServerFrame {
    }

    /**
     * The friendship is over, told to the person who did not do it.
     *
     * <p>Sent for both ways it can end -- removed, or blocked -- and deliberately says only
     * that it ended. The server deletes the row either way, so this is the same fact the other
     * client would read from {@code GET /api/friends} on its next load; without it that list
     * went on showing a friend row for somebody who, in the blocking case, could no longer be
     * reached at all. Which of the two happened is not said, because "you have been blocked"
     * is not a thing this product tells anybody -- the same reason a declined request is
     * silent.
     */
    record FriendshipEnded(UUID withUserId) implements ServerFrame {}
}

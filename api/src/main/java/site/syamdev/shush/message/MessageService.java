package site.syamdev.shush.message;

import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import site.syamdev.shush.common.ApiException;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Phase 1 appends from the request path. Phase 2 moves the call behind Redpanda so the sole
 * caller becomes the chat-writer consumer; the sequencing and dedup rules do not change.
 */
@Service
public class MessageService {

    public static final int MAX_PAGE_SIZE = 100;
    static final int MAX_BODY_LENGTH = 4000;

    private final MessageWriter writer;
    private final MessageRepository messages;

    MessageService(MessageWriter writer, MessageRepository messages) {
        this.writer = writer;
        this.messages = messages;
    }

    /**
     * @return the persisted message, flagged as a duplicate when this {@code clientMsgId} had
     *         already been accepted for this sender in this conversation
     */
    public Append append(UUID conversationId, UUID senderId, UUID clientMsgId,
                         Message.Kind kind, String body, String mediaKey, Long replyToSeq) {
        validate(kind, body);
        try {
            return new Append(
                    writer.write(conversationId, senderId, clientMsgId, kind, body, mediaKey, replyToSeq),
                    false);
        } catch (DuplicateMessageException duplicate) {
            // The write rolled back, releasing its sequence number. The winner is committed.
            return new Append(existing(conversationId, senderId, clientMsgId), true);
        }
    }

    private static void validate(Message.Kind kind, String body) {
        if (kind == Message.Kind.TEXT && (body == null || body.isBlank())) {
            throw ApiException.badRequest("empty_body", "a text message needs a body");
        }
        if (body != null && body.length() > MAX_BODY_LENGTH) {
            throw ApiException.badRequest("body_too_long",
                    "a message body is limited to " + MAX_BODY_LENGTH + " characters");
        }
    }

    private Message existing(UUID conversationId, UUID senderId, UUID clientMsgId) {
        return messages.findByConversationIdAndSenderIdAndClientMsgId(conversationId, senderId, clientMsgId)
                .orElseThrow(() -> new IllegalStateException(
                        "dedup constraint rejected an insert but no committed row matches it"));
    }

    /**
     * One page of history, oldest-first within the page, walking backwards from {@code beforeSeq}.
     * Cursoring on {@code seq} rather than an offset keeps pagination stable while new messages
     * arrive underneath the reader.
     */
    @Transactional(readOnly = true)
    public Page history(UUID conversationId, Long beforeSeq, int limit) {
        int size = Math.clamp(limit, 1, MAX_PAGE_SIZE);
        long cursor = beforeSeq == null ? Long.MAX_VALUE : beforeSeq;

        List<Message> found = messages.findByConversationIdAndSeqLessThanOrderBySeqDesc(
                conversationId, cursor, Limit.of(size + 1));

        boolean more = found.size() > size;
        List<Message> window = (more ? found.subList(0, size) : found).stream()
                .sorted(Comparator.comparingLong(Message::getSeq))
                .toList();

        Long nextBefore = window.isEmpty() || !more ? null : window.getFirst().getSeq();
        return new Page(window, nextBefore);
    }

    /**
     * The most recent {@code limit} messages across several conversations with the same person,
     * merged into one timeline for a friendship that folds together repeat matches (see
     * ConversationService#historyFor). Each conversation's own {@code seq} and ordering guarantee
     * are untouched; this only interleaves already-ordered per-conversation pages by wall-clock
     * time for display.
     *
     * <p>No {@code before}/{@code after} paging across the set: nothing today scrolls back past
     * the first page of a freshly-opened thread, so a composite cross-conversation cursor isn't
     * worth inventing yet. Deeper scrollback still works, scoped to the single open conversation.
     */
    @Transactional(readOnly = true)
    public Page historyAcross(List<UUID> conversationIds, int limit) {
        int size = Math.clamp(limit, 1, MAX_PAGE_SIZE);
        List<Message> merged = conversationIds.stream()
                .flatMap(id -> history(id, null, size).messages().stream())
                .sorted(Comparator.comparing(Message::getCreatedAt))
                .toList();
        int from = Math.max(0, merged.size() - size);
        return new Page(merged.subList(from, merged.size()), null);
    }

    /**
     * Everything after {@code afterSeq}, oldest first -- what a client asks for when it
     * reconnects and needs the messages that arrived while it was gone (pre-plan.md 3: anything
     * sent while someone is away reaches them when they return, in the right order).
     */
    @Transactional(readOnly = true)
    public Page since(UUID conversationId, long afterSeq, int limit) {
        int size = Math.clamp(limit, 1, MAX_PAGE_SIZE);
        List<Message> found = messages.findByConversationIdAndSeqGreaterThanOrderBySeqAsc(
                conversationId, afterSeq, Limit.of(size + 1));

        boolean more = found.size() > size;
        List<Message> window = more ? found.subList(0, size) : found;
        Long nextAfter = more ? window.getLast().getSeq() : null;
        return new Page(List.copyOf(window), nextAfter);
    }

    public record Append(Message message, boolean duplicate) {}

    /**
     * @param nextCursor the cursor for the following page, or null when this page is the end.
     *                   For history it is a {@code before}; for resume it is an {@code after}.
     */
    public record Page(List<Message> messages, Long nextCursor) {}
}

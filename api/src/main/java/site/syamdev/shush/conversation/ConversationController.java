package site.syamdev.shush.conversation;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import site.syamdev.shush.common.ApiException;
import site.syamdev.shush.common.CurrentUser;
import site.syamdev.shush.message.Message;
import site.syamdev.shush.message.MessageService;

import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;
import java.util.Set;
import java.util.Map;
import site.syamdev.shush.message.MessageReaction;
import site.syamdev.shush.message.MessageInteractionService;
import java.util.UUID;

@RestController
@RequestMapping("/api/conversations")
class ConversationController {

    private final ConversationService conversations;
    private final MessageService messages;
    private final MessageInteractionService interactions;
    private final CurrentUser currentUser;

    ConversationController(ConversationService conversations, MessageService messages,
                           MessageInteractionService interactions, CurrentUser currentUser) {
        this.conversations = conversations;
        this.messages = messages;
        this.interactions = interactions;
        this.currentUser = currentUser;
    }

    /**
     * Everything you have ever talked in, friends or not.
     *
     * <p>pre-plan.md says a stranger conversation nobody kept does not survive its ending; the
     * owner asked for history of all of them, so the purge now only reaps conversations with
     * nothing in them. Recorded under Open Choices rather than quietly reversed.
     */
    @GetMapping
    List<ConversationSummary> history() {
        UUID callerId = currentUser.requireId();
        return conversations.historyFor(callerId).stream()
                .map(row -> new ConversationSummary(
                        row.getConversationId(),
                        row.getKind(),
                        row.getState(),
                        row.getUnreadCount(),
                        row.getPeerId(),
                        row.getPeerName(),
                        // The preview says what kind of thing it was rather than a media key,
                        // which is never logged and has no business on a list screen either.
                        "image".equals(row.getLastKind()) ? "Photo" : row.getLastBody(),
                        row.getLastSenderId() != null && row.getLastSenderId().equals(callerId),
                        row.getLastAt()))
                .toList();
    }

    /**
     * Unread counts come from the maintained counter, never from a {@code COUNT(*)} at read
     * time -- that is the query that collapses first as a conversation grows (plan.md 3.5).
     */
    @GetMapping("/{conversationId}")
    ConversationView conversation(@PathVariable UUID conversationId) {
        ConversationService.View view = conversations.view(conversationId, currentUser.requireId());
        return new ConversationView(
                view.conversation().getId(),
                view.conversation().getKind().wireValue(),
                view.conversation().getState().wireValue(),
                view.me().getUnreadCount(),
                view.me().getReadCursorSeq(),
                view.others().stream()
                        .map(other -> new ParticipantView(other.getUserId(), other.getReadCursorSeq(),
                                other.getLeftAt() != null))
                        .toList());
    }

    /**
     * Cursor-based history. {@code before} is a {@code seq}, not an offset, so a page stays
     * stable while messages keep arriving.
     */
    @GetMapping("/{conversationId}/messages")
    HistoryResponse history(@PathVariable UUID conversationId,
                            @RequestParam(required = false) Long before,
                            @RequestParam(required = false) Long after,
                            @RequestParam(defaultValue = "50") int limit) {
        UUID callerId = currentUser.requireId();
        conversations.requireParticipant(conversationId, callerId);

        if (before != null && after != null) {
            throw ApiException.badRequest("conflicting_cursors",
                    "pass either before or after, not both");
        }

        // `after` is the resume path -- a client that reconnects asks for what it missed, in
        // order. `before` is scrollback. They walk the same index in opposite directions. A
        // fresh open (neither cursor set) of a friend's thread additionally folds in any earlier,
        // separate conversations with the same person -- see ConversationService#historyFor.
        MessageService.Page page;
        if (after != null) {
            page = messages.since(conversationId, after, limit);
        } else if (before == null && conversations.require(conversationId).getKind() == Conversation.Kind.FRIEND) {
            List<UUID> siblingIds = conversations.siblingConversationIds(conversationId, callerId);
            page = siblingIds.size() > 1
                    ? messages.historyAcross(siblingIds, limit)
                    : messages.history(conversationId, null, limit);
        } else {
            page = messages.history(conversationId, before, limit);
        }

        List<UUID> ids = page.messages().stream().map(Message::getId).toList();
        // Two extra queries for the whole page rather than two per message.
        Set<UUID> hidden = interactions.hiddenFrom(callerId, ids);
        Map<UUID, List<MessageReaction>> reactions = interactions.reactionsFor(ids).stream()
                .collect(Collectors.groupingBy(MessageReaction::getMessageId));

        List<MessageView> view = page.messages().stream()
                // A message you hid is gone for you, and the page is simply shorter. Deliberately
                // not a placeholder: "delete for me" that leaves a visible hole is not deletion.
                .filter(message -> !hidden.contains(message.getId()))
                .map(message -> MessageView.of(message,
                        reactions.getOrDefault(message.getId(), List.of())))
                .toList();
        return after != null
                ? new HistoryResponse(view, null, page.nextCursor())
                : new HistoryResponse(view, page.nextCursor(), null);
    }

    record MessageView(UUID id, UUID conversationId, UUID senderId, long seq, String kind,
                       String body, String mediaKey, UUID clientMsgId, Instant createdAt,
                       Long replyToSeq, boolean deleted, List<ReactionView> reactions) {

        static MessageView of(Message message, List<MessageReaction> reactions) {
            return new MessageView(message.getId(), message.getConversationId(), message.getSenderId(),
                    message.getSeq(), message.getKind().wireValue(), message.getBody(),
                    message.getMediaKey(), message.getClientMsgId(), message.getCreatedAt(),
                    message.getReplyToSeq(), message.isDeleted(),
                    reactions.stream()
                            .map(reaction -> new ReactionView(reaction.getUserId(), reaction.getEmoji()))
                            .toList());
        }
    }

    record ReactionView(UUID userId, String emoji) {}

    record HistoryResponse(List<MessageView> messages, Long nextBefore, Long nextAfter) {}

    record ParticipantView(UUID userId, long readCursorSeq, boolean hasLeft) {}

    record ConversationSummary(UUID id, String kind, String state, int unreadCount,
                               UUID peerId, String peerName, String lastMessage,
                               boolean lastFromMe, Instant lastAt) {
    }

    record ConversationView(UUID id, String kind, String state, int unreadCount,
                            long readCursorSeq, List<ParticipantView> others) {
    }
}

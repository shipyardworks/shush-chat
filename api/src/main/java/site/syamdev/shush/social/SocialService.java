package site.syamdev.shush.social;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import site.syamdev.shush.common.AfterCommit;
import site.syamdev.shush.common.ApiException;
import site.syamdev.shush.conversation.Conversation;
import site.syamdev.shush.conversation.ConversationService;
import site.syamdev.shush.realtime.BackplanePublisher;
import site.syamdev.shush.realtime.ServerFrame;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
public class SocialService {

    private static final int INVITE_CODE_BYTES = 9;
    private static final int MAX_REASON_LENGTH = 500;

    private final FriendRequestRepository requests;
    private final FriendshipRepository friendships;
    private final BlockRepository blocks;
    private final ReportRepository reports;
    private final InviteLinkRepository invites;
    private final ConversationService conversations;
    private final BackplanePublisher backplane;
    private final Clock clock;
    private final Duration requestTtl;
    private final Duration inviteTtl;
    private final SecureRandom random = new SecureRandom();

    SocialService(FriendRequestRepository requests, FriendshipRepository friendships,
                  BlockRepository blocks, ReportRepository reports, InviteLinkRepository invites,
                  ConversationService conversations, BackplanePublisher backplane, Clock clock,
                  @Value("${shush.social.friend-request-ttl}") Duration requestTtl,
                  @Value("${shush.social.invite-ttl}") Duration inviteTtl) {
        this.requests = requests;
        this.friendships = friendships;
        this.blocks = blocks;
        this.reports = reports;
        this.invites = invites;
        this.conversations = conversations;
        this.backplane = backplane;
        this.clock = clock;
        this.requestTtl = requestTtl;
        this.inviteTtl = inviteTtl;
    }

    /**
     * Works during the conversation and after it has ended, which is the point: it is the one
     * thing that still works once someone has left, so a good chat is not lost just because the
     * other person closed their laptop first (pre-plan.md 6).
     */
    @Transactional
    public FriendRequest requestFriend(UUID conversationId, UUID fromUserId) {
        conversations.requireParticipant(conversationId, fromUserId);

        UUID toUserId = conversations.participantIds(conversationId).stream()
                .filter(participantId -> !participantId.equals(fromUserId))
                .findFirst()
                .orElseThrow(() -> ApiException.badRequest("no_counterpart",
                        "there is nobody else in this conversation"));

        if (friendships.existsBetween(fromUserId, toUserId)) {
            throw new ApiException(HttpStatus.CONFLICT, "already_friends", "you are already friends");
        }
        if (blocks.existsBetween(fromUserId, toUserId)) {
            // Says nothing about which direction the block runs.
            throw ApiException.forbidden("unavailable", "that is not possible");
        }
        requests.findByConversationIdAndFromUserId(conversationId, fromUserId).ifPresent(existing -> {
            throw new ApiException(HttpStatus.CONFLICT, "already_requested",
                    "you have already asked to keep this person");
        });

        Instant now = clock.instant();
        FriendRequest request = requests.save(new FriendRequest(UUID.randomUUID(), conversationId,
                fromUserId, toUserId, now, now.plus(requestTtl)));

        // Somebody wants this conversation kept, so it is no longer scheduled for deletion.
        conversations.cancelPurge(conversationId);
        // After the commit, not before it. The recipient's client answers this frame by
        // re-reading /api/friend-requests, and that read beats an uncommitted insert -- the
        // request is delivered, handled, and shows nothing.
        AfterCommit.run(() -> backplane.publish(toUserId,
                new ServerFrame.FriendRequested(conversationId, request.getId(), fromUserId)));
        return request;
    }

    @Transactional
    public void accept(UUID requestId, UUID actingUserId) {
        FriendRequest request = requireAddressedTo(requestId, actingUserId);
        request.accept();

        Instant now = clock.instant();
        if (!friendships.existsBetween(request.getFromUserId(), request.getToUserId())) {
            friendships.save(Friendship.between(request.getFromUserId(), request.getToUserId(),
                    request.getConversationId(), now));
        }
        conversations.keep(request.getConversationId());

        // Only the sender is told, and only about acceptance. That asymmetry is deliberate.
        // After the commit for the same reason as above: the sender reloads their friends list
        // when this arrives, and the friendship row has to exist by then.
        AfterCommit.run(() -> backplane.publish(request.getFromUserId(),
                new ServerFrame.FriendRequestAccepted(request.getConversationId(), request.getId(),
                        request.getToUserId())));
    }

    /**
     * Silent by design: nothing is published and nothing is returned to the sender, who simply
     * never hears back. The row stays so the unique constraint stops the same request being
     * sent again, and the conversation goes back to being scheduled for deletion.
     */
    @Transactional
    public void decline(UUID requestId, UUID actingUserId) {
        FriendRequest request = requireAddressedTo(requestId, actingUserId);
        request.decline();
        purgeIfNobodyWantsIt(request.getConversationId());
    }

    @Transactional(readOnly = true)
    public List<FriendRequest> pendingFor(UUID userId) {
        return requests.findByToUserIdAndStatus(userId, FriendRequest.Status.PENDING.wireValue());
    }

    /**
     * Undoes keeping somebody.
     *
     * <p>Not in pre-plan.md, and added because its absence was a dead end: matching skips
     * anyone you are already friends with, so once two accounts had kept each other there was
     * no way for either of them to be matched again -- correct behaviour with no way out of it.
     *
     * <p>The conversation is left alone. It stops being a friendship, not a thing that
     * happened, and the retention job already owns deciding when a kept conversation is no
     * longer worth keeping.
     */
    @Transactional
    public void unfriend(UUID actingUserId, UUID otherUserId) {
        if (friendships.deleteBetween(actingUserId, otherUserId) == 0) {
            throw ApiException.badRequest("not_friends", "you are not friends with that person");
        }
        // The other person is looking at a friends list that has just stopped being true. Only
        // the one who acted knew, so theirs stayed right and theirs alone -- until something
        // else happened to make that client reload.
        AfterCommit.run(() -> backplane.publish(otherUserId,
                new ServerFrame.FriendshipEnded(actingUserId)));
    }

    @Transactional(readOnly = true)
    public List<Friendship> friendshipsOf(UUID userId) {
        return friendships.findAllInvolving(userId);
    }

    @Transactional
    public void block(UUID blockerId, UUID blockedId) {
        if (blockerId.equals(blockedId)) {
            throw ApiException.badRequest("cannot_block_self", "you cannot block yourself");
        }
        blocks.save(new Block(blockerId, blockedId, clock.instant()));
        // Blocking someone you kept undoes the keeping; leaving the friendship in place would
        // make the friends list show someone you have asked never to hear from again.
        //
        // And that cuts both ways, which is the half that was missing: the friendship row is
        // one row for two people, so deleting it silently left the blocked side showing a
        // friend who could no longer reach them, with the list only correcting itself on the
        // next full load. They are told the friendship ended and nothing more.
        if (friendships.deleteBetween(blockerId, blockedId) > 0) {
            AfterCommit.run(() -> backplane.publish(blockedId,
                    new ServerFrame.FriendshipEnded(blockerId)));
        }
    }

    @Transactional
    public void unblock(UUID blockerId, UUID blockedId) {
        blocks.deleteById(new Block.Key(blockerId, blockedId));
    }

    @Transactional
    public Report report(UUID reporterId, UUID reportedId, UUID conversationId, String reason) {
        if (reason == null || reason.isBlank() || reason.length() > MAX_REASON_LENGTH) {
            throw ApiException.badRequest("invalid_reason",
                    "a reason is required and is at most " + MAX_REASON_LENGTH + " characters");
        }
        return reports.save(new Report(UUID.randomUUID(), reporterId, reportedId, conversationId,
                reason, clock.instant()));
    }

    @Transactional
    public InviteLink createInvite(UUID ownerId) {
        byte[] bytes = new byte[INVITE_CODE_BYTES];
        random.nextBytes(bytes);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        Instant now = clock.instant();
        return invites.save(new InviteLink(code, ownerId, now, now.plus(inviteTtl)));
    }

    /**
     * Deliberate and opt-in on both sides, and useless for trawling: you have to have been given
     * the code. That is the whole reason it exists instead of search by name (pre-plan.md 6).
     */
    @Transactional
    public Conversation acceptInvite(String code, UUID guestId) {
        InviteLink invite = invites.findById(code)
                .orElseThrow(() -> ApiException.notFound("unknown_invite", "that link is not valid"));
        if (invite.hasExpired(clock.instant())) {
            throw ApiException.notFound("unknown_invite", "that link is not valid");
        }
        if (invite.getOwnerId().equals(guestId)) {
            throw ApiException.badRequest("own_invite", "that is your own link");
        }
        if (blocks.existsBetween(invite.getOwnerId(), guestId)) {
            throw ApiException.forbidden("unavailable", "that is not possible");
        }
        return conversations.createMatched(invite.getOwnerId(), guestId, null);
    }

    /** After a decline or an expiry, a conversation nobody asked to keep goes back on the clock. */
    private void purgeIfNobodyWantsIt(UUID conversationId) {
        boolean wanted = requests.existsByConversationIdAndStatusIn(conversationId,
                List.of(FriendRequest.Status.PENDING.wireValue(),
                        FriendRequest.Status.ACCEPTED.wireValue()));
        if (!wanted) {
            conversations.schedulePurge(conversationId);
        }
    }

    private FriendRequest requireAddressedTo(UUID requestId, UUID actingUserId) {
        FriendRequest request = requests.findById(requestId)
                .orElseThrow(() -> ApiException.notFound("unknown_request", "no such request"));
        if (!request.getToUserId().equals(actingUserId)) {
            throw ApiException.forbidden("not_yours", "that request was not sent to you");
        }
        if (request.getStatus() != FriendRequest.Status.PENDING) {
            throw new ApiException(HttpStatus.CONFLICT, "already_answered",
                    "that request has already been answered");
        }
        return request;
    }
}

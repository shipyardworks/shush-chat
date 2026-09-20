package site.syamdev.shush.social;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Read-only questions about the graph, split out so matching can ask them without depending on
 * everything that writes to it.
 */
@Component
public class SocialGraph {

    private final FriendshipRepository friendships;
    private final BlockRepository blocks;

    SocialGraph(FriendshipRepository friendships, BlockRepository blocks) {
        this.friendships = friendships;
        this.blocks = blocks;
    }

    /**
     * Blocking is one-directional but its effect on matching is not: being matched with someone
     * you blocked is as bad as being matched with someone who blocked you, and in the second
     * case the person who asked not to see you would have no idea why you turned up again.
     */
    @Transactional(readOnly = true)
    public List<UUID> blockedEitherWay(UUID userId) {
        return blocks.findAllInvolving(userId).stream()
                .map(block -> block.getBlockerId().equals(userId)
                        ? block.getBlockedId()
                        : block.getBlockerId())
                .toList();
    }

    @Transactional(readOnly = true)
    public boolean areFriends(UUID first, UUID second) {
        return friendships.existsBetween(first, second);
    }

    @Transactional(readOnly = true)
    public boolean blockedBetween(UUID first, UUID second) {
        return blocks.existsBetween(first, second);
    }
}

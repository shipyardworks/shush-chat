package site.syamdev.shush.user;

import java.util.UUID;

public record UserView(UUID id, String displayName, boolean anonymous, String email) {

    public static UserView of(User user) {
        return new UserView(user.getId(), user.getDisplayName(), user.isAnonymous(), user.getEmail());
    }
}

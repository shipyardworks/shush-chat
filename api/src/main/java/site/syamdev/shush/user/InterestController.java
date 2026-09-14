package site.syamdev.shush.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import site.syamdev.shush.common.CurrentUser;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/interests")
class InterestController {

    private final InterestService interestService;
    private final CurrentUser currentUser;

    InterestController(InterestService interestService, CurrentUser currentUser) {
        this.interestService = interestService;
        this.currentUser = currentUser;
    }

    /** Permitted anonymously so the interest screen renders before a token exists. */
    @GetMapping
    InterestsResponse list() {
        InterestService.Suggestions suggestions = interestService.suggestFor(optionalUserId());
        return new InterestsResponse(
                suggestions.suggested().stream().map(InterestView::of).toList(),
                suggestions.all().stream().map(InterestView::of).toList(),
                suggestions.fromHistory());
    }

    @PutMapping("/mine")
    void select(@Valid @RequestBody SelectionRequest request) {
        interestService.recordSelection(currentUser.requireId(), request.interestIds());
    }

    /**
     * Adds a tag to the shared list, or hands back the one that is already there for it.
     *
     * <p>Not anonymous, unlike the list above: by the time this screen can call it, signing in
     * has already happened (starting a session is the first thing the client does), so there is
     * nothing gained by allowing a request with no one behind it.
     */
    @PostMapping
    InterestView create(@Valid @RequestBody CreateRequest request) {
        currentUser.requireId();
        return InterestView.of(interestService.getOrCreate(request.label()));
    }

    private UUID optionalUserId() {
        return SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken token
                ? UUID.fromString(token.getToken().getSubject())
                : null;
    }

    record SelectionRequest(@NotEmpty @Size(max = 10) List<Short> interestIds) {}

    record CreateRequest(@NotBlank @Size(max = 40) String label) {}

    record InterestView(short id, String slug, String label) {

        static InterestView of(Interest interest) {
            return new InterestView(interest.getId(), interest.getSlug(), interest.getLabel());
        }
    }

    record InterestsResponse(List<InterestView> suggested, List<InterestView> all, boolean fromHistory) {}
}

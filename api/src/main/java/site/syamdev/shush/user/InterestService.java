package site.syamdev.shush.user;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import site.syamdev.shush.common.ApiException;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class InterestService {

    /** Five tiles, because step 2 of the journey is one screen with five of them. */
    static final int DEFAULT_TILE_COUNT = 5;

    private static final int MAX_LABEL_LENGTH = 40;
    private static final Pattern NOT_ALPHANUMERIC = Pattern.compile("[^a-z0-9]+");
    private static final Pattern EDGE_DASHES = Pattern.compile("^-+|-+$");

    private final InterestRepository interests;
    private final UserInterestRepository userInterests;
    private final Clock clock;

    InterestService(InterestRepository interests, UserInterestRepository userInterests, Clock clock) {
        this.interests = interests;
        this.userInterests = userInterests;
        this.clock = clock;
    }

    /**
     * A first-time visitor sees the five most popular interests; a returning one sees their
     * own, already selected (pre-plan.md 3, step 2).
     */
    @Transactional(readOnly = true)
    public Suggestions suggestFor(UUID userId) {
        List<Interest> all = interests.findAllByOrderByPopularityDescIdAsc();

        List<Interest> suggested = userId == null ? List.of() : interests.findLastUsedBy(userId);
        boolean returning = !suggested.isEmpty();
        if (!returning) {
            suggested = all.stream().limit(DEFAULT_TILE_COUNT).toList();
        }

        return new Suggestions(suggested.stream().limit(DEFAULT_TILE_COUNT).toList(), all, returning);
    }

    @Transactional
    public void recordSelection(UUID userId, List<Short> interestIds) {
        Instant now = clock.instant();
        List<Short> selected = interestIds.stream().distinct().toList();

        if (selected.isEmpty()) {
            userInterests.deselectAll(userId);
            return;
        }
        selected.forEach(interestId -> userInterests.select(userId, interestId, now));
        userInterests.deselectOthers(userId, selected);
    }

    /**
     * Finds the shared row for a tag, or creates it. There is no per-user copy of this: the
     * whole reason two strangers can be told "you both like xyz" is that they are pointing at
     * the same interest, and a private tag only one of them has cannot match anyone by
     * construction (aim.md 4.3 -- lexical overlap needs a shared vocabulary to overlap on).
     *
     * <p>Deduped by slug, not by the label as typed: "Xabc", "xabc " and "XABC" all resolve to
     * one row, so two people describing the same thing in different case are still the same
     * interest to the matcher rather than three unrelated ones. The first spelling to arrive
     * becomes the display label; later arrivals just get handed the existing row.
     */
    @Transactional
    public Interest getOrCreate(String rawLabel) {
        String stripped = rawLabel == null ? "" : rawLabel.strip();
        if (stripped.isEmpty()) {
            throw ApiException.badRequest("blank_interest", "say what you are into first");
        }
        String label = stripped.length() > MAX_LABEL_LENGTH
                ? stripped.substring(0, MAX_LABEL_LENGTH).strip()
                : stripped;

        String slug = slugify(label);
        return interests.findBySlug(slug).orElseGet(() -> {
            try {
                return interests.save(new Interest(label, slug));
            } catch (DataIntegrityViolationException raceLost) {
                // Somebody else's request for the same tag committed first. The slug unique
                // constraint is what actually prevents two rows for "xabc" existing at once;
                // this is just the retry that turns that constraint into a normal-looking
                // response instead of a 500.
                return interests.findBySlug(slug)
                        .orElseThrow(() -> raceLost);
            }
        });
    }

    /**
     * A stable dedupe key: lowercase, alphanumeric runs joined by single dashes, nothing at the
     * edges. "Coffee & Tea" and "coffee-tea!!" both become "coffee-tea".
     *
     * <p>A label that slugifies to nothing -- all emoji, all punctuation -- gets a key nobody
     * else can accidentally collide with, which trades away deduping that one label against
     * itself for never returning a blank primary key.
     */
    private static String slugify(String label) {
        String lower = NOT_ALPHANUMERIC.matcher(label.toLowerCase(Locale.ROOT)).replaceAll("-");
        String slug = EDGE_DASHES.matcher(lower).replaceAll("");
        return slug.isEmpty() ? "tag-" + UUID.randomUUID() : slug;
    }

    public record Suggestions(List<Interest> suggested, List<Interest> all, boolean fromHistory) {}
}

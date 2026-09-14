package site.syamdev.shush.matching;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Someone in the wait pool.
 *
 * @param patienceSeconds 5, 10, 30, or 0 for "wait as long as it takes". The dial is honest about
 *                        the trade: when Shush is quiet the 5-second option usually hands you a
 *                        random person, which is the point of it (pre-plan.md 3, step 4).
 */
public record WaitingUser(UUID userId,
                          List<Short> interestIds,
                          int patienceSeconds,
                          Instant enqueuedAt) {

    public boolean waitsIndefinitely() {
        return patienceSeconds == 0;
    }

    public boolean patienceExpired(Instant now) {
        return !waitsIndefinitely()
                && !now.isBefore(enqueuedAt.plusSeconds(patienceSeconds));
    }
}

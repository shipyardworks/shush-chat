"use client";

/** One placeholder row: an avatar circle and two text bars, the shape of a chat/friend row. */
const SkeletonRow = () => (
  <div className="flex items-center gap-2.5 p-2">
    <span
      className="h-10 w-10 flex-none animate-pulse rounded-full"
      style={{ backgroundColor: "var(--color-surface-3)" }}
    />
    <span className="min-w-0 flex-1">
      <span
        className="block h-3.5 w-3/5 animate-pulse rounded-full"
        style={{ backgroundColor: "var(--color-surface-3)" }}
      />
      <span
        className="mt-2 block h-3 w-2/5 animate-pulse rounded-full"
        style={{ backgroundColor: "var(--color-surface-3)" }}
      />
    </span>
  </div>
);

/**
 * Stands in for the chat/friend list while the first load is still in flight, so a genuinely
 * empty list and a list that just hasn't answered yet don't look identical.
 */
export const Skeleton = ({ rows = 4 }: { rows?: number }) => (
  <div aria-hidden="true" className="flex flex-col gap-1">
    {Array.from({ length: rows }).map((_, index) => (
      <SkeletonRow key={index} />
    ))}
  </div>
);

/** Bubble-shaped bars, theirs on the left and yours on the right, in a rough conversation rhythm. */
const BUBBLES: { mine: boolean; width: string }[] = [
  { mine: false, width: "38%" },
  { mine: false, width: "24%" },
  { mine: true, width: "32%" },
  { mine: false, width: "46%" },
  { mine: true, width: "20%" },
  { mine: true, width: "40%" },
];

/**
 * Stands in for a conversation while its history loads. An empty pane in that moment reads as
 * "nothing was ever said here", which is a claim, and usually a wrong one.
 */
export const MessageSkeleton = () => (
  <div id="messagesLoading" aria-hidden="true" className="flex flex-col gap-2 pt-2">
    {BUBBLES.map((bubble, index) => (
      <span
        key={index}
        className="block h-11 animate-pulse"
        style={{
          width: bubble.width,
          minWidth: 90,
          alignSelf: bubble.mine ? "flex-end" : "flex-start",
          borderRadius: bubble.mine ? "16px 16px 5px 16px" : "16px 16px 16px 5px",
          backgroundColor: "var(--color-surface-3)",
        }}
      />
    ))}
  </div>
);

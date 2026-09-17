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

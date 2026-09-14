"use client";

import { useId } from "react";

/**
 * The "sh" monogram, inlined rather than an <img> so it never shows a broken-image square
 * before the network settles, and matches the tab icon at app/icon.svg exactly.
 *
 * <p>The gradient id has to be unique per instance: two <Brand />s on one page (the header and
 * a switched-account chip, say) would otherwise both point at whichever <linearGradient> the
 * browser saw last.
 */
export const Brand = () => {
  const gradientId = useId();

  return (
    <span className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
      <svg
        viewBox="0 0 32 32"
        width={26}
        height={26}
        style={{ boxShadow: "0 4px 12px rgb(109 77 251 / 0.4)", borderRadius: 9 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#38d0e0" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
        <g
          transform="translate(-.5 1.5)"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 13.6c-.6-1.1-1.6-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2.1 0 2.8 5.8 1.8 5.8 4.7 0 1.5-1.3 2.5-3 2.5-1.4 0-2.5-.6-3.2-1.8" />
          <path d="M18.5 7.5v14M18.5 16c0-2.5 1.5-4 3.5-4s3 1.4 3 3.5v6" />
        </g>
      </svg>
      <span
        style={{
          backgroundImage: "linear-gradient(120deg, var(--color-body), var(--color-muted))",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        Shush
      </span>
    </span>
  );
};

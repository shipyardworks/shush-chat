"use client";

import { useEffect, useState } from "react";
import { mediaUrl } from "@/lib/api";

/**
 * One template for a shared image, wherever it is drawn -- a bubble, the full-size viewer.
 *
 * <p>An `<img>` that fails to load used to just be an `<img>` that failed to load: whatever the
 * browser's own broken-image glyph looks like, sized however the surrounding layout happened to
 * squeeze it, with the alt text bleeding through underneath. This renders the same box either
 * way.
 *
 * <p>And it says which of the two it is. Images in a conversation where neither person has
 * saved an account are kept for a day and then deleted, on purpose (`application.yml`,
 * `shush.storage.anonymous-retention`) -- so the most common reason a photo will not load is
 * not a fault at all, it is yesterday. "Photo unavailable" over a deliberate expiry reads as
 * the app being broken, and the owner reported it as exactly that. An `<img>` cannot report a
 * status code, so the box asks the API once, and only after a failure: `unknown_media` is a
 * 404 and means the object has been reaped.
 */
export const ChatImage = ({
  mediaKey,
  alt = "Shared image",
  onClick,
  className,
  style,
}: {
  mediaKey: string;
  alt?: string;
  onClick?: (event: React.MouseEvent<HTMLImageElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}) => {
  // Keyed by the image they are about, not plain booleans: this component is reused for the
  // next message in the list, and a flag left over from the last one would draw a failure box
  // over a photo that is perfectly fine.
  const [failed, setFailed] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const broken = failed === mediaKey;
  const expired = gone === mediaKey;

  useEffect(() => {
    if (!broken) return;
    let live = true;
    // HEAD, so nothing is downloaded a second time just to find out why it did not arrive once.
    fetch(mediaUrl(mediaKey), { method: "HEAD" })
      .then((response) => {
        if (live && response.status === 404) setGone(mediaKey);
      })
      .catch(() => {
        // Offline, or the API is unreachable. That is the "unavailable" wording already on
        // screen, so there is nothing to correct.
      });
    return () => {
      live = false;
    };
  }, [broken, mediaKey]);

  if (broken) {
    return (
      <div
        data-testid="imageFallback"
        className={`flex flex-col items-center justify-center gap-1.5 ${className ?? ""}`}
        style={{
          minWidth: 180,
          minHeight: 140,
          backgroundColor: "var(--color-surface-3)",
          color: "var(--color-faint)",
          ...style,
        }}
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17.5 9 12l3 3 3.5-3.5L20 16" />
          <path d="M4 20 20 4" />
        </svg>
        <span className="text-[12px]">{expired ? "Photo expired" : "Photo unavailable"}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      src={mediaUrl(mediaKey)}
      draggable={false}
      onClick={onClick}
      onError={() => setFailed(mediaKey)}
      className={className}
      style={style}
    />
  );
};

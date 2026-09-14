"use client";

import { useState } from "react";
import { mediaUrl } from "@/lib/api";

/**
 * One template for a shared image, wherever it is drawn -- a bubble, the full-size viewer.
 *
 * <p>An `<img>` that fails to load used to just be an `<img>` that failed to load: whatever the
 * browser's own broken-image glyph looks like, sized however the surrounding layout happened to
 * squeeze it, with the alt text bleeding through underneath. This renders the same box either
 * way, so a 404 from an object store that has since expired the key reads as "this photo is
 * gone" rather than as the app itself being broken.
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
  const [broken, setBroken] = useState(false);

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
        <span className="text-[12px]">Photo unavailable</span>
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
      onError={() => setBroken(true)}
      className={className}
      style={style}
    />
  );
};

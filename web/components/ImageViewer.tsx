"use client";

import { useEffect } from "react";
import { mediaUrl } from "@/lib/api";
import { ChatImage } from "./ChatImage";

/**
 * A photo, full size, on a dark ground -- the thing every chat app does when you tap an image,
 * because a 300px bubble is a thumbnail and people tap it to actually look.
 */
export const ImageViewer = ({ mediaKey, onClose }: { mediaKey: string; onClose: () => void }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      id="imageViewer"
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ backgroundColor: "var(--color-scrim-strong)" }}
      onClick={onClose}
    >
      <div className="flex items-center gap-3 p-4">
        <button
          id="closeImageViewer"
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="btn-ghost px-3"
        >
          ✕
        </button>
        <span className="flex-1" />
        {/* Opens the storage URL directly, so saving is the browser's job rather than ours. */}
        <a
          href={mediaUrl(mediaKey)}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="btn-ghost px-3 text-sm no-underline"
        >
          Open
        </a>
      </div>
      {/* flex with min-h-0 and overflow-hidden, not grid: a grid row is sized to its content,
          so max-h-full on the image resolved against a track the image had already stretched
          -- the same bug the send-side preview fixed, showing up here because this is a second
          place that draws one image at full size rather than the same component doing it. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <ChatImage
          mediaKey={mediaKey}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain"
          style={{ maxHeight: "100%", maxWidth: "100%" }}
        />
      </div>
    </div>
  );
};

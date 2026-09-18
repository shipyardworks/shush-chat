"use client";

import { useState } from "react";
import type { Attachment } from "@/lib/useShush";

/**
 * What you are about to send, before you send it.
 *
 * <p>Picking a file used to be the same action as sending it, which makes choosing the wrong
 * one unrecoverable. Three controls and no more: add another, say something about it, send.
 */
export const AttachmentPreview = ({
  attachment,
  onCancel,
  onAdd,
  onSend,
}: {
  attachment: Attachment;
  onCancel: () => void;
  onAdd: () => void;
  onSend: (caption: string) => void;
}) => {
  const [caption, setCaption] = useState("");

  return (
    <div
      id="attachmentPreview"
      className="fixed inset-0 z-50 flex flex-col backdrop-blur-sm"
      style={{ backgroundColor: "var(--color-scrim-strong)" }}
    >
      <div className="flex items-center gap-3 p-4">
        <button
          id="cancelAttachment"
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="btn-ghost px-3"
        >
          ✕
        </button>
        <span className="truncate text-sm" style={{ color: "var(--color-muted)" }}>
          {attachment.file.name}
        </span>
      </div>

      {/* flex with min-h-0 and overflow-hidden, not grid: a grid row is auto-sized to its
          content, so max-h-full on the image resolved against a track the image itself had
          already stretched -- and a tall photo pushed straight through the caption bar. Here
          the row cannot grow past the space left over, whatever shape the picture is. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          id="attachmentImage"
          alt="about to send"
          src={attachment.previewUrl}
          className="max-h-full max-w-full rounded-xl object-contain"
          style={{ maxHeight: "100%", maxWidth: "100%" }}
        />
      </div>

      <div className="flex items-center gap-2.5 p-4">
        <button
          id="addAnotherAttachment"
          type="button"
          title="Choose a different image"
          onClick={onAdd}
          className="btn-ghost px-4 text-lg"
        >
          +
        </button>
        <input
          id="attachmentCaption"
          type="text"
          className="field flex-1"
          placeholder="Add a caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSend(caption);
          }}
        />
        <button
          id="sendAttachment"
          type="button"
          aria-label="Send"
          onClick={() => onSend(caption)}
          className="btn-primary grid h-11 w-11 place-items-center rounded-full p-0"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

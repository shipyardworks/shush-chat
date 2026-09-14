"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { clockTime } from "@/lib/time";
import type { Delivery, Message } from "@/lib/types";
import { ChatImage } from "./ChatImage";
import { EmojiPicker } from "./EmojiPicker";
import { Ticks } from "./Ticks";

/** Far enough that it cannot be a scroll, close enough to be one flick of a thumb. */
const SWIPE_TO_REPLY = 60;
const LONG_PRESS_MS = 450;

const Quoted = ({
  message,
  mine,
  onJump,
}: {
  message: Message;
  mine: boolean;
  onJump: () => void;
}) => (
  <button
    type="button"
    data-testid="quote"
    onClick={(event) => {
      event.stopPropagation();
      onJump();
    }}
    className="mb-1.5 block w-full cursor-pointer truncate rounded-lg border-l-[3px] px-2.5 py-1.5 text-left text-[13px] transition hover:brightness-110"
    style={{
      borderLeftColor: mine ? "rgb(255 255 255 / 0.7)" : "var(--color-brand)",
      backgroundColor: mine ? "rgb(255 255 255 / 0.14)" : "var(--color-surface-3)",
    }}
  >
    <span className="opacity-80">
      {message.deleted
        ? "This message was deleted"
        : message.kind === "image"
          ? "Photo"
          : message.body}
    </span>
  </button>
);

export const MessageBubble = ({
  message,
  delivery,
  mine,
  quoted,
  meId,
  onReply,
  onReact,
  onDeleteForEveryone,
  onHideForMe,
  onJumpToQuoted,
  onOpenImage,
}: {
  message: Message;
  delivery: Delivery;
  mine: boolean;
  quoted: Message | null;
  meId: string | undefined;
  onReply: () => void;
  onReact: (emoji: string | null) => void;
  onDeleteForEveryone: () => void;
  onHideForMe: () => void;
  onJumpToQuoted: (seq: number) => void;
  onOpenImage: (key: string) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  /** Viewport coordinates for the open popover, or null until they have been measured. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const row = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLButtonElement>(null);
  const startX = useRef(0);
  const dragging = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);

  const myReaction = (message.reactions ?? []).find((r) => r.userId === meId)?.emoji ?? null;
  const isImage = message.kind === "image" && Boolean(message.mediaKey) && !message.deleted;

  /**
   * Positions the popover next to the dots that opened it, in viewport coordinates.
   *
   * <p>Anchored inside the row, it was positioned against a full-width row rather than the
   * button, so it drifted across the bubble and off the edge of the window. Fixed coordinates
   * measured from the button are the only version of this that holds for a bubble anywhere on
   * screen: it opens away from the bubble -- left of the dots for your own messages, right of
   * them for theirs -- and is then clamped so it cannot leave the viewport in either axis.
   *
   * <p>Measured in a layout effect, before paint, so it never appears in the wrong place first.
   */
  useLayoutEffect(() => {
    if (!menuOpen && !pickerOpen) {
      setAt(null);
      return;
    }
    const button = dots.current?.getBoundingClientRect();
    const box = menu.current?.getBoundingClientRect();
    if (!button) return;

    const width = box?.width ?? (menuOpen ? 176 : 260);
    const height = box?.height ?? (menuOpen ? 180 : 46);
    const margin = 8;

    // Away from the bubble: yours sit on the right, so the menu goes left, and the other way
    // round for theirs.
    let left = mine ? button.left - width - 6 : button.right + 6;
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);

    let top = button.top + button.height / 2 - height / 2;
    top = Math.min(Math.max(margin, top), window.innerHeight - height - margin);

    setAt({ left, top });
  }, [menuOpen, pickerOpen, mine]);

  const cancelLongPress = () => {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  };

  /**
   * Swipe to reply, in the direction the bubble sits: your own messages pull left, theirs pull
   * right. Anything else is a scroll, so a vertical-ish drag cancels rather than fights it.
   */
  const onPointerDown = (event: React.PointerEvent) => {
    if (message.deleted) return;
    startX.current = event.clientX;
    dragging.current = true;
    moved.current = false;
    cancelLongPress();
    longPress.current = setTimeout(() => {
      if (!moved.current) setPickerOpen(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = event.clientX - startX.current;
    if (Math.abs(dx) > 6) {
      moved.current = true;
      cancelLongPress();
    }
    const allowed = mine ? Math.min(0, dx) : Math.max(0, dx);
    setOffset(Math.max(-90, Math.min(90, allowed)));
  };

  const endDrag = () => {
    cancelLongPress();
    if (!dragging.current) return;
    dragging.current = false;
    if (Math.abs(offset) >= SWIPE_TO_REPLY) {
      onReply();
    }
    setOffset(0);
  };

  const act = (run: () => void) => () => {
    setMenuOpen(false);
    setPickerOpen(false);
    run();
  };

  const copy = () => {
    void navigator.clipboard?.writeText(message.body ?? "").catch(() => {
      // Clipboard needs a secure context and permission. Failing silently is right here:
      // there is nothing useful to say and nothing broken in the conversation itself.
    });
  };

  // Hidden until measured, so a popover is never painted at the wrong coordinates first.
  const floating: React.CSSProperties = {
    position: "fixed",
    left: at?.left ?? -9999,
    top: at?.top ?? -9999,
    visibility: at ? "visible" : "hidden",
  };

  return (
    <div
      ref={row}
      data-testid="messageRow"
      className="group relative flex w-full"
      style={{ justifyContent: mine ? "flex-end" : "flex-start" }}
    >
      <div
        data-testid="message"
        data-seq={message.seq ?? ""}
        data-mine={mine}
        data-deleted={Boolean(message.deleted)}
        className="rise relative max-w-[74%]"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? "none" : "transform .18s ease",
          touchAction: "pan-y",
          color: mine && !message.deleted ? "#fff" : "var(--color-body)",
          background: message.deleted
            ? "var(--color-surface-2)"
            : mine
              ? "linear-gradient(135deg, #6d4dfb, var(--color-brand-2))"
              : "var(--color-surface-2)",
          border: `1px solid ${mine && !message.deleted ? "transparent" : "var(--color-line-soft)"}`,
          borderRadius: mine ? "16px 16px 5px 16px" : "16px 16px 16px 5px",
          overflowWrap: "anywhere",
          // An image fills its bubble edge to edge; text needs breathing room. Padding the
          // bubble for both is what left a photo floating inside a coloured frame.
          padding: isImage ? 4 : "10px 14px",
          // The reaction chip hangs off the bottom edge, so the bubble reserves room for it
          // rather than being clipped by the next message -- what every chat app does.
          marginBottom: (message.reactions ?? []).length > 0 ? 14 : 0,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={() => {
          if (!message.deleted) onReact("❤️");
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!message.deleted) setMenuOpen(true);
        }}
      >
        <div style={{ padding: isImage && quoted ? "6px 8px 0" : undefined }}>
          {quoted && (
            <Quoted
              message={quoted}
              mine={mine}
              onJump={() => message.replyToSeq != null && onJumpToQuoted(message.replyToSeq)}
            />
          )}
        </div>

        {message.deleted ? (
          <div className="flex items-center gap-1.5 text-[14px] italic opacity-60">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M6 6l12 12" />
            </svg>
            This message was deleted
          </div>
        ) : isImage ? (
          /* The photo is the bubble. Time sits on the image itself, over a gradient, which is
             what keeps a picture from being framed like a document. */
          <button
            type="button"
            data-testid="openImage"
            onClick={() => onOpenImage(message.mediaKey!)}
            className="relative block cursor-zoom-in overflow-hidden"
            style={{ borderRadius: 13 }}
          >
            <ChatImage
              mediaKey={message.mediaKey!}
              className="block max-h-[340px] min-w-[120px] object-cover"
              style={{ maxWidth: 300 }}
            />
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 px-2.5 pt-6 pb-1.5 text-[10.5px] text-white"
              style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.55))" }}
            >
              {clockTime(message.createdAt)}
              {mine && <Ticks state={delivery} />}
            </span>
          </button>
        ) : (
          <div>{message.body}</div>
        )}

        {!isImage && (
          <div
            className="mt-0.5 flex items-center gap-1 text-[10.5px] whitespace-nowrap opacity-65"
            style={{ justifyContent: mine ? "flex-end" : "flex-start" }}
          >
            <span>{clockTime(message.createdAt)}</span>
            {mine && !message.deleted && <Ticks state={delivery} />}
          </div>
        )}

        {(message.reactions ?? []).length > 0 && (
          <button
            type="button"
            data-testid="reactions"
            onClick={() => setPickerOpen(true)}
            className="absolute -bottom-3 z-10 flex cursor-pointer items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[12px] shadow-md"
            style={{
              [mine ? "right" : "left"]: 8,
              borderColor: "var(--color-line)",
              backgroundColor: "var(--color-surface-3)",
              color: "var(--color-body)",
            }}
          >
            {[...new Set((message.reactions ?? []).map((r) => r.emoji))].map((emoji) => (
              <span key={emoji}>{emoji}</span>
            ))}
            {(message.reactions ?? []).length > 1 && (
              <span className="ml-0.5 text-[10px] opacity-70">
                {(message.reactions ?? []).length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* The desktop way in. On a phone it is a long press, which opens the picker directly. */}
      {!message.deleted && (
        <button
          ref={dots}
          type="button"
          data-testid="messageMenuButton"
          aria-label="Message actions"
          onClick={() => setMenuOpen((open) => !open)}
          className="self-center opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
          style={{ order: mine ? -1 : 1, padding: "0 6px", color: "var(--color-muted)" }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>
      )}

      {(menuOpen || pickerOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setMenuOpen(false);
            setPickerOpen(false);
          }}
        />
      )}

      {pickerOpen && (
        <div ref={menu} className="z-[70]" style={floating}>
          <EmojiPicker chosen={myReaction} onPick={(emoji) => act(() => onReact(emoji))()} />
        </div>
      )}

      {menuOpen && (
        <div
          ref={menu}
          data-testid="messageMenu"
          /* Anchored to the dots that opened it, not to the far edge of the bubble: the
             pointer is already there, and every pixel it has to travel is friction. */
          className="z-[70] flex min-w-44 flex-col overflow-hidden rounded-xl border py-1 shadow-xl"
          style={{
            ...floating,
            borderColor: "var(--color-line)",
            backgroundColor: "var(--color-surface-2)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <MenuItem testId="menuReply" label="Reply" onClick={act(onReply)} />
          <MenuItem testId="menuCopy" label="Copy" onClick={act(copy)} />
          <MenuItem
            testId="menuReact"
            label="React"
            onClick={() => {
              setMenuOpen(false);
              setPickerOpen(true);
            }}
          />
          {/* Yours deletes for both; theirs only for you. Two different acts, so two labels. */}
          <MenuItem
            testId="menuDelete"
            label={mine ? "Delete for everyone" : "Delete for me"}
            danger
            onClick={act(mine ? onDeleteForEveryone : onHideForMe)}
          />
        </div>
      )}
    </div>
  );
};

const MenuItem = ({
  label,
  onClick,
  danger,
  testId,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  testId: string;
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="px-3.5 py-2 text-left text-[14px] transition hover:bg-[var(--color-surface-3)]"
    style={{ color: danger ? "var(--color-danger)" : "var(--color-body)" }}
  >
    {label}
  </button>
);

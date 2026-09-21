"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem, Message } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { MessageSkeleton } from "./Skeleton";

/**
 * How much room the conversation needs, and how much it has.
 *
 * <p>Reported rather than acted on: this list does not own what sits above it. The header
 * decides for itself whether it still fits, from these three numbers.
 */
export type Room = {
  /** The height of everything in the conversation, padding included. */
  content: number;
  /** The height this list currently has to show it in. */
  view: number;
  /** Scrolled right back to the start, where there is nothing above to make room for. */
  atTop: boolean;
};

/** A few pixels, so a rounding difference is not a reason to move a header. */
const AT_TOP = 8;

/**
 * Date separators and system events share one pill on purpose: both are the room talking
 * rather than a person, and a reader should not have to tell them apart.
 */
const Pill = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => (
  <div
    className={`self-center rounded-full border px-3.5 py-1 text-center ${
      muted ? "text-[11.5px] font-semibold tracking-wide uppercase" : "text-[12.5px]"
    }`}
    style={{
      color: "var(--color-muted)",
      backgroundColor: "var(--color-surface-2)",
      borderColor: "var(--color-line-soft)",
      margin: muted ? "12px 0 6px" : "7px 0",
    }}
  >
    {children}
  </div>
);

export const MessageList = ({
  items,
  loading = false,
  meId,
  quotedFor,
  onReply,
  onReact,
  onDeleteForEveryone,
  onHideForMe,
  onOpenImage,
  onBackgroundTap,
  onRoom,
}: {
  items: ChatItem[];
  /** History is still on its way -- placeholders, not an empty pane. */
  loading?: boolean;
  meId: string | undefined;
  quotedFor: (seq: number | null | undefined) => Message | null;
  onReply: (message: Message) => void;
  onReact: (message: Message, emoji: string | null) => void;
  onDeleteForEveryone: (message: Message) => void;
  onHideForMe: (message: Message) => void;
  onOpenImage: (mediaKey: string) => void;
  /** Tapping anywhere here, message bubbles included, drops the keyboard -- same as WhatsApp. */
  onBackgroundTap?: () => void;
  /** Called whenever any of {@link Room} changes. Must be stable. */
  onRoom?: (room: Room) => void;
}) => {
  const bottom = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [flashing, setFlashing] = useState<number | null>(null);
  /**
   * Whether the reader is at the live end of the conversation.
   *
   * <p>Following the bottom is only right when they are already there. Gating it on the flash
   * instead was worse than not gating it at all: the flash clears on a timer, the effect ran
   * again with nothing highlighted, and the list yanked itself back down a second and a half
   * after somebody had deliberately scrolled away.
   */
  const pinned = useRef(true);

  /**
   * Measure, and say so.
   *
   * <p>Two observed elements, because the two numbers move independently: the scroller's own
   * height changes when the keyboard comes up or the header gets out of the way, and the
   * content's changes with every message, every image that finishes loading and every bubble
   * that rewraps.
   */
  const report = useCallback(() => {
    const view = list.current;
    const inner = content.current;
    if (!view || !inner || !onRoom) return;
    onRoom({
      content: inner.offsetHeight,
      view: view.clientHeight,
      atTop: view.scrollTop <= AT_TOP,
    });
  }, [onRoom]);

  useEffect(() => {
    const view = list.current;
    const inner = content.current;
    if (!view || !inner || !onRoom) return;
    const observer = new ResizeObserver(report);
    observer.observe(view);
    observer.observe(inner);
    report();
    return () => observer.disconnect();
  }, [onRoom, report]);

  const onScroll = () => {
    const node = list.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    report();
  };

  useEffect(() => {
    if (!pinned.current) return;
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items]);

  /**
   * Tapping a quote goes to what it answers and flashes it, which is what WhatsApp, Telegram
   * and Slack all do -- a quote that cannot be followed is a screenshot of a reply.
   */
  const jumpTo = useCallback((seq: number) => {
    const target = list.current?.querySelector(`[data-testid=message][data-seq="${seq}"]`);
    if (!target) return;
    // Going somewhere on purpose means you are no longer following the live end.
    pinned.current = false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashing(seq);
    setTimeout(() => setFlashing(null), 1600);
  }, []);

  return (
    // The scroller and the conversation are two elements, not one. A scroller's own height is
    // all a ResizeObserver on it will ever report; what the header needs to know is how tall
    // the conversation inside it has become, which is the inner element's box.
    <div
      id="messages"
      ref={list}
      onScroll={onScroll}
      onClick={onBackgroundTap}
      className="scroll-elegant flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div ref={content} className="flex flex-col gap-[3px] p-6">
      {loading && <MessageSkeleton />}
      {!loading && items.map((item, index) => {
        if (item.kind === "day") {
          return (
            <Pill key={item.id} muted>
              {item.label}
            </Pill>
          );
        }
        if (item.kind === "event") {
          return <Pill key={item.id}>{item.text}</Pill>;
        }

        const { message, delivery } = item;
        return (
          <div
            key={message.clientMsgId ?? `${message.seq}-${index}`}
            data-flash={flashing != null && message.seq === flashing}
            className="rounded-2xl transition-colors duration-500 data-[flash=true]:bg-[color-mix(in_srgb,var(--color-brand)_22%,transparent)]"
          >
          <MessageBubble
            message={message}
            delivery={delivery}
            mine={message.senderId === meId}
            meId={meId}
            quoted={quotedFor(message.replyToSeq)}
            onReply={() => onReply(message)}
            onReact={(emoji) => onReact(message, emoji)}
            onDeleteForEveryone={() => onDeleteForEveryone(message)}
            onHideForMe={() => onHideForMe(message)}
            onJumpToQuoted={jumpTo}
            onOpenImage={onOpenImage}
          />
          </div>
        );
      })}
      <div ref={bottom} />
      </div>
    </div>
  );
};

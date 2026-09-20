"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem, Message } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { MessageSkeleton } from "./Skeleton";

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
  onScrollDirection,
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
  /**
   * True once the reader has scrolled down far enough that the header above this list is
   * costing more than it is telling them, false again the moment they scroll back up.
   * Reported rather than acted on here: this list does not own what sits above it.
   */
  onScrollDirection?: (collapsed: boolean) => void;
}) => {
  const bottom = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
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
  /** Where the last scroll event left us, so this one knows which way it went. */
  const lastTop = useRef(0);
  /**
   * Set while this component is scrolling itself to follow the live end.
   *
   * <p>Following the bottom fires the same scroll events a finger does, and in the same
   * direction. Without telling the two apart, a message arriving scrolled the list down and
   * the header above it took that for someone reading and slid shut -- so the header vanished
   * because the other person said something, which is nobody's idea of scrolling.
   */
  const following = useRef(false);

  const onScroll = () => {
    const node = list.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;

    const top = node.scrollTop;
    if (following.current) {
      lastTop.current = top;
      return;
    }

    /*
     * Discount the header's own doing before measuring the reader's.
     *
     * Collapsing the header gives this list that height. A list parked at the bottom then has
     * its scrollTop clamped down by the same amount -- a scroll event going the other way,
     * arriving while the bar is still closing. Taken at face value it reopens the bar, which
     * shortens the list, which closes it again: a flicker that settles nowhere.
     *
     * The clamp is the whole of the difference and can be computed rather than waited out, so
     * the reference moves with it. That beats ignoring these events, which would also throw
     * away a real scroll made in the same moment -- and scrolling back up the instant the bar
     * starts closing is exactly when somebody would.
     */
    const maxTop = Math.max(0, node.scrollHeight - node.clientHeight);
    if (lastTop.current > maxTop) lastTop.current = maxTop;

    const moved = top - lastTop.current;
    // A threshold, because iOS rubber-banding and the browser's own scroll-anchoring both
    // emit a stream of one-pixel jitter that would otherwise flap the header open and shut.
    if (Math.abs(moved) <= 8) return;
    lastTop.current = top;

    // Near the top there is nothing gained by hiding it, and a header that will not come
    // back until you scroll further down is a header that looks broken.
    //
    // Reported every time rather than only on a change: React drops a set to the value that
    // is already there, and keeping a second copy of the answer down here is how it would
    // come to disagree with the one above -- which resets itself when the conversation
    // changes, and would then ignore the first scroll in the new one.
    onScrollDirection?.(moved > 0 && top > 64);
  };

  useEffect(() => {
    if (!pinned.current) return;
    following.current = true;
    bottom.current?.scrollIntoView({ block: "end" });
    // Cleared after the scroll events that jump caused have been delivered.
    const done = requestAnimationFrame(() => {
      following.current = false;
    });
    return () => cancelAnimationFrame(done);
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
    <div
      id="messages"
      ref={list}
      onScroll={onScroll}
      onClick={onBackgroundTap}
      className="scroll-elegant flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto p-6"
    >
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
  );
};

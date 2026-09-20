"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatItem, Message } from "@/lib/types";
import type { Peer } from "@/lib/useShush";
import { Avatar } from "./Avatar";
import { Menu, PersonPlus } from "./icons";
import { MessageList } from "./MessageList";

export const ChatPanel = ({
  peer,
  items,
  meId,
  typing,
  isFriendConversation,
  ended,
  historyLoading,
  friendRequestSent,
  searching,
  canFind,
  onFind,
  onCancelFind,
  replyingTo,
  quotedFor,
  onOpenPeer,
  onSend,
  onChooseImage,
  onTyping,
  onAskToKeep,
  onLeave,
  onReply,
  onCancelReply,
  onReact,
  onDeleteForEveryone,
  onHideForMe,
  onOpenImage,
  onOpenCamera,
  onBack,
  setupPanel,
}: {
  peer: Peer;
  items: ChatItem[];
  meId: string | undefined;
  typing: boolean;
  isFriendConversation: boolean;
  ended: boolean;
  historyLoading: boolean;
  friendRequestSent: boolean;
  /** A search is running -- the picker opened from an ended thread starts one straight away. */
  searching: boolean;
  /** At least one interest is chosen, so a search can start without asking anything first. */
  canFind: boolean;
  onFind: () => void;
  onCancelFind: () => void;
  replyingTo: Message | null;
  quotedFor: (seq: number | null | undefined) => Message | null;
  onOpenPeer: () => void;
  onSend: (body: string) => void;
  onChooseImage: (file: File) => void;
  onTyping: () => void;
  onAskToKeep: () => void;
  onLeave: () => void;
  onReply: (message: Message) => void;
  onCancelReply: () => void;
  onReact: (message: Message, emoji: string | null) => void;
  onDeleteForEveryone: (message: Message) => void;
  onHideForMe: (message: Message) => void;
  onOpenImage: (mediaKey: string) => void;
  onOpenCamera: () => void;
  /** Phone only -- opens the chats drawer over this conversation without closing it. */
  onBack?: () => void;
  setupPanel: React.ReactNode;
}) => {
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  /**
   * Phone only: the name bar slides shut while the conversation is scrolled down and comes
   * back the moment it is scrolled up, which is what every phone chat app does with it. A
   * header is worth its ~58px when you arrive and worth nothing while you are reading.
   * `.chat-head` (components.css) holds the breakpoint, so sm and up never collapses.
   */
  const [headCollapsed, setHeadCollapsed] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    onSend(draft);
    setDraft("");
  };

  // Grows with what is typed, up to a few lines, then scrolls -- the box a phone keyboard sits
  // under should never be taller than the conversation it is part of.
  useLayoutEffect(() => {
    const box = composer.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 132)}px`;
  }, [draft]);

  /**
   * "Find someone" means find someone: the picker opens already searching with what you picked
   * last time, instead of opening on a second "Find someone" to press. Closing it stops the
   * search -- walking away from the picker is walking away from the search it is showing.
   */
  const findNext = () => {
    setPicking(true);
    if (!searching && canFind) onFind();
  };
  const closePicker = () => {
    setPicking(false);
    if (searching) onCancelFind();
  };

  // A new match closes it on its own -- there is nothing left to pick for once one has been
  // found, and leaving it open would show the modal floating over somebody else's conversation.
  useEffect(() => {
    if (!ended) setPicking(false);
  }, [ended]);

  // Opening a conversation from the sidebar is a click on someone's name, not on the composer --
  // without this, saying something back takes a second click nobody should have to make.
  useEffect(() => {
    if (!ended) composer.current?.focus();
  }, [peer.userId, ended]);

  // Opening someone else's conversation is exactly when their name matters, so it is never
  // inherited half-shut from the thread before it.
  useEffect(() => {
    setHeadCollapsed(false);
  }, [peer.userId]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // closePicker reads `searching`, so the listener is rebuilt whenever that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, searching]);

  return (
    <div id="chat" className="flex min-h-0 flex-1 flex-col">
      <div className="chat-head" data-collapsed={headCollapsed}>
      {/* The clipping wrapper carries no padding or border of its own, deliberately. The row
          below is border-box, so a padded element cannot be squeezed below its own padding
          plus border -- collapsing it directly left a 29px strip that would not close. */}
      <div>
      <div
        className="flex items-center gap-2 border-b px-3.5 py-3.5 sm:gap-3 sm:px-[22px]"
        style={{ borderColor: "var(--color-line-soft)" }}
      >
        {onBack && (
          /* A burger, not a back arrow. It opens the chats drawer over this conversation
             rather than leaving it, and "<" promised the opposite -- the same control on the
             start screen, so one button means one thing wherever it is. */
          <button
            id="chatBack"
            type="button"
            aria-label="Chats and friends"
            title="Chats and friends"
            onClick={onBack}
            className="btn-ghost -ml-1 grid h-9 w-9 flex-none place-items-center rounded-full p-0 sm:hidden"
          >
            <Menu />
          </button>
        )}
        <button id="chatAvatar" type="button" title="View profile" onClick={onOpenPeer}>
          <Avatar id={peer.userId} name={peer.name} />
        </button>
        <button
          id="chatWho"
          type="button"
          title="View profile"
          onClick={onOpenPeer}
          className="min-w-0 text-left"
        >
          <h2 id="chatHeading" className="m-0 truncate text-[15px] font-semibold">
            {peer.heading}
          </h2>
          {/* The same slot does double duty: "Typing…" while it's happening, otherwise whatever
              this line would say anyway (online/offline/shared interests). One line of
              status, not two, and nothing about it needs a fixed spot lower in the panel. */}
          <div id="chatSub" className="truncate text-xs" style={{ color: "var(--color-faint)" }}>
            {typing ? "Typing…" : peer.sub}
          </div>
        </button>
        <span className="flex-1" />
        {/* Already friends means there is nothing left to ask for, and nothing to walk out of. */}
        {!isFriendConversation && (
          <>
            {/* Still offered after somebody leaves: asking to keep them is the one thing a
                finished conversation is still for. Icon-only on phone -- two full-text
                pills left no room for the peer's own name. */}
            <button
              id="addFriend"
              type="button"
              title={friendRequestSent ? "Request sent" : "Add friend"}
              aria-label={friendRequestSent ? "Request sent" : "Add friend"}
              disabled={friendRequestSent}
              className="btn-ghost flex h-9 flex-none items-center justify-center gap-1.5 rounded-full px-2.5 disabled:opacity-50 sm:px-3.5"
              onClick={onAskToKeep}
            >
              <PersonPlus className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">{friendRequestSent ? "Request sent" : "Add friend"}</span>
            </button>
            {!ended && (
              <button
                id="leave"
                type="button"
                title="Leave"
                aria-label="Leave"
                className="btn-ghost flex h-9 flex-none items-center justify-center gap-1.5 rounded-full px-2.5 sm:px-3.5"
                onClick={onLeave}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="hidden sm:inline">Leave</span>
              </button>
            )}
          </>
        )}
      </div>
      </div>
      </div>

      <MessageList
        items={items}
        loading={historyLoading}
        meId={meId}
        quotedFor={quotedFor}
        onReply={(message) => {
          onReply(message);
          composer.current?.focus();
        }}
        onReact={onReact}
        onDeleteForEveryone={onDeleteForEveryone}
        onHideForMe={onHideForMe}
        onOpenImage={onOpenImage}
        onBackgroundTap={() => composer.current?.blur()}
        onScrollDirection={setHeadCollapsed}
      />

      {replyingTo && (
        <div
          id="replyBar"
          className="mx-5 mb-2 flex items-center gap-3 rounded-xl border-l-[3px] px-3 py-2"
          style={{
            borderLeftColor: "var(--color-brand)",
            backgroundColor: "var(--color-surface-2)",
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold" style={{ color: "var(--color-brand)" }}>
              Replying to {replyingTo.senderId === meId ? "yourself" : "them"}
            </div>
            <div className="truncate text-[13px]" style={{ color: "var(--color-muted)" }}>
              {replyingTo.kind === "image" ? "Photo" : replyingTo.body}
            </div>
          </div>
          <button
            id="cancelReply"
            type="button"
            aria-label="Cancel reply"
            className="btn-ghost px-2.5 py-1 text-xs"
            onClick={onCancelReply}
          >
            ✕
          </button>
        </div>
      )}

      {ended ? (
        /* Only the way on. That it is over is said once, as a pill in the thread itself, and
           the modal this opens is already searching -- one press, not two. */
        <div
          id="endedPanel"
          className="flex justify-center border-t px-5 py-3.5"
          style={{ borderColor: "var(--color-line-soft)" }}
        >
          <button
            id="findSomeoneNext"
            type="button"
            className="btn-primary min-w-[190px]"
            onClick={findNext}
          >
            Find someone
          </button>
        </div>
      ) : (
        /* Laid out the way every phone chat app is: a box that takes the whole width with the
           two attachment buttons inside it, and a round send beside it. The paperclip used to
           sit outside the box, which cost it that button's width plus a gap on the narrowest
           screen there is -- for a control that belongs to the message being written. */
        <div
          className="flex items-end gap-1.5 border-t px-2.5 py-2.5 sm:gap-2 sm:px-5 sm:py-3.5"
          style={{ borderColor: "var(--color-line-soft)" }}
        >
          <input
            id="imageInput"
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) onChooseImage(chosen);
              event.target.value = "";
            }}
          />
          <div className="field composer flex min-w-0 flex-1 items-end gap-0.5 rounded-[22px] py-0 pr-1 pl-4">
            {/* A textarea, not an <input>. iOS offers its password / card / address AutoFill
                bar above the keyboard for any text input it cannot rule out as part of a form,
                and it ignores autocomplete="off" when deciding. It never offers it for a
                textarea -- which is also what lets a message have more than one line. */}
            <textarea
              id="composer"
              ref={composer}
              rows={1}
              className="block max-h-[132px] min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2.5 leading-5 outline-none focus-visible:outline-none"
              placeholder="Say something"
              autoComplete="off"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                onTyping();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancelReply();
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                // A phone's return key starts a new line, as it does in every messaging app
                // there; the round button sends. A keyboard's Enter sends.
                if (window.matchMedia("(pointer: coarse)").matches) return;
                event.preventDefault();
                submit();
              }}
            />
            <button
              id="attach"
              type="button"
              className="btn-icon mb-0.5 h-9 w-9"
              title="Attach an image"
              aria-label="Attach an image"
              onClick={() => file.current?.click()}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
              </svg>
            </button>
            <button
              id="camera"
              type="button"
              className="btn-icon mb-0.5 h-9 w-9"
              title="Take a photo"
              aria-label="Take a photo"
              onClick={onOpenCamera}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
                <circle cx="12" cy="12.8" r="3.4" />
              </svg>
            </button>
          </div>
          <button
            id="send"
            type="button"
            title="Send"
            aria-label="Send"
            // Kept from stealing focus, so tapping it on a phone does not drop the keyboard
            // between one message and the next.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              submit();
              composer.current?.focus();
            }}
            className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full transition active:translate-y-px"
            style={{
              backgroundImage: "var(--gradient-brand)",
              color: "var(--color-on-brand)",
              opacity: draft.trim() ? 1 : 0.55,
            }}
          >
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21.2 12.8a.9.9 0 0 0 0-1.6L3.4 3.6a.9.9 0 0 0-1.25 1.06L4.3 11.2a.9.9 0 0 0 .78.62l7.42.68-7.42.68a.9.9 0 0 0-.78.62l-2.15 6.54a.9.9 0 0 0 1.25 1.06Z" />
            </svg>
          </button>
        </div>
      )}

      {picking &&
        createPortal(
          <div
            id="findSomeoneModal"
            className="fixed inset-0 z-50 grid grid-cols-1 place-items-center overflow-y-auto p-3 backdrop-blur-[3px] sm:p-5"
            style={{ backgroundColor: "var(--color-scrim)" }}
            onClick={(event) => {
              if (event.target === event.currentTarget) closePicker();
            }}
          >
            <div role="dialog" aria-modal="true" className="panel rise w-full max-w-[620px] p-4 sm:p-7">
              <div className="mb-1 flex justify-end">
                <button
                  type="button"
                  aria-label="Close"
                  className="btn-ghost px-3"
                  onClick={closePicker}
                >
                  ✕
                </button>
              </div>
              {setupPanel}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

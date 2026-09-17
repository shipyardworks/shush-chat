"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatItem, Message } from "@/lib/types";
import type { Peer } from "@/lib/useShush";
import { Avatar } from "./Avatar";
import { MessageList } from "./MessageList";

export const ChatPanel = ({
  peer,
  items,
  meId,
  typing,
  isFriendConversation,
  ended,
  friendRequestSent,
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
  friendRequestSent: boolean;
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
  /** Phone only -- returns to the sidebar list without closing the conversation underneath it. */
  onBack?: () => void;
  setupPanel: React.ReactNode;
}) => {
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLInputElement>(null);

  const submit = () => {
    onSend(draft);
    setDraft("");
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

  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking]);

  return (
    <div id="chat" className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex items-center gap-2 border-b px-3.5 py-3.5 sm:gap-3 sm:px-[22px]"
        style={{ borderColor: "var(--color-line-soft)" }}
      >
        {onBack && (
          <button
            id="chatBack"
            type="button"
            aria-label="Back to chats"
            onClick={onBack}
            className="btn-ghost -ml-1 grid h-9 w-9 flex-none place-items-center rounded-full p-0 sm:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
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
              this line would say anyway (online/offline/stranger/shared interests). One line of
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
                finished stranger conversation is still for. Icon-only on phone -- two full-text
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
              <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
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

      <MessageList
        items={items}
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
        /* No composer, because there is nothing to send into. Picking who's next used to be
           inlined right here, which put a whole scrolling picker in the middle of a finished
           conversation -- a page seguing into a different screen without ever saying so. A
           modal says so: the thread is still there underneath it, waiting, if this is closed. */
        <div
          id="endedPanel"
          className="flex flex-wrap items-center gap-3 border-t px-5 py-4"
          style={{ borderColor: "var(--color-line-soft)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--color-muted)" }}>
            This conversation is over.
          </span>
          <button
            id="findSomeoneNext"
            type="button"
            className="btn-primary"
            onClick={() => setPicking(true)}
          >
            Find someone new
          </button>
        </div>
      ) : (
      <div
        className="flex items-center gap-2.5 border-t px-5 py-3.5"
        style={{ borderColor: "var(--color-line-soft)" }}
      >
        <button
          id="attach"
          type="button"
          className="btn-ghost grid h-10 w-10 place-items-center rounded-full p-0"
          title="Attach an image"
          aria-label="Attach an image"
          onClick={() => file.current?.click()}
        >
          {/* A paperclip. "Image" as a word took the space of a control and read as a label. */}
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
          </svg>
        </button>
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
        <button
          id="camera"
          type="button"
          className="btn-ghost grid h-10 w-10 place-items-center rounded-full p-0"
          title="Take a photo"
          aria-label="Take a photo"
          onClick={onOpenCamera}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
            <circle cx="12" cy="12.8" r="3.4" />
          </svg>
        </button>
        <input
          id="composer"
          ref={composer}
          type="text"
          className="field flex-1"
          placeholder="Say something"
          autoComplete="off"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onTyping();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") onCancelReply();
          }}
        />
        <button id="send" type="button" className="btn-primary" onClick={submit}>
          Send
        </button>
      </div>
      )}

      {picking &&
        createPortal(
          <div
            id="findSomeoneModal"
            className="fixed inset-0 z-50 grid place-items-center p-5 backdrop-blur-[3px]"
            style={{ backgroundColor: "rgb(4 5 9 / 0.62)" }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setPicking(false);
            }}
          >
            <div role="dialog" aria-modal="true" className="panel rise w-full max-w-[620px] p-7">
              <div className="mb-1 flex justify-end">
                <button
                  type="button"
                  aria-label="Close"
                  className="btn-ghost px-3"
                  onClick={() => setPicking(false)}
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

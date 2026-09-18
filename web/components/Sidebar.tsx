"use client";

import { useState } from "react";
import type { Conversation, Friend, Session } from "@/lib/types";
import { Avatar } from "./Avatar";
import { SaveAccount } from "./SaveAccount";
import { Skeleton } from "./Skeleton";

type Tab = "chats" | "friends";

export const Sidebar = ({
  session,
  friends,
  conversations,
  loading,
  openConversationId,
  chatOnScreen,
  hiddenOnPhone,
  onOpenFriend,
  onOpenConversation,
  onFindSomeone,
  onLogout,
  onSaveAccount,
}: {
  session: Session;
  friends: Friend[];
  conversations: Conversation[];
  loading: boolean;
  openConversationId: string | null;
  chatOnScreen: boolean;
  /** Below the phone breakpoint, slid off-screen (as a drawer, not display:none) while a chat
   *  or the setup panel is open. */
  hiddenOnPhone?: boolean;
  onOpenFriend: (friend: Friend) => void;
  onOpenConversation: (conversation: Conversation) => void;
  onFindSomeone: () => void;
  onLogout: () => void;
  onSaveAccount: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
}) => {
  const [tab, setTab] = useState<Tab>("chats");

  return (
    <aside
      id="sidebar"
      /* Below sm this is a drawer over the chat behind it, not a separate full-screen page --
         it only covers ~78% so the sliver (plus the backdrop in page.tsx) stays tappable to
         dismiss it. sm and up: back to a normal static grid column, same as before. */
      className={`absolute inset-y-0 left-0 z-30 flex w-[78%] max-w-[340px] min-h-0 flex-col border-r shadow-xl transition-transform duration-200 ease-out sm:static sm:inset-auto sm:z-auto sm:w-auto sm:max-w-none sm:translate-x-0 sm:shadow-none sm:transition-none ${
        hiddenOnPhone ? "-translate-x-full pointer-events-none sm:pointer-events-auto" : "translate-x-0"
      }`}
      style={{ borderColor: "var(--color-line-soft)", backgroundColor: "var(--color-ink)" }}
    >
      <div className="flex-none p-4 pb-3">
        {/* A segmented control, not two independent buttons: exactly one of these is ever
            true, and looking like a single switch says that at a glance. */}
        <div
          className="grid grid-cols-2 gap-1 rounded-full p-1"
          style={{ backgroundColor: "var(--color-surface-2)" }}
        >
          <button
            id="tabChats"
            type="button"
            aria-pressed={tab === "chats"}
            onClick={() => setTab("chats")}
            className="rounded-full py-1.5 text-sm font-medium transition"
            style={
              tab === "chats"
                ? {
                    background: "var(--gradient-brand)",
                    color: "var(--color-on-brand)",
                  }
                : { color: "var(--color-muted)" }
            }
          >
            Chats
          </button>
          <button
            id="tabFriends"
            type="button"
            aria-pressed={tab === "friends"}
            onClick={() => setTab("friends")}
            className="rounded-full py-1.5 text-sm font-medium transition"
            style={
              tab === "friends"
                ? {
                    background: "var(--gradient-brand)",
                    color: "var(--color-on-brand)",
                  }
                : { color: "var(--color-muted)" }
            }
          >
            Friends
          </button>
        </div>

        <button
          id="newChat"
          type="button"
          className="btn-primary mt-3 w-full"
          onClick={onFindSomeone}
        >
          Find someone
        </button>
      </div>

      {/* Only this scrolls. The tabs above and the account box below stay put -- a list that
          is any length should never be able to push it off the bottom. */}
      <div className="scroll-elegant min-h-0 flex-1 overflow-y-auto px-4">
        {loading ? (
          <Skeleton />
        ) : tab === "chats" ? (
          <ul id="chats" className="m-0 flex list-none flex-col gap-1 p-0">
            {conversations.map((conversation) => {
              const onScreenNow = chatOnScreen && conversation.id === openConversationId;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    data-testid="chat"
                    data-conversation-id={conversation.id}
                    aria-current={conversation.id === openConversationId}
                    onClick={() => onOpenConversation(conversation)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left transition hover:border-[var(--color-line-soft)] hover:bg-[var(--color-surface-2)] aria-[current=true]:border-[var(--color-brand)] aria-[current=true]:bg-[var(--color-surface-2)]"
                  >
                    <Avatar id={conversation.peerId} name={conversation.peerName} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {conversation.peerName ?? "Someone"}
                      </span>
                      <span className="block truncate text-xs" style={{ color: "var(--color-faint)" }}>
                        {conversation.lastMessage
                          ? `${conversation.lastFromMe ? "You: " : ""}${conversation.lastMessage}`
                          : "Nothing said yet"}
                      </span>
                    </span>
                    {conversation.unreadCount > 0 && !onScreenNow && (
                      <span
                        data-testid="chatUnread"
                        className="badge"
                      >
                        {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {conversations.length === 0 && (
              <p id="noChats" className="mt-2 text-[13px]" style={{ color: "var(--color-faint)" }}>
                Nothing yet. Every conversation you have shows up here.
              </p>
            )}
          </ul>
        ) : (
          <ul id="friends" className="m-0 flex list-none flex-col gap-1 p-0">
            {friends.map((friend) => {
              // Hidden only while that conversation is actually on screen. "The open one" is
              // not the same as "the last one opened" -- after going home the thread is still
              // selected, and hiding the badge on that basis hides the count you came back for.
              const onScreenNow = chatOnScreen && friend.conversationId === openConversationId;
              return (
                <li key={friend.userId}>
                  <button
                    type="button"
                    data-testid="friend"
                    aria-current={friend.conversationId === openConversationId}
                    onClick={() => onOpenFriend(friend)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left transition hover:border-[var(--color-line-soft)] hover:bg-[var(--color-surface-2)] aria-[current=true]:border-[var(--color-brand)] aria-[current=true]:bg-[var(--color-surface-2)]"
                  >
                    <Avatar id={friend.userId} name={friend.displayName} online={friend.online} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {friend.displayName ?? "Someone"}
                      </span>
                      <span className="block text-xs" style={{ color: "var(--color-faint)" }}>
                        {friend.online ? "Online" : "Offline"}
                      </span>
                    </span>
                    {friend.unreadCount > 0 && !onScreenNow && (
                      <span
                        data-testid="unread"
                        className="badge"
                      >
                        {friend.unreadCount > 99 ? "99+" : friend.unreadCount}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {friends.length === 0 && (
              <p id="noFriends" className="mt-2 text-[13px]" style={{ color: "var(--color-faint)" }}>
                Nobody yet. Keep someone you enjoyed talking to.
              </p>
            )}
          </ul>
        )}
      </div>

      {session.user.anonymous && <SaveAccount onSave={onSaveAccount} />}

      {!session.user.anonymous && (
        <div
          id="accountBox"
          className="flex-none border-t p-2.5 sm:p-4"
          style={{ borderColor: "var(--color-line-soft)" }}
        >
          <h2 className="section-label">Signed in</h2>
          <p
            id="myEmail"
            className="mb-2.5 truncate text-[13px]"
            style={{ color: "var(--color-body)" }}
          >
            {session.user.email}
          </p>
          <button id="logout" type="button" className="btn-ghost w-full" onClick={onLogout}>
            Log out
          </button>
        </div>
      )}
    </aside>
  );
};

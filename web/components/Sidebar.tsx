"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Conversation, Friend, Session } from "@/lib/types";
import { Avatar } from "./Avatar";

type Tab = "chats" | "friends";

export const Sidebar = ({
  session,
  friends,
  conversations,
  openConversationId,
  chatOnScreen,
  onOpenFriend,
  onOpenConversation,
  onFindSomeone,
}: {
  session: Session;
  friends: Friend[];
  conversations: Conversation[];
  openConversationId: string | null;
  chatOnScreen: boolean;
  onOpenFriend: (friend: Friend) => void;
  onOpenConversation: (conversation: Conversation) => void;
  onFindSomeone: () => void;
}) => {
  const [tab, setTab] = useState<Tab>("chats");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  const save = async () => {
    const response = await api.signup(email, password);
    if (!response.ok) {
      setSaveStatus(((await response.json()) as { message: string }).message);
      return;
    }
    setSaveStatus("Saved. Nothing reset — same name, same friends.");
  };

  return (
    <aside
      id="sidebar"
      className="flex min-h-0 flex-col border-r"
      style={{ borderColor: "var(--color-line-soft)" }}
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
                    background: "linear-gradient(135deg, var(--color-brand), var(--color-brand-2))",
                    color: "#fff",
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
                    background: "linear-gradient(135deg, var(--color-brand), var(--color-brand-2))",
                    color: "#fff",
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
          Find someone new
        </button>
      </div>

      {/* Only this scrolls. The tabs above and the account box below stay put -- a list that
          is any length should never be able to push "Save your account" off the bottom. */}
      <div className="scroll-elegant min-h-0 flex-1 overflow-y-auto px-4">
        {tab === "chats" ? (
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
                        className="grid h-5 min-w-5 flex-none place-items-center rounded-full px-1.5 text-[11px] font-bold text-white"
                        style={{ background: "linear-gradient(135deg, var(--color-brand), var(--color-brand-2))" }}
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
                Nothing yet. Every conversation shows up here, friend or stranger.
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
                        className="grid h-5 min-w-5 flex-none place-items-center rounded-full px-1.5 text-[11px] font-bold text-white"
                        style={{ background: "linear-gradient(135deg, var(--color-brand), var(--color-brand-2))" }}
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

      {session.user.anonymous && (
        <div
          id="saveBox"
          className="flex-none border-t p-4"
          style={{ borderColor: "var(--color-line-soft)" }}
        >
          <h2 className="section-label">Save your account</h2>
          <p className="mb-2.5 text-[13px]" style={{ color: "var(--color-faint)" }}>
            This browser is the only way back in.
          </p>
          <div className="flex flex-col gap-2">
            <input
              id="email"
              type="email"
              className="field"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              id="password"
              type="password"
              className="field"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button id="saveAccount" type="button" className="btn" onClick={save}>
              Save
            </button>
            {saveStatus && (
              <span className="text-[13px]" style={{ color: "var(--color-faint)" }}>
                {saveStatus}
              </span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

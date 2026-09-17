export type Interest = { id: number; label: string };

export type User = { id: string; displayName: string; anonymous: boolean; email: string | null };

export type Session = { token?: string; jwt: string; user: User };

export type Friend = {
  userId: string;
  displayName: string | null;
  conversationId: string;
  online: boolean;
  lastSeenAt: string | null;
  unreadCount: number;
};

export type FriendRequest = {
  id: string;
  conversationId: string;
  fromUserId: string;
  fromDisplayName: string | null;
  toUserId: string;
  status: string;
  expiresAt: string;
};

export type Reaction = { userId: string; emoji: string };

export type Message = {
  id?: string;
  conversationId: string;
  senderId: string;
  seq: number | null;
  kind: "text" | "image";
  body: string | null;
  mediaKey: string | null;
  clientMsgId: string | null;
  createdAt: string | number;
  /** The seq this replies to, in the same conversation. */
  replyToSeq?: number | null;
  /** Deleted for everyone. The row and its seq survive; the words do not. */
  deleted?: boolean;
  reactions?: Reaction[];
};

/** One row of the history list: every conversation, friends and strangers alike. */
export type Conversation = {
  id: string;
  kind: "stranger" | "friend";
  state: string;
  unreadCount: number;
  peerId: string;
  peerName: string | null;
  lastMessage: string | null;
  lastFromMe: boolean;
  lastAt: string | null;
};

/** How far a message has got, in the order it gets there. "failed" is terminal, not a step. */
export type Delivery = "pending" | "sent" | "delivered" | "read" | "failed";

export type ChatItem =
  | { kind: "message"; message: Message; delivery: Delivery }
  | { kind: "event"; id: string; text: string }
  | { kind: "day"; id: string; label: string };

/** Frames the server sends. Only the ones this client acts on are named. */
export type ServerFrame = {
  type: string;
  [key: string]: unknown;
};

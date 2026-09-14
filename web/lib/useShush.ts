"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, setBearer } from "./api";
import { socketUrl } from "./config";
import { newId } from "./ids";
import { dayKey, dayLabel } from "./time";
import type {
  ChatItem,
  Conversation,
  Delivery,
  Friend,
  FriendRequest,
  Interest,
  Message,
  Reaction,
  Session,
} from "./types";

const DEVICE_TOKEN = "shush.deviceToken";

const remember = (token: string) => {
  try {
    localStorage.setItem(DEVICE_TOKEN, token);
  } catch {
    // Private browsing. The account still exists; this browser just will not remember it.
  }
};

const remembered = () => {
  try {
    return localStorage.getItem(DEVICE_TOKEN);
  } catch {
    return null;
  }
};

/** Delivery only ever moves forward: a redelivered frame must not turn a read tick grey. */
const RANK: Record<Delivery, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
const furthest = (a: Delivery, b: Delivery) => (RANK[b] > RANK[a] ? b : a);

export type Peer = { userId: string | null; name: string | null; heading: string; sub: string };

export type Attachment = { file: File; previewUrl: string };

export const useShush = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<"setup" | "chat">("setup");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [interests, setInterests] = useState<{ suggested: Interest[]; all: Interest[] }>({
    suggested: [],
    all: [],
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [patience, setPatience] = useState(5);
  const [findStatus, setFindStatus] = useState("");
  const [typing, setTyping] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [peer, setPeer] = useState<Peer>({ userId: null, name: null, heading: "", sub: "" });
  const [isFriendConversation, setIsFriendConversation] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // Somebody walked out. The server decides this and says so in a frame; the client never
  // assumes it, which is exactly what went wrong when one side printed "You left" on its own.
  const [ended, setEnded] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const seen = useRef(new Set<number>());
  const lastDay = useRef<string | null>(null);
  const peerReadSeq = useRef(0);
  const conversationRef = useRef<string | null>(null);
  const viewRef = useRef<"setup" | "chat">("setup");
  const typingSentAt = useRef(0);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendsRef = useRef<Friend[]>([]);
  const meRef = useRef<string | null>(null);
  // Client ids drawn optimistically and not yet confirmed. A ref, not state, because the
  // decision "patch or append" is made while handling a frame and cannot wait for a render.
  const optimistic = useRef(new Set<string>());

  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);
  useEffect(() => {
    meRef.current = session?.user.id ?? null;
  }, [session]);

  const send = useCallback((frame: Record<string, unknown>) => {
    socket.current?.send(JSON.stringify(frame));
  }, []);

  const reloadFriends = useCallback(async () => {
    try {
      setFriends(await api.friends());
    } catch {
      // A failed refresh leaves the list as it was, which beats emptying it.
    }
  }, []);

  const reloadRequests = useCallback(async () => {
    try {
      setRequests(await api.friendRequests());
    } catch {
      /* as above */
    }
  }, []);

  const reloadConversations = useCallback(async () => {
    try {
      setConversations(await api.conversations());
    } catch {
      /* as above */
    }
  }, []);

  const refreshLists = useCallback(async () => {
    await Promise.all([reloadFriends(), reloadConversations()]);
  }, [reloadConversations, reloadFriends]);

  /**
   * Keeps the sidebar preview current without a request per message.
   *
   * <p>The lists are re-read when something happens to them, which leaves the row for the
   * conversation you are actually looking at showing whatever it said when you signed in --
   * "Nothing said yet" under a thread you are in the middle of.
   */
  const previewLocally = useCallback((message: Message, mine: boolean) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === message.conversationId
          ? {
              ...conversation,
              lastMessage: message.kind === "image" ? "Photo" : message.body,
              lastFromMe: mine,
              lastAt: new Date(message.createdAt).toISOString(),
            }
          : conversation,
      ),
    );
  }, []);

  /** Adds a day separator when the calendar day changes, then the message itself. */
  const appendMessage = useCallback((message: Message, delivery: Delivery) => {
    setItems((current) => {
      const next = [...current];
      const key = dayKey(message.createdAt);
      if (key !== lastDay.current) {
        lastDay.current = key;
        next.push({ kind: "day", id: `day-${key}`, label: dayLabel(message.createdAt) });
      }
      next.push({ kind: "message", message, delivery });
      return next;
    });
  }, []);

  const appendEvent = useCallback((text: string) => {
    setItems((current) => [...current, { kind: "event", id: newId(), text }]);
  }, []);

  /** Replaces one message wherever it is, matched by seq or by the id the client made. */
  const patchMessage = useCallback(
    (
      match: { seq?: number | null; clientMsgId?: string | null },
      change: (item: Extract<ChatItem, { kind: "message" }>) => Extract<ChatItem, { kind: "message" }>,
    ) => {
      setItems((current) =>
        current.map((item) => {
          if (item.kind !== "message") return item;
          const bySeq = match.seq != null && item.message.seq === match.seq;
          const byClient =
            match.clientMsgId != null && item.message.clientMsgId === match.clientMsgId;
          return bySeq || byClient ? change(item) : item;
        }),
      );
    },
    [],
  );

  const openConversation = useCallback((id: string, next: Peer, friendConversation: boolean) => {
    seen.current = new Set();
    optimistic.current = new Set();
    lastDay.current = null;
    peerReadSeq.current = 0;
    setItems([]);
    setConversationId(id);
    conversationRef.current = id;
    setPeer(next);
    setIsFriendConversation(friendConversation);
    setReplyingTo(null);
    setEnded(false);
    setView("chat");
    viewRef.current = "chat";
    setFindStatus("");
    setTyping(false);
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  /* ---------- frames ---------- */

  const onFrame = useCallback(
    (frame: Record<string, unknown>) => {
      const type = String(frame.type);

      if (type === "hello") {
        // Which node picked up the socket. Not shown to anyone -- it was a debugging aid, not
        // something a person using the product has a reason to see.
        return;
      }

      if (type === "matched") {
        const shared = (frame.sharedInterestIds as number[] | null) ?? [];
        const labels = shared
          .map((id) => interests.all.find((i) => i.id === id)?.label)
          .filter(Boolean);
        openConversation(
          String(frame.conversationId),
          {
            userId: String(frame.withUserId),
            name: (frame.withDisplayName as string | null) ?? null,
            // Their name heads the conversation; why you were put together is the subtitle.
            // "A stranger" is not a name, it is the app declining to say who this is.
            heading: (frame.withDisplayName as string | null) ?? "Someone",
            sub: frame.randomMatch
              ? "A random match — nobody sharing your interests was around"
              : `You both like ${labels.join(" and ")}`,
          },
          false,
        );
        void refreshLists();
        return;
      }

      if (type === "ack") {
        const clientMsgId = String(frame.clientMsgId);
        const reached: Delivery = frame.status === "delivered" ? "delivered" : "sent";
        patchMessage({ clientMsgId }, (item) => ({
          ...item,
          delivery: furthest(item.delivery, reached),
          message: { ...item.message, seq: (frame.seq as number | null) ?? item.message.seq },
        }));
        return;
      }

      if (type === "message") {
        // The frame names it messageId; the history endpoint names it id, and every action on
        // a message addresses it by id. Normalising here rather than at each use is what stops
        // "react to a message you just received" silently doing nothing.
        const message = { ...frame, id: String(frame.messageId) } as unknown as Message;
        const mine = message.senderId === meRef.current;
        const onScreen =
          viewRef.current === "chat" && message.conversationId === conversationRef.current;

        if (!onScreen) {
          // Waiting for you rather than lost: the server keeps the count and the history load
          // draws it when that thread is opened.
          void refreshLists();
          return;
        }

        if (message.seq !== null && seen.current.has(message.seq)) {
          return;
        }
        if (message.seq !== null) seen.current.add(message.seq);

        previewLocally(message, mine);
        if (mine) {
          const delivery: Delivery =
            (message.seq ?? 0) <= peerReadSeq.current ? "read" : "delivered";
          const clientMsgId = message.clientMsgId ?? "";

          // Whether a bubble is already on screen has to be decided here and now. Asking a
          // setItems updater to report it does not work: the updater runs at render time, so
          // the answer arrives after the decision that needed it -- which drew every one of
          // your own messages twice, once patched and once appended.
          if (optimistic.current.delete(clientMsgId)) {
            patchMessage({ clientMsgId }, (item) => ({
              kind: "message",
              message: { ...message, reactions: item.message.reactions ?? [] },
              delivery: furthest(item.delivery, delivery),
            }));
          } else {
            // Images are not drawn optimistically -- there is nothing to show until the upload
            // finishes -- so this is the path every image of your own takes.
            appendMessage(message, delivery);
          }
          return;
        }

        appendMessage(message, "delivered");
        send({ type: "read", conversationId: message.conversationId, seq: message.seq });
        return;
      }

      if (type === "reaction") {
        if (String(frame.conversationId) !== conversationRef.current) return;
        const userId = String(frame.userId);
        const emoji = (frame.emoji as string | null) ?? null;
        patchMessage({ seq: Number(frame.seq) }, (item) => {
          const others = (item.message.reactions ?? []).filter(
            (reaction) => reaction.userId !== userId,
          );
          return {
            ...item,
            message: {
              ...item.message,
              reactions: emoji ? [...others, { userId, emoji }] : others,
            },
          };
        });
        return;
      }

      if (type === "deleted") {
        if (String(frame.conversationId) !== conversationRef.current) return;
        patchMessage({ seq: Number(frame.seq) }, (item) => ({
          ...item,
          message: {
            ...item.message,
            deleted: true,
            body: null,
            mediaKey: null,
            reactions: [],
          },
        }));
        void refreshLists();
        return;
      }

      if (type === "typing") {
        setTyping(true);
        setTimeout(() => setTyping(false), 4000);
        return;
      }

      if (type === "read") {
        const seq = Number(frame.seq);
        peerReadSeq.current = Math.max(peerReadSeq.current, seq);
        setItems((current) =>
          current.map((item) =>
            item.kind === "message" &&
            item.message.senderId === meRef.current &&
            (item.message.seq ?? Number.MAX_SAFE_INTEGER) <= peerReadSeq.current
              ? { ...item, delivery: furthest(item.delivery, "read") }
              : item,
          ),
        );
        return;
      }

      if (type === "presence") {
        appendEvent(
          frame.online
            ? "They are back."
            : "They have gone offline. Anything you send will reach them when they return.",
        );
        void refreshLists();
        return;
      }

      if (type === "left") {
        // Scoped to the conversation it belongs to. Without this a leave in one thread printed
        // itself into whichever thread happened to be open.
        if (String(frame.conversationId) !== conversationRef.current) {
          void refreshLists();
          return;
        }
        setEnded(true);
        appendEvent(
          String(frame.userId) === meRef.current
            ? "You left. This conversation is over."
            : "They have left. This conversation is over.",
        );
        void refreshLists();
        return;
      }

      if (type === "friendRequested") {
        void reloadRequests();
        return;
      }

      if (type === "friendRequestAccepted") {
        appendEvent("They kept you. They are in your friends list now.");
        void refreshLists();
        return;
      }

      if (type === "error") {
        appendEvent(`Something went wrong: ${String(frame.message)}`);
      }
    },
    [
      appendEvent,
      appendMessage,
      interests.all,
      openConversation,
      patchMessage,
      previewLocally,
      refreshLists,
      reloadRequests,
      send,
    ],
  );

  const frameHandler = useRef(onFrame);
  useEffect(() => {
    frameHandler.current = onFrame;
  }, [onFrame]);

  /* ---------- sign in, once ---------- */

  const started = useRef(false);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;

    const token = remembered();
    let next: Session | null = null;
    if (token) {
      next = await api.resumeDevice(token).catch(() => null);
    }
    if (!next) {
      next = await api.anonymous();
    }
    setBearer(next.jwt);
    if (next.token) remember(next.token);
    setSession(next);
    meRef.current = next.user.id;

    const catalogue = await api.interests();
    setInterests({ suggested: catalogue.suggested, all: catalogue.all });
    setSelected(catalogue.fromHistory ? catalogue.suggested.map((i) => i.id) : []);

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(socketUrl(next.jwt));
      ws.addEventListener("message", (event) =>
        frameHandler.current(JSON.parse(event.data as string)),
      );
      ws.addEventListener("open", () => resolve());
      socket.current = ws;
    });

    // All three before anything can be pushed, so a request or a chat that was already waiting
    // is on screen from the moment you sign in.
    await Promise.all([reloadFriends(), reloadRequests(), reloadConversations()]);
  }, [reloadConversations, reloadFriends, reloadRequests]);

  useEffect(() => {
    void start();
    return () => socket.current?.close();
  }, [start]);

  /* ---------- opening a conversation ---------- */

  const openThread = useCallback(
    async (thread: {
      conversationId: string;
      peerId: string | null;
      peerName: string | null;
      online?: boolean;
      isFriend: boolean;
    }) => {
      openConversation(
        thread.conversationId,
        {
          userId: thread.peerId,
          name: thread.peerName,
          heading: thread.peerName ?? "Someone",
          sub: thread.isFriend ? (thread.online ? "Online" : "Offline") : "A stranger you talked to",
        },
        thread.isFriend,
      );

      // How far they have read, before any history is drawn -- otherwise the whole backlog
      // renders grey and only goes blue if they happen to read something new.
      const conversation = await api.conversation(thread.conversationId).catch(() => null);
      peerReadSeq.current = Math.max(
        0,
        ...(conversation?.others ?? []).map((other) => other.readCursorSeq ?? 0),
        0,
      );

      const history = await api.history(thread.conversationId).catch(() => null);
      if (!history) {
        appendEvent("That conversation could not be opened.");
        return;
      }
      // Oldest first already: the service walks the index backwards to build the page and
      // re-sorts ascending before returning it.
      history.messages.forEach((message) => {
        if (message.seq !== null) seen.current.add(message.seq);
        const mine = message.senderId === meRef.current;
        appendMessage(
          message,
          mine && (message.seq ?? 0) <= peerReadSeq.current ? "read" : "delivered",
        );
      });
      if (!history.messages.length) {
        appendEvent("Nothing here yet. Say something.");
      }
      const newest = history.messages[history.messages.length - 1];
      if (newest) {
        send({ type: "read", conversationId: thread.conversationId, seq: newest.seq });
      }
      await refreshLists();
    },
    [appendEvent, appendMessage, openConversation, refreshLists, send],
  );

  const openFriend = useCallback(
    (friend: Friend) =>
      openThread({
        conversationId: friend.conversationId,
        peerId: friend.userId,
        peerName: friend.displayName,
        online: friend.online,
        isFriend: true,
      }),
    [openThread],
  );

  const openConversationFromHistory = useCallback(
    (conversation: Conversation) =>
      openThread({
        conversationId: conversation.id,
        peerId: conversation.peerId,
        peerName: conversation.peerName,
        online: friendsRef.current.find((f) => f.userId === conversation.peerId)?.online,
        isFriend: conversation.kind === "friend",
      }),
    [openThread],
  );

  /* ---------- sending ---------- */

  const findSomeone = useCallback(async () => {
    setFindStatus("Looking…");
    await api.saveInterests(selected);
    send({ type: "find", interestIds: selected, patience });
    if (hintTimer.current) clearTimeout(hintTimer.current);
    // Matching skips anyone already a friend, so with a few friends and nobody else waiting it
    // looks exactly like a broken matcher. Say so rather than spin forever.
    hintTimer.current = setTimeout(() => {
      setFindStatus(
        friendsRef.current.length
          ? "Still looking. People you are already friends with are skipped — you can message them from the list, or remove one from their profile."
          : "Still looking. Nobody sharing your interests is here right now.",
      );
    }, 12_000);
  }, [patience, selected, send]);

  const sendMessage = useCallback(
    (body: string) => {
      const text = body.trim();
      if (!text || !conversationId || ended) return;
      const clientMsgId = newId();
      const replyToSeq = replyingTo?.seq ?? null;
      optimistic.current.add(clientMsgId);
      // On screen immediately with no seq: that is what a single tick means.
      appendMessage(
        {
          conversationId,
          senderId: meRef.current!,
          seq: null,
          kind: "text",
          body: text,
          mediaKey: null,
          clientMsgId,
          createdAt: Date.now(),
          replyToSeq,
          deleted: false,
          reactions: [],
        },
        "pending",
      );
      send({ type: "send", conversationId, clientMsgId, kind: "text", body: text, replyToSeq });
      setReplyingTo(null);
    },
    [appendMessage, conversationId, ended, replyingTo, send],
  );

  /** Chosen but not sent: the preview is what turns picking a file into a decision. */
  const chooseAttachment = useCallback((file: File) => {
    setAttachment({ file, previewUrl: URL.createObjectURL(file) });
  }, []);

  const clearAttachment = useCallback(() => {
    setAttachment((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, []);

  const sendAttachment = useCallback(
    async (caption: string) => {
      if (!attachment || !conversationId || ended) return;
      const { file } = attachment;
      clearAttachment();

      const issued = await api.uploadUrl(conversationId, file.type, file.size);
      if (!issued.ok) {
        appendEvent(`That image was refused: ${await issued.text()}`);
        return;
      }
      const upload = (await issued.json()) as { key: string; uploadUrl: string };
      // Reported rather than swallowed: this PUT goes to object storage, not to the API, so
      // when it fails the server has nothing to log and the image just never appears.
      try {
        const stored = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!stored.ok) {
          appendEvent(`That image could not be stored (${stored.status}).`);
          return;
        }
      } catch {
        appendEvent("Could not reach image storage from this browser.");
        return;
      }

      const replyToSeq = replyingTo?.seq ?? null;
      send({
        type: "send",
        conversationId,
        clientMsgId: newId(),
        kind: "image",
        mediaKey: upload.key,
        replyToSeq,
      });
      const text = caption.trim();
      if (text) {
        const captionId = newId();
        send({ type: "send", conversationId, clientMsgId: captionId, kind: "text", body: text });
      }
      setReplyingTo(null);
    },
    [appendEvent, attachment, clearAttachment, conversationId, ended, replyingTo, send],
  );

  /* ---------- acting on one message ---------- */

  const react = useCallback(
    async (message: Message, emoji: string | null) => {
      if (!message.id || !meRef.current) return;
      const me = meRef.current;
      const already = (message.reactions ?? []).find((r) => r.userId === me);
      // Tapping the same one again takes it back, which is what people expect and what stops
      // a reaction being a thing you cannot undo.
      const next = already?.emoji === emoji ? null : emoji;

      // Optimistic: the frame comes back and confirms it.
      patchMessage({ seq: message.seq }, (item) => {
        const others = (item.message.reactions ?? []).filter((r) => r.userId !== me);
        return {
          ...item,
          message: {
            ...item.message,
            reactions: next ? [...others, { userId: me, emoji: next }] : others,
          },
        };
      });
      await api.react(message.id, next);
    },
    [patchMessage],
  );

  const deleteForEveryone = useCallback(
    async (message: Message) => {
      if (!message.id) return;
      const response = await api.deleteMessage(message.id);
      if (!response.ok) return;
      patchMessage({ seq: message.seq }, (item) => ({
        ...item,
        message: { ...item.message, deleted: true, body: null, mediaKey: null, reactions: [] },
      }));
    },
    [patchMessage],
  );

  const hideForMe = useCallback(async (message: Message) => {
    if (!message.id) return;
    const response = await api.hideMessage(message.id);
    if (!response.ok) return;
    // Gone, with no placeholder. "Delete for me" that leaves a visible hole is not deletion.
    setItems((current) =>
      current.filter((item) => !(item.kind === "message" && item.message.id === message.id)),
    );
  }, []);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    // Throttled here as well as at the server. One of these per keystroke is how this feature
    // takes a chat service down.
    if (conversationId && now - typingSentAt.current > 3000) {
      typingSentAt.current = now;
      send({ type: "typing", conversationId });
    }
  }, [conversationId, send]);

  const leave = useCallback(() => {
    if (!conversationId) return;
    // No optimistic line. The server answers with a `left` frame and both screens render from
    // that one fact -- saying "You left" here is how one side ended up sure of something the
    // other side had never been told.
    send({ type: "leave", conversationId });
  }, [conversationId, send]);

  const askToKeep = useCallback(async () => {
    if (!conversationId) return;
    const response = await api.askToKeep(conversationId);
    appendEvent(
      response.ok
        ? "Asked to keep them. You will hear back only if they say yes."
        : "You have already asked.",
    );
  }, [appendEvent, conversationId]);


  const removeFriend = useCallback(
    async (userId: string) => {
      const response = await api.unfriend(userId);
      if (!response.ok) return;
      await refreshLists();
      // Not thrown out of the conversation. Removing a friend ends the friendship, not the
      // history: they drop out of Friends and stay in Chats, and the thread on screen is still
      // a thread. Marking it "not a friend conversation" is what brings Add friend back, so
      // the whole thing is reversible from where you are standing.
      if (peer.userId === userId) {
        setIsFriendConversation(false);
        setPeer((current) => ({ ...current, sub: "A stranger you talked to" }));
      }
    },
    [peer.userId, refreshLists],
  );

  /**
   * Adds a tag to the shared list and selects it. It is a real interest the moment it exists --
   * the server hands back the same row for the same tag no matter who asks, which is what lets
   * two people who typed it separately be matched on it later.
   */
  const addInterest = useCallback(async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      const interest = await api.createInterest(trimmed);
      setInterests((current) =>
        current.all.some((one) => one.id === interest.id)
          ? current
          : { ...current, all: [...current.all, interest] },
      );
      setSelected((current) => (current.includes(interest.id) ? current : [...current, interest.id]));
    } catch {
      // Not worth a modal over. The tile simply does not appear, and typing it again retries.
    }
  }, []);

  const goHome = useCallback(() => {
    setView("setup");
    setFindStatus("");
    // The sidebar is only refreshed when something happens to it, and reading a conversation
    // is something that happened -- without this the chat list still shows the preview it had
    // when you signed in.
    void refreshLists();
  }, [refreshLists]);

  // A friend has a row under Friends already, so listing them again under Chats is the same
  // conversation in two places. Decided by who is currently a friend rather than by the
  // conversation's kind: kind is set when a friendship is made and never unset, so filtering on
  // it made an unfriended person vanish from both lists instead of moving between them.
  const strangerConversations = useMemo(() => {
    const friendIds = new Set(friends.map((friend) => friend.userId));
    return conversations.filter((conversation) => !friendIds.has(conversation.peerId));
  }, [conversations, friends]);

  const currentFriend = useMemo(
    () => friends.find((friend) => friend.userId === peer.userId) ?? null,
    [friends, peer.userId],
  );

  /** The quoted message a reply points at, when it is on screen. */
  const quotedFor = useCallback(
    (seq: number | null | undefined): Message | null => {
      if (seq == null) return null;
      const found = items.find((item) => item.kind === "message" && item.message.seq === seq);
      return found && found.kind === "message" ? found.message : null;
    },
    [items],
  );

  return {
    session,
    view,
    friends,
    requests,
    conversations: strangerConversations,
    interests,
    selected,
    setSelected,
    addInterest,
    patience,
    setPatience,
    findStatus,
    typing,
    items,
    conversationId,
    ended,
    peer,
    currentFriend,
    isFriendConversation,
    replyingTo,
    setReplyingTo,
    attachment,
    chooseAttachment,
    clearAttachment,
    sendAttachment,
    quotedFor,
    findSomeone,
    openFriend,
    openConversationFromHistory,
    sendMessage,
    react,
    deleteForEveryone,
    hideForMe,
    notifyTyping,
    leave,
    askToKeep,
    removeFriend,
    goHome,
    reloadFriends,
    reloadRequests,
    reloadConversations,
    refreshLists,
  };
};

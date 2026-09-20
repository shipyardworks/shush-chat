"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, setBearer } from "./api";
import { socketUrl } from "./config";
import { newId } from "./ids";
import { findByTag, normaliseTag } from "./interests";
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
const SELECTED_INTERESTS = "shush.selectedInterests";
const CUSTOM_INTERESTS = "shush.customInterests";

/**
 * What you had picked, kept by this browser rather than the server.
 *
 * <p>Matching still needs the ids sent with every `find`, so this changes nothing about how
 * matching works -- it only changes where "what did I pick last time" is remembered from, which
 * used to be a server-side guess (recent history) and is now simply what was still on screen.
 */
const rememberSelected = (ids: number[]) => {
  try {
    localStorage.setItem(SELECTED_INTERESTS, JSON.stringify(ids));
  } catch {
    // Private browsing, or the quota is gone. Selection just will not survive a reload.
  }
};

const rememberedSelected = (): number[] | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTED_INTERESTS) ?? "null");
    return Array.isArray(parsed) ? parsed.filter((one) => typeof one === "number") : null;
  } catch {
    return null;
  }
};

/**
 * A tag typed into "add interest", kept in this browser and nowhere else.
 *
 * <p>Matching needs a shared vocabulary (aim.md 4.3): a tag only one person has typed cannot
 * pair anyone by construction, so there is nothing to gain by sending it anywhere, and every
 * reason not to -- it never leaves this device, and the id space (negative, timestamp-derived)
 * cannot collide with a real interest's id even by accident.
 */
const rememberCustomInterests = (list: Interest[]) => {
  try {
    localStorage.setItem(CUSTOM_INTERESTS, JSON.stringify(list));
  } catch {
    // Private browsing, or the quota is gone. The tag survives this tab and no further.
  }
};

const rememberedCustomInterests = (): Interest[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_INTERESTS) ?? "null");
    return Array.isArray(parsed)
      ? parsed.filter(
          (one): one is Interest =>
            one && typeof one.id === "number" && typeof one.label === "string",
        )
      : [];
  } catch {
    return [];
  }
};

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
// "failed" ranks with "pending" so a late, legitimate ack can still win over it.
const RANK: Record<Delivery, number> = { pending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
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
  const [customInterests, setCustomInterests] = useState<Interest[]>([]);
  const [patience, setPatience] = useState(5);
  const [findStatus, setFindStatus] = useState("");
  // A search the server is still running for us -- the find button renders from this.
  const [searching, setSearching] = useState(false);
  const [typing, setTyping] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [peer, setPeer] = useState<Peer>({ userId: null, name: null, heading: "", sub: "" });
  const [isFriendConversation, setIsFriendConversation] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // Somebody walked out. The server decides this and says so in a frame; the client never
  // assumes it, which is exactly what went wrong when one side printed "You left" on its own.
  const [ended, setEnded] = useState(false);
  // Disabled after the first ask, so a second click never round-trips to the server's own dedup.
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  // True only until the first load resolves -- an empty array alone can't tell "still fetching"
  // from "genuinely empty."
  const [listsLoading, setListsLoading] = useState(true);
  // A thread picked from the list, while its history is still on the way -- the message pane
  // draws placeholders instead of looking like a conversation where nothing was ever said.
  const [historyLoading, setHistoryLoading] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  // Whether the live connection is actually up. Everything real-time rides on one socket, so
  // when it is down the app has to say so rather than accept presses it cannot deliver.
  const [connected, setConnected] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  // The token this browser holds, kept so the socket can be rebuilt without signing in again.
  const jwt = useRef<string | null>(null);
  // Set only when this component is going away, so an intentional close is told apart from
  // the network dropping one.
  const leaving = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  // Frames written while the socket was not open. A find or a message must not evaporate
  // because a phone was in somebody's pocket when it was pressed.
  const queued = useRef<Record<string, unknown>[]>([]);
  const seen = useRef(new Set<number>());
  const lastDay = useRef<string | null>(null);
  const peerReadSeq = useRef(0);
  const conversationRef = useRef<string | null>(null);
  const viewRef = useRef<"setup" | "chat">("setup");
  const typingSentAt = useRef(0);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendsRef = useRef<Friend[]>([]);
  // Read while creating a typed tag, to answer "do I already have this one?" without making
  // that callback depend on -- and be rebuilt by -- every change to the list.
  const customInterestsRef = useRef<Interest[]>([]);
  const meRef = useRef<string | null>(null);
  // Client ids drawn optimistically and not yet confirmed. A ref, not state, because the
  // decision "patch or append" is made while handling a frame and cannot wait for a render.
  const optimistic = useRef(new Set<string>());
  // Bumped every time a conversation is put on screen. A history load that finishes after
  // another thread (or the same one, again) was opened compares against it and drops its rows.
  const openedAt = useRef(0);
  // Bumped by every find and every cancel. A find still waiting on its interests to save checks
  // it before sending, so a cancel pressed in that gap cannot be overtaken by the find it undid.
  const findAttempt = useRef(0);
  // The search that is still on screen, if any. Closing a socket drops that user from the
  // server's wait pool, so a reconnect has to put the search back rather than leave the button
  // spinning over a pool nobody is in.
  const liveFind = useRef<Record<string, unknown> | null>(null);
  const searchingRef = useRef(false);

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
    customInterestsRef.current = customInterests;
  }, [customInterests]);
  useEffect(() => {
    meRef.current = session?.user.id ?? null;
  }, [session]);
  useEffect(() => {
    searchingRef.current = searching;
  }, [searching]);

  /** Re-run after every reconnect: assigned once the callbacks it needs exist. */
  const onReconnected = useRef<() => void>(() => {});

  /**
   * Opens the live socket, and keeps opening it.
   *
   * <p>There used to be exactly one socket, built during sign-in and never rebuilt. Nothing
   * reopened it, so the first close was permanent: a phone locked for a minute, a switch from
   * wifi to mobile data, a replica restarting. The app kept rendering as though it were
   * connected -- HTTP still worked, because fetch opens its own connection every time -- while
   * every websocket frame after that point went nowhere. That is what "none of the matching is
   * happening" was: `PUT /api/interests/mine` landed, the `find` frame behind it did not, and
   * the server never heard of the search the screen was showing.
   */
  const openSocket = useCallback(() => {
    if (leaving.current || !jwt.current) return;
    const live = socket.current;
    if (live && (live.readyState === WebSocket.OPEN || live.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    const ws = new WebSocket(socketUrl(jwt.current));
    socket.current = ws;
    ws.addEventListener("message", (event) =>
      frameHandler.current(JSON.parse(event.data as string)),
    );
    ws.addEventListener("open", () => {
      reconnectAttempt.current = 0;
      setConnected(true);
      const pending = queued.current;
      queued.current = [];
      pending.forEach((frame) => ws.send(JSON.stringify(frame)));
      onReconnected.current();
    });
    ws.addEventListener("close", () => {
      // An old socket finishing its close after a newer one replaced it is not a disconnect.
      if (socket.current !== ws) return;
      setConnected(false);
      if (leaving.current) return;
      // Backed off and capped: a laptop waking from sleep must not hammer the box, and a
      // one-second blip must not cost the app ten seconds of being deaf.
      const wait = Math.min(8_000, 400 * 2 ** reconnectAttempt.current);
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(openSocket, wait);
    });
  }, []);

  /**
   * Never drops a frame on the floor.
   *
   * <p>`WebSocket.send()` on a CLOSED or CLOSING socket throws nothing and delivers nothing --
   * the single most expensive line in this file, because it made a dead connection look
   * exactly like a working one. Anything written while the socket is down is held and flushed
   * on the next open instead.
   */
  const send = useCallback(
    (frame: Record<string, unknown>) => {
      const ws = socket.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(frame));
        return;
      }
      queued.current.push(frame);
      openSocket();
    },
    [openSocket],
  );

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

  const openConversation = useCallback(
    (id: string, next: Peer, friendConversation: boolean, endedAlready = false) => {
      openedAt.current += 1;
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
      setFriendRequestSent(false);
      // The server already told us whether this one is over -- reopening one from history used
      // to always start as if it were live, letting a send race the rejection.
      setEnded(endedAlready);
      setHistoryLoading(false);
      setView("chat");
      viewRef.current = "chat";
      setFindStatus("");
      setSearching(false);
      // Whatever we were looking for, we are not looking for it any more -- a reconnect must
      // not put a finished search back into the pool from under an open conversation.
      liveFind.current = null;
      setTyping(false);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

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
        // Typed tags are looked up too, not just the catalogue. They are real shared rows but
        // are deliberately kept out of `all` (nothing anyone typed is offered for browsing),
        // so matching two people on one and then heading the conversation "You both like "
        // with an empty list is exactly the case this has to cover.
        const named = [...interests.all, ...interests.suggested, ...customInterestsRef.current];
        const labels = shared.map((id) => named.find((i) => i.id === id)?.label).filter(Boolean);
        openConversation(
          String(frame.conversationId),
          {
            userId: String(frame.withUserId),
            name: (frame.withDisplayName as string | null) ?? null,
            // Their name heads the conversation; why you were put together is the subtitle.
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
        const clientMsgId = frame.clientMsgId ? String(frame.clientMsgId) : null;
        if (clientMsgId && optimistic.current.delete(clientMsgId)) {
          // Ties the rejection to the one message it was about, instead of leaving it stuck
          // on a pending clock with nothing left to ever advance it.
          patchMessage({ clientMsgId }, (item) => ({ ...item, delivery: "failed" }));
        } else {
          appendEvent(`Something went wrong: ${String(frame.message)}`);
        }
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
    // This browser's own memory of what was picked, filtered to ids that still exist, wins over
    // the server's guess -- a returning visitor is walking back into a room they left, not
    // filling a form out again.
    const known = new Set([...catalogue.suggested, ...catalogue.all].map((interest) => interest.id));
    const savedSelection = rememberedSelected()?.filter((id) => known.has(id)) ?? [];
    // A local tag that names a real tile ("history" typed before that check existed) becomes the
    // tile itself, and a tag saved twice is kept once -- otherwise both copies render side by side.
    const catalogueList = [...catalogue.suggested, ...catalogue.all];
    const promoted: number[] = [];
    const savedCustom: Interest[] = [];
    for (const custom of rememberedCustomInterests()) {
      const tag = normaliseTag(custom.label);
      const real = findByTag(catalogueList, tag);
      if (real) promoted.push(real.id);
      else if (tag && !findByTag(savedCustom, tag)) savedCustom.push(custom);
    }
    // A tag this browser saved under a negative id was never sent anywhere, so it has no row
    // and cannot match. Claim the shared one for it now rather than leaving somebody who typed
    // a tag last week permanently unmatchable on it with no sign that anything is wrong.
    const shared = await Promise.all(
      savedCustom.map(async (custom) => {
        if (custom.id > 0) return custom;
        try {
          return await api.createInterest(custom.label);
        } catch {
          return null;
        }
      }),
    );
    const usableCustom = shared.filter((one): one is Interest => one !== null);
    rememberCustomInterests(usableCustom);
    setCustomInterests(usableCustom);
    // A typed tag is always selected -- there is no unselected-but-remembered state for one,
    // since it has nowhere else to live once it is off.
    const initial = [
      ...new Set([
        ...(savedSelection.length > 0
          ? savedSelection
          : catalogue.fromHistory
            ? catalogue.suggested.map((i) => i.id)
            : []),
        ...promoted,
        ...usableCustom.map((interest) => interest.id),
      ]),
    ];
    setSelected(initial);
    rememberSelected(initial);

    jwt.current = next.jwt;
    await new Promise<void>((resolve) => {
      openSocket();
      const ws = socket.current;
      if (!ws) {
        resolve();
        return;
      }
      ws.addEventListener("open", () => resolve(), { once: true });
      // A first connection that never opens must not leave sign-in hanging for ever -- the
      // reconnect loop is already running behind this, so carry on and let it arrive.
      ws.addEventListener("close", () => resolve(), { once: true });
    });

    // All three before anything can be pushed, so a request or a chat that was already waiting
    // is on screen from the moment you sign in.
    await Promise.all([reloadFriends(), reloadRequests(), reloadConversations()]);
    setListsLoading(false);
  }, [openSocket, reloadConversations, reloadFriends, reloadRequests]);

  useEffect(() => {
    void start();
    return () => {
      leaving.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socket.current?.close();
    };
  }, [start]);

  /**
   * What a reconnect has to put back.
   *
   * <p>Assigned every render rather than wired once, so it always closes over the current
   * callbacks. The lists are refetched because anything pushed while the socket was down was
   * pushed at nobody, and the search is re-sent because the server drops a disconnected user
   * from the wait pool -- without this, reconnecting leaves the button spinning over a pool
   * this person is no longer in.
   */
  useEffect(() => {
    onReconnected.current = () => {
      void refreshLists();
      if (searchingRef.current && liveFind.current) send(liveFind.current);
    };
  });

  /**
   * A phone coming back from the lock screen, or a laptop from sleep, does not always fire
   * `close` promptly -- the socket can sit in a half-open state the browser has not noticed.
   * These are the two moments worth checking rather than waiting for a timer.
   */
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible") {
        reconnectAttempt.current = 0;
        openSocket();
      }
    };
    const online = () => {
      reconnectAttempt.current = 0;
      openSocket();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", online);
    };
  }, [openSocket]);

  /* ---------- opening a conversation ---------- */

  const openThread = useCallback(
    async (thread: {
      conversationId: string;
      peerId: string | null;
      peerName: string | null;
      online?: boolean;
      isFriend: boolean;
      ended?: boolean;
    }) => {
      openConversation(
        thread.conversationId,
        {
          userId: thread.peerId,
          name: thread.peerName,
          heading: thread.peerName ?? "Someone",
          sub: thread.isFriend ? (thread.online ? "Online" : "Offline") : "",
        },
        thread.isFriend,
        Boolean(thread.ended),
      );
      setHistoryLoading(true);
      const opening = openedAt.current;

      // How far they have read, before any history is drawn -- otherwise the whole backlog
      // renders grey and only goes blue if they happen to read something new.
      const conversation = await api.conversation(thread.conversationId).catch(() => null);
      if (openedAt.current !== opening) return;
      peerReadSeq.current = Math.max(
        0,
        ...(conversation?.others ?? []).map((other) => other.readCursorSeq ?? 0),
        0,
      );

      const history = await api.history(thread.conversationId).catch(() => null);
      // Somebody opened another thread while this one was loading; these rows are not for it.
      if (openedAt.current !== opening) return;
      setHistoryLoading(false);
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
      if (thread.ended) {
        // Said once, in the thread, where the date pills are -- not as a line of text squeezed
        // in next to the button at the bottom.
        appendEvent("This conversation is over.");
      } else if (!history.messages.length) {
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
        ended: conversation.state === "ended",
      }),
    [openThread],
  );

  /* ---------- sending ---------- */

  const findSomeone = useCallback(async () => {
    setFindStatus("");
    setSearching(true);
    // Every selected id is a real row now, typed tags included -- the filter stays only to
    // drop a negative one left in this browser's storage by an older build, which would be
    // rejected by the server rather than matched on.
    const realIds = selected.filter((id) => id > 0);
    const attempt = ++findAttempt.current;
    await api.saveInterests(realIds);
    // Stopped while saving: sending now would put us back in the pool with the screen saying
    // we are not looking -- a searcher nobody can see, matched with whoever asks next.
    if (attempt !== findAttempt.current) return;
    const frame = { type: "find", interestIds: realIds, patience };
    liveFind.current = frame;
    send(frame);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    // Matching skips anyone already a friend, so with a few friends and nobody else waiting it
    // looks exactly like a broken matcher. Say so rather than spin forever.
    hintTimer.current = setTimeout(() => {
      setFindStatus(
        friendsRef.current.length
          ? "Nobody new is around yet. Friends are skipped here, message them from your list."
          : "Nobody with your interests is around yet.",
      );
    }, 12_000);
  }, [patience, selected, send]);

  const cancelFind = useCallback(() => {
    findAttempt.current += 1;
    liveFind.current = null;
    send({ type: "cancelFind" });
    setSearching(false);
    setFindStatus("");
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, [send]);

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
    if (!conversationId || friendRequestSent) return;
    const response = await api.askToKeep(conversationId);
    if (response.ok) setFriendRequestSent(true);
    appendEvent(
      response.ok
        ? "Asked to keep them. You will hear back only if they say yes."
        : "You have already asked.",
    );
  }, [appendEvent, conversationId, friendRequestSent]);


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
        setPeer((current) => ({ ...current, sub: "" }));
      }
    },
    [peer.userId, refreshLists],
  );

  /**
   * Never matched again (the matcher already excludes any blocked pair), and hidden from both
   * lists from this point on -- but nothing is deleted, which is what leaves room for an unblock
   * feature later without having lost anything in the meantime.
   */
  const blockUser = useCallback(
    async (userId: string) => {
      const response = await api.block(userId);
      if (!response.ok) return;
      await refreshLists();
      if (peer.userId === userId) {
        setView("setup");
        viewRef.current = "setup";
        setConversationId(null);
        conversationRef.current = null;
      }
    },
    [peer.userId, refreshLists],
  );

  /**
   * Attaches an email and password to the identity this browser already has. The response is a
   * fresh session for the same account -- same id, same name, same friends -- not a new one, so
   * it replaces what is held here rather than being layered on top of it.
   */
  const saveAccount = useCallback(async (email: string, password: string) => {
    const response = await api.signup(email, password);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, message: body?.message ?? "Could not save the account." };
    }
    const next = (await response.json()) as Session;
    setBearer(next.jwt);
    setSession(next);
    meRef.current = next.user.id;
    return { ok: true, message: "Saved. Nothing reset — same name, same friends." };
  }, []);

  /**
   * Forgets this browser. The account itself is untouched server-side (`aim.md`'s anonymous
   * identity was never at risk of being deleted by this) -- only the device token that lets this
   * browser resume it is invalidated, so the next load starts a fresh anonymous identity.
   */
  const logout = useCallback(async () => {
    const token = remembered();
    try {
      await api.logout(token ?? undefined);
    } catch {
      // Best effort. The browser forgets its own token regardless of whether the server heard.
    }
    try {
      localStorage.removeItem(DEVICE_TOKEN);
      localStorage.removeItem(SELECTED_INTERESTS);
      localStorage.removeItem(CUSTOM_INTERESTS);
    } catch {
      // Private browsing, or the quota is gone -- nothing left to clear either way.
    }
    window.location.reload();
  }, []);

  /** Sets selection and remembers it in this browser in the same step, so the two never drift. */
  const updateSelected = useCallback((next: number[]) => {
    setSelected(next);
    rememberSelected(next);
  }, []);

  /**
   * Adds a typed tag and selects it -- as a real, shared interest, created on the server.
   *
   * <p>This used to keep the tag in this browser alone, under a negative id, on the reasoning
   * that a tag only one person has cannot match anyone. The reasoning was right and the
   * conclusion was backwards: the cure for a tag nobody else has is to put it somewhere
   * somebody else can have it. A negative id was then filtered out of both `saveInterests` and
   * the `find` frame, so searching with only a typed tag selected sent an empty interest list,
   * which the server refuses outright -- two people who had each typed the same word sat
   * looking at "Looking" forever and were never candidates for one another.
   *
   * <p>`POST /api/interests` dedupes by slug, so both of them come back holding the same id.
   */
  const addInterest = useCallback(async (label: string) => {
    if (!label) return;
    if (customInterestsRef.current.some((one) => normaliseTag(one.label) === normaliseTag(label))) {
      return;
    }
    let interest: Interest;
    try {
      interest = await api.createInterest(label);
    } catch {
      // Offline, or the server said no. Adding it locally would put a tile on screen that can
      // never match anyone and give no hint why, which is the bug this replaced.
      return;
    }
    setCustomInterests((current) => {
      if (current.some((one) => one.id === interest.id)) return current;
      const next = [...current, interest];
      rememberCustomInterests(next);
      return next;
    });
    setSelected((selection) => {
      if (selection.includes(interest.id)) return selection;
      const next = [...selection, interest.id];
      rememberSelected(next);
      return next;
    });
  }, []);

  /** The only way a local-only tag goes away: it has no unselected state to fall back to. */
  const removeCustomInterest = useCallback((id: number) => {
    setCustomInterests((current) => {
      const next = current.filter((interest) => interest.id !== id);
      rememberCustomInterests(next);
      return next;
    });
    setSelected((current) => {
      const next = current.filter((one) => one !== id);
      rememberSelected(next);
      return next;
    });
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
  const nonFriendConversations = useMemo(() => {
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
    connected,
    view,
    friends,
    requests,
    conversations: nonFriendConversations,
    listsLoading,
    historyLoading,
    interests,
    selected,
    setSelected: updateSelected,
    customInterests,
    addInterest,
    removeCustomInterest,
    patience,
    setPatience,
    findStatus,
    searching,
    cancelFind,
    typing,
    items,
    conversationId,
    ended,
    friendRequestSent,
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
    blockUser,
    saveAccount,
    logout,
    goHome,
    reloadFriends,
    reloadRequests,
    reloadConversations,
    refreshLists,
  };
};

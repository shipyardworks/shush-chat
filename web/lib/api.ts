import { apiUrl } from "./config";
import type { Conversation, Friend, FriendRequest, Message, Session, Interest } from "./types";

let bearer: string | null = null;

export const setBearer = (jwt: string | null) => {
  bearer = jwt;
};

const request = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (bearer) {
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  return fetch(apiUrl(path), { ...init, headers });
};

const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await request(path, init);
  if (!response.ok) {
    throw new ApiError(response.status, await response.text().catch(() => ""));
  }
  return (await response.json()) as T;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`request failed with ${status}`);
  }
}

export const api = {
  anonymous: () => json<Session>("/api/auth/anonymous", { method: "POST" }),

  resumeDevice: (token: string) =>
    json<Session>("/api/auth/device", { method: "POST", body: JSON.stringify({ token }) }),

  signup: (email: string, password: string) =>
    request("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: (token?: string) =>
    request("/api/auth/logout", { method: "POST", body: JSON.stringify({ token }) }),

  interests: () =>
    json<{ suggested: Interest[]; all: Interest[]; fromHistory: boolean }>("/api/interests"),

  saveInterests: (interestIds: number[]) =>
    request("/api/interests/mine", { method: "PUT", body: JSON.stringify({ interestIds }) }),

  shuffleName: () => request("/api/me/shuffle-name", { method: "POST" }),

  friends: () => json<Friend[]>("/api/friends"),

  friendRequests: () => json<FriendRequest[]>("/api/friend-requests"),

  askToKeep: (conversationId: string) =>
    request(`/api/conversations/${conversationId}/friend-request`, { method: "POST" }),

  acceptRequest: (id: string) => request(`/api/friend-requests/${id}/accept`, { method: "POST" }),

  declineRequest: (id: string) => request(`/api/friend-requests/${id}/decline`, { method: "POST" }),

  unfriend: (userId: string) => request(`/api/friends/${userId}`, { method: "DELETE" }),

  /** Never matched again, and hidden everywhere -- but nothing about them is deleted. */
  block: (userId: string) => request(`/api/blocks/${userId}`, { method: "POST" }),

  unblock: (userId: string) => request(`/api/blocks/${userId}`, { method: "DELETE" }),

  /** Every conversation this person has had, newest first, strangers included. */
  conversations: () => json<Conversation[]>("/api/conversations"),

  react: (messageId: string, emoji: string | null) =>
    emoji === null
      ? request(`/api/messages/${messageId}/reaction`, { method: "DELETE" })
      : request(`/api/messages/${messageId}/reaction`, {
          method: "PUT",
          body: JSON.stringify({ emoji }),
        }),

  /** Yours only, and it removes the words for both people. */
  deleteMessage: (messageId: string) => request(`/api/messages/${messageId}`, { method: "DELETE" }),

  /** Anyone's, and nobody is told. */
  hideMessage: (messageId: string) => request(`/api/messages/${messageId}/hide`, { method: "POST" }),

  conversation: (id: string) =>
    json<{ others: { userId: string; readCursorSeq: number; hasLeft: boolean }[] }>(
      `/api/conversations/${id}`,
    ),

  history: (id: string, limit = 50) =>
    json<{ messages: Message[] }>(`/api/conversations/${id}/messages?limit=${limit}`),

  uploadUrl: (conversationId: string, mime: string, sizeBytes: number) =>
    request("/api/media/upload-url", {
      method: "POST",
      body: JSON.stringify({ conversationId, mime, sizeBytes }),
    }),
};

/**
 * The URL for one stored image.
 *
 * Two things this cannot do: percent-encode the separators, because the key is a real path and
 * Spring's firewall rejects %2F with a 400 before any handler runs; and rely on the
 * Authorization header, because an <img> tag cannot send one. The token rides in the query for
 * the same reason the websocket handshake does it, and the API accepts it on this path only.
 */
export const mediaUrl = (key: string) =>
  apiUrl(
    `/api/media/${key.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(bearer ?? "")}`,
  );

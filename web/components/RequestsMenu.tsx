"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { FriendRequest } from "@/lib/types";

const Person = () => (
  <svg viewBox="0 0 12 12" className="h-[11px] w-[11px] flex-none" fill="currentColor" aria-hidden>
    <circle cx="6" cy="3.4" r="2.4" />
    <path d="M1.2 11.2c0-2.7 2.1-4.4 4.8-4.4s4.8 1.7 4.8 4.4Z" />
  </svg>
);

/**
 * A person inside a speech bubble: someone asking to talk to you again. With requests waiting,
 * the bubble fills and the count sits inside it, so the number is part of the icon rather than
 * a notification dot bolted onto its corner.
 */
const RequestsIcon = ({ count }: { count: number }) => {
  // useId's delimiters are not safe inside url(#...), so keep only the plain characters.
  const gradient = `requests${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (count === 0) {
    return (
      <span className="relative block h-6 w-6" aria-hidden>
        <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M5.5 2.5h13a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H13l-4.5 4v-4h-3a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4Z" />
        </svg>
        <span className="absolute inset-x-0 top-[2.5px] flex h-[15px] items-center justify-center">
          <Person />
        </span>
      </span>
    );
  }
  return (
    <span className="relative block h-6 w-[34px] text-white" aria-hidden>
      <svg viewBox="0 0 34 24" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-cyan)" />
          </linearGradient>
        </defs>
        <path
          d="M6 1.5h22a4.5 4.5 0 0 1 4.5 4.5v7.5a4.5 4.5 0 0 1-4.5 4.5H14.5l-5 4.5v-4.5H6a4.5 4.5 0 0 1-4.5-4.5V6A4.5 4.5 0 0 1 6 1.5Z"
          fill={`url(#${gradient})`}
        />
      </svg>
      <span className="absolute inset-x-0 top-[1.5px] flex h-[16.5px] items-center justify-center gap-[3px]">
        <Person />
        <span data-testid="requestCount" className="text-[11px] leading-none font-bold tabular-nums">
          {count > 9 ? "9+" : count}
        </span>
      </span>
    </span>
  );
};

/**
 * Pending friend requests, in the header rather than taking permanent space in the sidebar.
 *
 * <p>They used to sit above Friends and Chats whether or not there were any, which is a
 * section that is empty almost all the time claiming room from the two that are not. A badge
 * on an icon says the same thing -- something is waiting -- and costs nothing when it is not.
 *
 * <p>The dropdown is portaled to the document body rather than positioned relative to the
 * button. Its backdrop is a `position: fixed` div meant to cover the whole viewport, and this
 * header has `backdrop-blur`, which makes it the containing block for any fixed descendant --
 * so a backdrop left inside the header shrinks to cover only the header's own thin strip, and
 * clicking anywhere in the actual page does nothing. Escaping the header's subtree is the fix,
 * not remembering never to use `backdrop-filter` near an overlay.
 */
export const RequestsMenu = ({
  requests,
  onRefresh,
}: {
  requests: FriendRequest[];
  onRefresh: () => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    setAt({ top: box.bottom + 8, right: window.innerWidth - box.right });
  }, [open]);

  // Every other dismissible overlay in the app closes on Escape; this one is not a special
  // case that should behave differently just because it happens to live in the header.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        id="requestsButton"
        type="button"
        title="Requests"
        aria-label={requests.length ? `Requests (${requests.length})` : "Requests"}
        onClick={() => setOpen((current) => !current)}
        className="btn-ghost grid h-9 min-w-9 place-items-center rounded-full px-1.5 py-0"
      >
        <RequestsIcon count={requests.length} />
      </button>

      {open &&
        at &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              id="requestsPanel"
              className="scroll-elegant panel fixed z-50 max-h-[360px] w-80 overflow-y-auto p-3"
              style={{ top: at.top, right: at.right }}
            >
              <h2 className="section-label px-1">Requests</h2>
              <ul id="requests" className="m-0 flex list-none flex-col gap-1.5 p-0">
                {requests.map((request) => (
                  <li
                    key={request.id}
                    data-testid="request"
                    className="flex flex-col gap-2 rounded-xl border p-3"
                    style={{ borderColor: "var(--color-line)", backgroundColor: "var(--color-surface-2)" }}
                  >
                    {/* Their name. "Someone would like to keep you" is a question nobody can
                        answer -- the app knows who it means and should say so. */}
                    <p className="m-0 text-[13px]">
                      <strong>{request.fromDisplayName ?? "Someone"}</strong> would like to keep you.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-primary px-3 py-1.5 text-[13px]"
                        onClick={async () => {
                          await api.acceptRequest(request.id);
                          await onRefresh();
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-[13px]"
                        onClick={async () => {
                          await api.declineRequest(request.id);
                          await onRefresh();
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {requests.length === 0 && (
                <p id="noRequests" className="px-1 text-[13px]" style={{ color: "var(--color-faint)" }}>
                  Nobody has asked to keep you yet.
                </p>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
};

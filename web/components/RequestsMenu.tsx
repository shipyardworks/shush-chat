"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { FriendRequest } from "@/lib/types";

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
        aria-label="Requests"
        onClick={() => setOpen((current) => !current)}
        className="btn-ghost relative grid h-9 w-9 place-items-center rounded-full p-0"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5z" strokeLinejoin="round" />
        </svg>
        {requests.length > 0 && (
          <span
            data-testid="requestCount"
            className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, var(--color-brand), var(--color-brand-2))" }}
          >
            {requests.length}
          </span>
        )}
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

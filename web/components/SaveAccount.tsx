"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { messages } from "@/lib/messages";

/**
 * Pinned to the bottom of the sidebar for as long as the account lives only in this browser --
 * where "Signed in" sits once it is saved, so the two states occupy the same place. The form
 * itself opens on demand, instead of an email and a password box sitting there the whole time.
 */
export const SaveAccount = ({
  onSave,
}: {
  onSave: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
}) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const save = async () => {
    setSaving(true);
    const result = await onSave(email, password);
    setSaving(false);
    setStatus(result.message);
  };

  return (
    <>
      <div
        id="saveStrip"
        className="flex-none border-t p-3 sm:p-4"
        style={{ borderColor: "var(--color-line-soft)" }}
      >
        <div className="flex items-start gap-2.5">
          <svg viewBox="0 0 24 24" className="mt-px h-4 w-4 flex-none" fill="none" stroke="var(--color-brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" />
            <path d="M12 8.5v4M12 15.5h.01" />
          </svg>
          <p id="saveWarning" className="m-0 min-w-0 flex-1 text-xs leading-snug" style={{ color: "var(--color-muted)" }}>
            {messages.account.warning}
          </p>
        </div>
        <button
          id="openSave"
          type="button"
          className="btn-primary mt-3 w-full py-1.5 text-sm"
          onClick={() => setOpen(true)}
        >
          Save account
        </button>
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center p-5 backdrop-blur-[3px]"
            style={{ backgroundColor: "var(--color-scrim)" }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <form
              id="saveBox"
              role="dialog"
              aria-modal="true"
              aria-labelledby="saveTitle"
              className="panel rise w-full max-w-[360px] p-6"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <h2 id="saveTitle" className="m-0 mb-1 text-[17px] font-semibold">
                Save your account
              </h2>
              <p className="mt-0 mb-4 text-[13px]" style={{ color: "var(--color-faint)" }}>
                {messages.account.why}
              </p>
              <div className="flex flex-col gap-2">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="field"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  className="field"
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button id="saveAccount" type="submit" className="btn-primary mt-1" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                  Not now
                </button>
                {status && (
                  <span className="text-[13px]" style={{ color: "var(--color-faint)" }}>
                    {status}
                  </span>
                )}
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
};

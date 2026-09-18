"use client";

import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";

export type ProfileTarget = {
  userId: string | null;
  name: string | null;
  sub: string;
  mine: boolean;
  friend: boolean;
};

export const ProfileDialog = ({
  target,
  onClose,
  onRemoveFriend,
  onBlock,
}: {
  target: ProfileTarget | null;
  onClose: () => void;
  onRemoveFriend: (userId: string) => Promise<void>;
  onBlock: (userId: string) => Promise<void>;
}) => {
  const [confirmingBlock, setConfirmingBlock] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A fresh target -- a different person, or this same dialog opened again -- starts the
  // confirm step over, rather than a reopened dialog silently remembering it was mid-block.
  useEffect(() => {
    setConfirmingBlock(false);
  }, [target]);

  if (!target) return null;

  return (
    <div
      id="profileBackdrop"
      className="fixed inset-0 z-50 grid place-items-center p-5 backdrop-blur-[3px]"
      style={{ backgroundColor: "var(--color-scrim)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profileName"
        className="panel rise w-full max-w-90 p-6 text-center"
        style={{ maxWidth: 360 }}
      >
        <div className="mb-3.5 flex justify-center">
          <Avatar id={target.userId} name={target.name} size={68} />
        </div>
        <h3 id="profileName" className="m-0 mb-1 text-[19px] font-semibold">
          {target.name ?? "Someone"}
        </h3>
        <p className="mb-4.5 text-[13px]" style={{ color: "var(--color-faint)" }}>
          {target.sub}
        </p>
        <div className="flex flex-col gap-2">
          {target.friend && target.userId && (
            <button
              id="removeFriend"
              type="button"
              className="btn-ghost"
              style={{ color: "var(--color-danger)", borderColor: "var(--color-danger-line)" }}
              onClick={async () => {
                await onRemoveFriend(target.userId!);
                onClose();
              }}
            >
              Remove friend
            </button>
          )}
          {/* Works on a friend's profile too, not only someone you were matched with -- blocking is about who can
              reach you, which has nothing to do with whether you had kept them. */}
          {!target.mine && target.userId && (
            <button
              id="blockUser"
              type="button"
              className="btn-ghost"
              style={{ color: "var(--color-danger)", borderColor: "var(--color-danger-line)" }}
              onClick={async () => {
                if (!confirmingBlock) {
                  setConfirmingBlock(true);
                  return;
                }
                await onBlock(target.userId!);
                onClose();
              }}
            >
              {confirmingBlock ? "Tap again to block — this can't be undone yet" : "Block"}
            </button>
          )}
          <button id="closeProfile" type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

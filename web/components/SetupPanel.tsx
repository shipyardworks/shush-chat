"use client";

import { useState } from "react";
import type { Interest } from "@/lib/types";

const PATIENCE = [
  { seconds: 5, label: "5s" },
  { seconds: 10, label: "10s" },
  { seconds: 30, label: "30s" },
  { seconds: 0, label: "Forever" },
];

export const SetupPanel = ({
  interests,
  selected,
  setSelected,
  onAddInterest,
  patience,
  setPatience,
  findStatus,
  onFind,
  bare = false,
}: {
  interests: { suggested: Interest[]; all: Interest[] };
  selected: number[];
  setSelected: (next: number[]) => void;
  onAddInterest: (label: string) => void;
  patience: number;
  setPatience: (next: number) => void;
  findStatus: string;
  onFind: () => void;
  /** Dropped into an existing surface rather than centred on its own screen. */
  bare?: boolean;
}) => {
  const [draft, setDraft] = useState("");

  // Suggestions first, then everything else -- the useful ones are what a returning visitor
  // sees without scrolling.
  const ordered = [
    ...interests.suggested,
    ...interests.all.filter((one) => !interests.suggested.some((s) => s.id === one.id)),
  ];

  const toggle = (id: number) =>
    setSelected(selected.includes(id) ? selected.filter((one) => one !== id) : [...selected, id]);

  const submitDraft = () => {
    if (!draft.trim()) return;
    onAddInterest(draft);
    setDraft("");
  };

  const body = (
    <>
      <div>
        <h2 className="section-label">What are you into?</h2>
        {/*
          One list, one look, one way to make a tile: a typed tag becomes a real interest the
          moment it is created, so there is nothing left to style differently. Everything that
          does not fit scrolls rather than folding behind a Show more -- picking is the part of
          this screen that matters, and a fixed-height scroller keeps the rest of the page still
          while that happens.
        */}
        <div
          id="interestTiles"
          className="scroll-elegant flex max-h-[220px] flex-wrap content-start gap-2 overflow-y-auto pr-1"
        >
          {ordered.map((interest) => {
            const on = selected.includes(interest.id);
            return (
              <button
                key={interest.id}
                type="button"
                data-interest-id={interest.id}
                data-testid="interest"
                aria-pressed={on}
                onClick={() => toggle(interest.id)}
                className={on ? "btn-primary" : "btn"}
              >
                {interest.label}
              </button>
            );
          })}

          {/* The same shape as a tile, so adding one does not read as a different feature --
              just an empty slot waiting for a word. Enter creates and selects it in one step. */}
          <input
            id="addInterestInput"
            type="text"
            placeholder="+ Something else"
            maxLength={40}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter only, as asked -- clicking away with a half-typed tag in the box must
              // not silently create it.
              if (event.key === "Enter") submitDraft();
            }}
            className="field w-[168px] px-4 py-2"
          />
        </div>
      </div>

      <div className="mt-6">
        <h2 className="section-label">How long?</h2>
        <div className="flex flex-wrap gap-2">
          {PATIENCE.map((option) => (
            <button
              key={option.seconds}
              type="button"
              aria-pressed={patience === option.seconds}
              onClick={() => setPatience(option.seconds)}
              className={patience === option.seconds ? "btn-primary" : "btn"}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          id="findSomeone"
          type="button"
          className="btn-primary"
          disabled={selected.length === 0}
          onClick={onFind}
        >
          Find someone
        </button>
        <span id="findStatus" className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          {findStatus}
        </span>
      </div>
    </>
  );

  return bare ? (
    body
  ) : (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
      <div className="panel w-full max-w-[620px] p-7">{body}</div>
    </div>
  );
};

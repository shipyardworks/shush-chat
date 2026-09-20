"use client";

import { useEffect, useRef, useState } from "react";
import { findByTag, normaliseTag } from "@/lib/interests";
import type { Interest } from "@/lib/types";

const PATIENCE = [
  { seconds: 5, label: "5s" },
  { seconds: 10, label: "10s" },
  { seconds: 30, label: "30s" },
  { seconds: 0, label: "Forever" },
];

/** Roughly what the old CSS animation moved at, now driven a frame at a time. */
const PIXELS_PER_SECOND = 42;

/** How long the strip stays where a finger, wheel or trackpad left it before streaming again. */
const RESUME_AFTER_MS = 2500;

/**
 * One tile, one look, everywhere it appears -- chosen, streaming past, or freshly typed.
 *
 * <p>{@code hidden} renders a second, inert copy of the same button for the streaming strip's
 * seamless loop: real content, not a screenshot of it, but not something a test or a screen
 * reader should count twice. It still calls the same handler, so whichever copy is on screen at
 * the moment somebody clicks, it does the same thing.
 */
const Tile = ({
  interest,
  on,
  onClick,
  hidden = false,
}: {
  interest: Interest;
  on: boolean;
  onClick: () => void;
  hidden?: boolean;
}) => (
  <button
    type="button"
    {...(hidden ? { "aria-hidden": true, tabIndex: -1 } : { "data-testid": "interest" })}
    data-interest-id={hidden ? undefined : interest.id}
    aria-pressed={on}
    onClick={onClick}
    className={`shrink-0 whitespace-nowrap ${on ? "btn-primary" : "btn"}`}
  >
    {interest.label}
  </button>
);

/**
 * Everything not yet chosen, streamed past in one line rather than piled into a grid.
 *
 * <p>This is real horizontal scroll, not a transform: the track holds the list twice back to
 * back and a frame loop nudges `scrollLeft` forward, wrapping by exactly half the track's width
 * once it has scrolled a full copy -- which is invisible because the second copy is identical to
 * the first. Because it is real scroll, it can also be dragged, which auto-scroll alone cannot
 * offer -- something that has already streamed past is not gone, it is one drag away.
 *
 * <p>The same strip on a phone, swiped with one finger. What made it unreliable there before was
 * the loop writing `scrollLeft` every frame while the finger (or its momentum) was also moving
 * it, and iOS rounding each tiny per-frame step back to the same whole pixel. So the loop keeps
 * its own fractional position, and never touches `scrollLeft` while a finger is down or while
 * scroll it did not cause is still arriving -- it picks up from wherever that left it.
 */
const Ticker = ({ items, onToggle }: { items: Interest[]; onToggle: (id: number) => void }) => {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);
  const touching = useRef(false);
  const heldUntil = useRef(0);
  const lastWritten = useRef(0);

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let last: number | null = null;
    let position = node.scrollLeft;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Capped, so coming back to a backgrounded tab does not leap a whole screen at once.
      const elapsed = last === null ? 0 : Math.min(now - last, 100);
      last = now;
      // The pause flag, dragging and a finger all leave scrollLeft exactly where they found it.
      if (
        dragging.current ||
        touching.current ||
        now < heldUntil.current ||
        node.style.animationPlayState === "paused"
      ) {
        position = node.scrollLeft;
        return;
      }
      const half = node.scrollWidth / 2;
      if (half <= node.clientWidth) return;
      position += (elapsed / 1000) * PIXELS_PER_SECOND;
      if (position >= half) position -= half;
      node.scrollLeft = position;
      lastWritten.current = node.scrollLeft;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Re-measures against the current content every time the list of what still streams changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Anything that moved the strip other than the loop itself -- touch momentum, a wheel, a
  // trackpad -- holds the loop off until it has been still for a moment.
  const onScroll = () => {
    const node = track.current;
    if (node && Math.abs(node.scrollLeft - lastWritten.current) > 2) {
      heldUntil.current = performance.now() + RESUME_AFTER_MS;
    }
  };
  const onTouchStart = () => {
    touching.current = true;
  };
  const onTouchEnd = () => {
    touching.current = false;
    heldUntil.current = performance.now() + RESUME_AFTER_MS;
  };

  // Only a mouse drags by grabbing -- touch and a trackpad already get this natively from
  // overflow-x: auto. No pointer capture: the swipe-to-reply gesture on a message bubble
  // proves the same plain bubbling-plus-onPointerLeave shape already holds up under a
  // scripted `force: true` click, and capture is exactly the thing that stopped one arriving
  // -- retargeting is for a drag surface with nothing clickable on it, not a row of buttons.
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    dragging.current = true;
    dragMoved.current = false;
    dragStartX.current = event.clientX;
    dragStartScroll.current = track.current?.scrollLeft ?? 0;
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging.current || !track.current) return;
    const dx = event.clientX - dragStartX.current;
    if (Math.abs(dx) > 4) dragMoved.current = true;
    track.current.scrollLeft = dragStartScroll.current - dx;
  };
  const endDrag = () => {
    dragging.current = false;
  };
  // A drag that moved is not a click on whatever the pointer happened to end up over.
  const clickThrough = (id: number) => () => {
    if (!dragMoved.current) onToggle(id);
  };

  return (
    <div
      id="interestTicker"
      ref={track}
      className="marquee-fade marquee-track flex items-center gap-2 overflow-x-auto overflow-y-hidden py-0.5 select-none"
      style={{ cursor: "grab", overscrollBehaviorX: "contain" }}
      onScroll={onScroll}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      // Hover-to-pause is for a mouse only: a tap fires an emulated mouseenter with no
      // matching leave, which would freeze the strip on a phone after the first pick.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && track.current) track.current.style.animationPlayState = "paused";
      }}
      onPointerOut={(event) => {
        if (
          event.pointerType === "mouse" &&
          track.current &&
          !track.current.contains(event.relatedTarget as Node | null)
        ) {
          track.current.style.animationPlayState = "";
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
    >
      {items.map((interest) => (
        <Tile key={interest.id} interest={interest} on={false} onClick={clickThrough(interest.id)} />
      ))}
      {items.map((interest) => (
        <Tile
          key={`echo-${interest.id}`}
          interest={interest}
          on={false}
          hidden
          onClick={clickThrough(interest.id)}
        />
      ))}
    </div>
  );
};

export const SetupPanel = ({
  interests,
  selected,
  setSelected,
  customInterests,
  onAddInterest,
  onRemoveInterest,
  patience,
  setPatience,
  findStatus,
  searching,
  onFind,
  onCancelFind,
  bare = false,
}: {
  interests: { suggested: Interest[]; all: Interest[] };
  selected: number[];
  setSelected: (next: number[]) => void;
  /** Typed tags: real shared rows, just not ones the catalogue offers for browsing. */
  customInterests: Interest[];
  onAddInterest: (label: string) => void | Promise<void>;
  onRemoveInterest: (id: number) => void;
  patience: number;
  setPatience: (next: number) => void;
  /** Only ever a short hint, and only once a search has been running a while. */
  findStatus: string;
  searching: boolean;
  onFind: () => void;
  onCancelFind: () => void;
  /** Dropped into an existing surface rather than centred on its own screen. */
  bare?: boolean;
}) => {
  const [draft, setDraft] = useState("");

  // Suggestions first, then everything else -- the useful ones are what a returning visitor
  // sees at the front of the strip.
  const ordered = [
    ...interests.suggested,
    ...interests.all.filter((one) => !interests.suggested.some((s) => s.id === one.id)),
  ];
  const chosen = [...ordered.filter((interest) => selected.includes(interest.id)), ...customInterests];
  const rest = ordered.filter((interest) => !selected.includes(interest.id));
  const customIds = new Set(customInterests.map((interest) => interest.id));

  const toggle = (id: number) => {
    if (customIds.has(id)) {
      // A local-only tag has nowhere to go back to -- deselecting it is removing it.
      onRemoveInterest(id);
      return;
    }
    setSelected(selected.includes(id) ? selected.filter((one) => one !== id) : [...selected, id]);
  };

  const submitDraft = () => {
    const tag = normaliseTag(draft);
    if (!tag) return;
    // Typing a word that is already a tile picks that tile. Making a private copy of it is how
    // "history" ended up on screen twice -- one of them matchable, the other not.
    const existing = findByTag(ordered, tag);
    if (existing) {
      if (!selected.includes(existing.id)) setSelected([...selected, existing.id]);
    } else if (!findByTag(customInterests, tag)) {
      onAddInterest(tag);
    }
    setDraft("");
  };

  const body = (
    <>
      <div>
        <h2 className="section-label">What are you into?</h2>
        {/*
          Chosen sits on top and never scrolls -- it is the answer, not the question, and it is
          short enough to just wrap. Everything still available streams underneath it, one line,
          so thirty options never turn into a wall of tiles: pick one and it moves up here,
          unclick it and it goes back to streaming past below.
        */}
        <div id="interestTiles" className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {chosen.map((interest) => (
              <Tile key={interest.id} interest={interest} on onClick={() => toggle(interest.id)} />
            ))}
            {/* The same shape as a tile, so adding one does not read as a different feature --
                just an empty slot waiting for a word. Enter creates and selects it in one step.
                autoComplete is off on purpose: a bare text input with no name of its own is
                exactly what Chrome fills with whatever was typed into it last, and the strip of
                other people's old test tags in that dropdown had nothing to do with this field. */}
            <input
              id="addInterestInput"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Add interest"
              maxLength={40}
              value={draft}
              /* Lowercased as it is typed, rather than quietly on the way out. The server
                 already dedupes "Hari" and "hari" to one row by slug, so the two spellings
                 always did mean one interest -- but the tile then came back reading
                 differently from what was typed, or matching a tile the screen showed with a
                 capital. Showing the real thing while it is being typed is the honest half of
                 that dedupe. A phone also defaults to a capital on the first letter, which
                 nobody asked for on a tag. */
              onChange={(event) => setDraft(event.target.value.toLowerCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDraft();
              }}
              className="field w-[168px] px-4 py-2"
            />
          </div>

          {rest.length > 0 && <Ticker items={rest} onToggle={toggle} />}
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

      <div className="mt-6">
        {/* The button is the status: it becomes the search while one runs, and tapping it
            again stops it. Nothing appears beside it to push the layout around. */}
        <button
          id="findSomeone"
          type="button"
          className={searching ? "find-searching" : "btn-primary min-w-[190px]"}
          disabled={!searching && selected.length === 0}
          aria-busy={searching}
          title={searching ? "Tap to stop looking" : undefined}
          onClick={searching ? onCancelFind : onFind}
        >
          {searching ? (
            <>
              <span className="find-pulse" aria-hidden />
              {findStatus ? "Still looking" : "Looking"}
            </>
          ) : (
            "Find someone"
          )}
        </button>
        {findStatus && (
          <p id="findStatus" className="rise mt-2 mb-0 text-[11px]" style={{ color: "var(--color-faint)" }}>
            {findStatus}
          </p>
        )}
      </div>
    </>
  );

  return bare ? (
    body
  ) : (
    // grid-cols-1 is minmax(0, 1fr): an auto column would grow to the strip's whole scroll width,
    // and the panel would run off a phone screen with it.
    //
    // `safe center` and not plain centring: the panel is centred in the empty screen it used to
    // sit at the top of, but once the keyboard is up it is taller than what is left, and plain
    // centring pushes the first row off the top edge where nothing can scroll back to it. `safe`
    // falls back to start-aligned exactly in that case.
    <div
      className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto p-3.5 sm:p-6"
      style={{ placeItems: "safe center" }}
    >
      <div className="panel w-full max-w-[620px] p-4 sm:p-7">{body}</div>
    </div>
  );
};

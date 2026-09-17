import type { Delivery } from "@/lib/types";

/**
 * One tick when the broker has it, two when it is written and sequenced, two in colour once
 * the other person's read cursor has passed it. Read is the only state with colour, so it is
 * the only one anyone has to learn.
 */
export const Ticks = ({ state }: { state: Delivery }) => (
  <span
    data-testid="ticks"
    data-state={state}
    className="inline-flex h-[11px] w-[15px]"
    style={{
      color: state === "read" ? "var(--color-tick)" : state === "failed" ? "var(--color-danger)" : "inherit",
      opacity: state === "read" ? 1 : state === "pending" ? 0.55 : 0.75,
    }}
    aria-label={state === "failed" ? "not delivered" : state}
  >
    {state === "failed" ? (
      <svg viewBox="0 0 16 11" fill="none" className="h-full w-full">
        <circle cx="8" cy="5.5" r="4.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6.3 3.8l3.4 3.4M9.7 3.8l-3.4 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ) : state === "pending" ? (
      <svg viewBox="0 0 16 11" fill="none" className="h-full w-full">
        <circle cx="8" cy="5.5" r="4.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 3.2v2.5l1.7 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ) : state === "sent" ? (
      <svg viewBox="0 0 16 11" fill="none" className="h-full w-full">
        <path
          d="M1.5 6.2l3 3L11 2.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg viewBox="0 0 16 11" fill="none" className="h-full w-full">
        <path
          d="M1 6.2l3 3L10.5 2.2M6.2 9.2L12.7 2.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )}
  </span>
);

/**
 * The icons that appear in more than one place.
 *
 * <p>An icon drawn inline where it is used is fine while it is used once. The moment the same
 * thing is meant in two places -- a person in the requests button and a person in "add friend",
 * a burger in the app header and the same burger in the chat header -- two inline copies drift,
 * and the pair stops reading as the same idea. These are the shared ones; a glyph still used in
 * exactly one component stays inline there.
 */

/**
 * A person inside an envelope: requests waiting to be opened.
 *
 * <p>A bare person said "people" and nothing about why it was a button. The obvious
 * alternatives each said the wrong thing: a bell is notifications in general, an inbox tray is
 * mail, and a person with a badge is a profile. An envelope with somebody in it is the one
 * shape that carries both halves of what this holds -- it is about a person, and it is waiting
 * for an answer -- in two strokes and a filled head, with nothing overlapping at 18px.
 */
export const PersonInbox = ({ className = "h-[18px] w-[18px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} flex-none`} fill="none" aria-hidden>
    <circle cx="12" cy="7.1" r="2.9" fill="currentColor" />
    <path d="M7.6 12.4c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4Z" fill="currentColor" />
    <path
      d="M3.4 13.4h4.2l1.5 2.4h5.8l1.5-2.4h4.2v4.9a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * A person with a plus: asking to keep someone.
 *
 * <p>A bare "+" said only "add" without saying what, so this says who. The body is drawn
 * shifted left of centre to give the plus room without shrinking the figure -- and
 * {@link PersonCheck} repeats the shift exactly, so the two states do not jump.
 */
export const PersonPlus = ({ className = "h-[18px] w-[18px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} flex-none`} fill="currentColor" aria-hidden>
    <circle cx="9.2" cy="7.6" r="4.3" />
    <path d="M0.8 20.8c0-4.4 3.8-7.3 8.4-7.3s8.4 2.9 8.4 7.3Z" />
    <path d="M19.2 9.6h1.9v3.1H24v1.9h-2.9v3.1h-1.9v-3.1h-2.9v-1.9h2.9Z" />
  </svg>
);

/**
 * A person with a tick: you have already asked to keep this one.
 *
 * <p>The same figure as {@link PersonPlus}, shifted the same way, with the plus swapped for a
 * check -- so "ask" and "asked" read as two states of one control rather than two controls.
 * The phone header has no room for the words beside it, and a greyed-out plus alone says
 * "disabled" without ever saying why.
 */
export const PersonCheck = ({ className = "h-[18px] w-[18px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} flex-none`} fill="currentColor" aria-hidden>
    <circle cx="9.2" cy="7.6" r="4.3" />
    <path d="M0.8 20.8c0-4.4 3.8-7.3 8.4-7.3s8.4 2.9 8.4 7.3Z" />
    <path
      d="M17.4 14.1l2.1 2.1 4.1-4.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The burger. Opens the chats-and-friends drawer, from the app header and from a chat. */
export const Menu = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={`${className} flex-none`}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

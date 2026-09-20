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
 * A person with a list beside them: the requests waiting for an answer.
 *
 * <p>Three drawings, one figure, one mark changing -- {@link PersonPlus} is asking,
 * {@link PersonCheck} is having asked, and this is the pile of people asking you. It was an
 * envelope with a person inside it first, which at 18px was three overlapping shapes in the
 * space of a fingernail, and then the same figure with a dot, which is a smaller version of
 * the same problem: a mark that small cannot be told from the figure it sits on. Lines read
 * at any size, and they are the burger already used for "a list of things" in both headers.
 */
export const PersonRequests = ({ className = "h-[18px] w-[18px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} flex-none`} fill="currentColor" aria-hidden>
    <circle cx="9.2" cy="7.6" r="4.3" />
    <path d="M0.8 20.8c0-4.4 3.8-7.3 8.4-7.3s8.4 2.9 8.4 7.3Z" />
    <path
      d="M16.8 10.4H24M16.8 14.4H24M16.8 18.4H24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
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

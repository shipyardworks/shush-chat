/**
 * The icons that appear in more than one place.
 *
 * <p>An icon drawn inline where it is used is fine while it is used once. The moment the same
 * thing is meant in two places -- a person in the requests button and a person in "add friend",
 * a burger in the app header and the same burger in the chat header -- two inline copies drift,
 * and the pair stops reading as the same idea. These are the shared ones; a glyph still used in
 * exactly one component stays inline there.
 */

/** A person. The requests button, and the base that {@link PersonPlus} adds to. */
export const Person = ({ className = "h-[18px] w-[18px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} flex-none`} fill="currentColor" aria-hidden>
    <circle cx="12" cy="7.6" r="4.3" />
    <path d="M3.6 20.8c0-4.4 3.8-7.3 8.4-7.3s8.4 2.9 8.4 7.3Z" />
  </svg>
);

/**
 * A person with a plus: asking to keep someone.
 *
 * <p>The same person as the requests button, deliberately -- a request arriving and a request
 * being sent are two ends of one thing, and a bare "+" said only "add" without saying what.
 * The body is drawn shifted left of centre so the plus has room without shrinking the figure.
 */
export const PersonPlus = ({ className = "h-[18px] w-[18px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} flex-none`} fill="currentColor" aria-hidden>
    <circle cx="9.2" cy="7.6" r="4.3" />
    <path d="M0.8 20.8c0-4.4 3.8-7.3 8.4-7.3s8.4 2.9 8.4 7.3Z" />
    <path d="M19.2 9.6h1.9v3.1H24v1.9h-2.9v3.1h-1.9v-3.1h-2.9v-1.9h2.9Z" />
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

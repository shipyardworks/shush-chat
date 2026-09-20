/**
 * Every line the app says to a person, in one place.
 *
 * <p>Two reasons this is a file rather than strings where they are used. Wording drifts when it
 * is spread out -- the same event ended up described three different ways and at three
 * different lengths, and nothing showed that side by side. And these are the app talking about
 * itself, which is the writing most worth keeping honest: short, plain, and never claiming
 * something the server has not actually said.
 *
 * <p>The rule here is a sentence you can read without stopping. Seven or eight words is plenty;
 * a pill in the middle of a conversation is a caption, not a paragraph. "Asked to keep them.
 * You will hear back only if they say yes." said in thirteen words what four say.
 */
export const messages = {
  /** Pills in the conversation itself. The room talking, not either person. */
  event: {
    peerOffline: "They're offline. Messages will wait.",
    peerBack: "They're back.",
    youLeft: "You left.",
    theyLeft: "They left.",
    /** Your own ask, confirmed. The reply, if it comes, is the next line. */
    asked: "Asked to keep them.",
    alreadyAsked: "Already asked.",
    /** Their ask, on the receiving side -- which used to say nothing at all here. */
    theyAsked: "They asked to keep you.",
    nowFriends: "You're friends now.",
    /** Reopened from the list, already finished. Said once, where the date pills are. */
    over: "This conversation is over.",
    nothingYet: "Nothing here yet. Say something.",
    failed: (detail: string) => `Didn't work: ${detail}`,
  },

  /** Under the find button. Only ever one short line. */
  search: {
    /** The patience window ran out with nobody there -- the server says so, we repeat it. */
    nobody: "Nobody around. Try again.",
    /** "Forever" never gives up, so this is a reassurance rather than a result. */
    holdingOn: "Nobody yet. Still looking.",
  },

  /** Asking to keep someone, and being asked. */
  requests: {
    wantsToKeepYou: (name: string) => `${name} wants to keep you.`,
    none: "No requests yet.",
    /** The toast, when the chat header that would have shown it is scrolled away. */
    arrived: (name: string) => `${name} wants to keep you.`,
  },

  /** Saving an anonymous account -- the one thing the app ever nags about. */
  account: {
    warning: "Lose this browser, lose your chats.",
    why: "Keeps your chats. Sign in anywhere.",
  },

  /** The conversation header's second line. */
  peer: {
    randomMatch: "Random match",
    sharedInterests: (labels: string[]) => `You both like ${labels.join(" and ")}`,
    alreadyFriends: "Already friends",
  },
} as const;

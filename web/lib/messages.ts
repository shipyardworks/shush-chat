/**
 * Every line the app says to a person, in one place.
 *
 * <p>Two reasons this is a file rather than strings where they are used. Wording drifts when it
 * is spread out -- the same event ended up described three different ways and at three
 * different lengths, and nothing showed that side by side. And these are the app talking about
 * itself, which is the writing most worth keeping honest: short, plain, and never claiming
 * something the server has not actually said.
 *
 * <p>Two rules here. A sentence you can read without stopping -- seven or eight words is
 * plenty, a pill in the middle of a conversation is a caption, not a paragraph. And one other
 * person, never "they": every conversation in this app is exactly two people, so a line that
 * says "they're offline" describes a crowd that does not exist. Anything about the other person
 * takes their name, which is on screen anyway and is what you would actually say out loud.
 */
export const messages = {
  /** Pills in the conversation itself. The room talking, not either person. */
  event: {
    peerOffline: (name: string) => `${name} is offline. Messages will wait.`,
    peerBack: (name: string) => `${name} is back.`,
    youLeft: "You left.",
    peerLeft: (name: string) => `${name} left.`,
    /** Your own ask, confirmed. The reply, if it comes, is the next line. */
    asked: "Friend request sent.",
    alreadyAsked: "Request already sent.",
    /**
     * Their ask, on the receiving side -- which used to say nothing at all here, and then
     * said "they asked to keep you", which is the app's own private word for it rather than
     * the thing everybody already has a name for.
     */
    peerAsked: (name: string) => `${name} sent you a friend request.`,
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
    sentYouOne: (name: string) => `${name} sent you a friend request.`,
    none: "No requests yet.",
  },

  /**
   * Saving an anonymous account -- the one thing the app ever nags about.
   *
   * <p>Left long on purpose. Everything else here is a caption beside something that explains
   * itself; this is the only line that has to carry a consequence somebody has not thought of
   * yet, and the short version ("Lose this browser, lose your chats.") reads as a slogan
   * rather than as a warning about what is about to happen to their conversations.
   */
  account: {
    warning: "Your chats and friends will be lost if you don't save your account.",
    why: "Keep your chats and friends, and sign in from any device.",
  },

  /**
   * The buttons that start something, or end it.
   *
   * <p>One name for one action, wherever it is offered. Starting a conversation was called
   * "Find someone" on three screens and "Start chatting" on the front door, which is two names
   * for the one thing this app does -- and "someone" is the word that makes it sound like a
   * search through people rather than an introduction to one.
   */
  action: {
    find: "Start chatting",
    /** The same button in a friend's thread, where "new" is the part that is doing the work. */
    findNew: "Start chatting with someone new",
    /**
     * Out of this conversation and on to the next. It said "Leave", which named what happens
     * to the conversation rather than what anyone wants; "Switch" was closer and still made
     * somebody ask what was being switched. This is the word the whole category uses.
     */
    skip: "Skip",
    skipTitle: "Skip to someone else",
  },

  /** The conversation header's second line. */
  peer: {
    randomMatch: "Random match",
    sharedInterests: (labels: string[]) => `You both like ${labels.join(" and ")}`,
    alreadyFriends: "Already friends",
  },
} as const;

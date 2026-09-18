import type { Interest } from "./types";

/** Lowercase, one run of letters and digits, nothing else -- the same shape a curated tile has. */
export const normaliseTag = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The catalogue interest a typed tag names, if there is one -- "History " is the "history" tile. */
export const findByTag = (catalogue: Interest[], tag: string): Interest | undefined =>
  catalogue.find((interest) => normaliseTag(interest.label) === tag);

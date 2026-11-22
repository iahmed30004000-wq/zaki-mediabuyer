/** WHEN AN AGENT WAS LAST HEARD FROM — pure. The write is at most once a minute per agent. */
export const SEEN_EVERY_MS = 60_000;

/** Is it time to write «seen» again? `last` is when we last wrote it (null: never). */
export const shouldTouch = (last: number | null, now: number): boolean => last === null || now - last >= SEEN_EVERY_MS;

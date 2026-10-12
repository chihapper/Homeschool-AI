/**
 * How far a course build has got, as a percentage the parent can watch (the ring in the corner of the app).
 * Pure. A build has no exact total: the model writes the course as it goes and nobody knows its length in
 * advance, so the figure is an honest estimate that only ever moves forward and never reaches 100 before the
 * course is saved. The browser's upload is the first 5%; the server's stages take the rest:
 *
 * - reading the files (text, scans read by the model, transcripts): 5 to 15
 * - writing lessons and concepts (one call per part, in parallel): 15 to 96, from the characters each part has
 *   written against what a part of that size usually writes, plus a slow creep for the thinking before the
 *   first character arrives
 * - saving: 97; done: 100
 */
export type BuildStage = "reading" | "structuring" | "saving" | "done" | "failed";

export interface BuildState {
  stage: BuildStage;
  /** When the build started, and when it started writing the course (ms since the epoch). */
  startedAt: number;
  structuringAt?: number;
  /** Characters of source text in each part, and characters of course each part has written so far. */
  partSourceChars: number[];
  partOutChars: number[];
  /** The last figure shown, so the estimate never moves backwards. */
  shown?: number;
}

export const STAGE_LABEL: Record<BuildStage, string> = {
  reading: "Reading the files",
  structuring: "Writing the lessons and concepts",
  saving: "Saving the course",
  done: "Ready",
  failed: "Failed",
};

/** A part writes about one character of course per character of source; small parts still write a fair amount. */
export function expectedOutChars(sourceChars: number): number {
  return Math.max(20_000, 1.2 * sourceChars);
}

export function buildPercent(s: BuildState, now: number): number {
  let p: number;
  switch (s.stage) {
    case "reading":
      p = 5 + 10 * (1 - Math.exp(-(now - s.startedAt) / 20_000));
      break;
    case "structuring": {
      const secs = (now - (s.structuringAt ?? now)) / 1000;
      const parts = s.partSourceChars.length || 1;
      let sum = 0;
      for (let i = 0; i < parts; i++) {
        const progress = (s.partOutChars[i] ?? 0) / expectedOutChars(s.partSourceChars[i] ?? 0) + secs / 300;
        sum += 1 - Math.exp(-progress);
      }
      p = Math.min(96, 15 + 81 * (sum / parts));
      break;
    }
    case "saving":
      p = 97;
      break;
    case "done":
      p = 100;
      break;
    case "failed":
      p = s.shown ?? 0;
      break;
  }
  return Math.round(Math.max(p, s.shown ?? 0));
}

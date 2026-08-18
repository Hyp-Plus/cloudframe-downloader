import type { OrbState } from "thinking-orbs";
import type { TaskState } from "./download";

export { ThinkingOrb } from "thinking-orbs";
export type { OrbSize, OrbState, OrbTheme, ThinkingOrbProps } from "thinking-orbs";

/** Every animation supplied by thinking-orbs. */
export const orbStates = [
  "working", "searching", "solving", "listening", "connecting",
  "weaving", "composing", "breathing", "shaping",
] as const satisfies readonly OrbState[];

export const downloadOrbStates: Record<"idle" | "queued" | "downloading" | "complete" | "attention", OrbState> = {
  idle: "breathing",
  queued: "connecting",
  downloading: "working",
  complete: "shaping",
  attention: "solving",
};

export const taskOrbStates: Record<TaskState, OrbState> = {
  queued: "connecting",
  downloading: "working",
  paused: "breathing",
  cancelled: "shaping",
  completed: "shaping",
  failed: "solving",
};

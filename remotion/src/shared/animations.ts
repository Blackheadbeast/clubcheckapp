import { interpolate, Easing } from "remotion";

/** Fade in from 0 → 1 over `duration` frames starting at `start` */
export function fadeIn(frame: number, start: number, duration = 20): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/** Fade out from 1 → 0 over `duration` frames starting at `start` */
export function fadeOut(frame: number, start: number, duration = 20): number {
  return interpolate(frame, [start, start + duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
}

/** Slide up: translateY from `offset`px → 0 */
export function slideUp(
  frame: number,
  start: number,
  duration = 25,
  offset = 40
): number {
  return interpolate(frame, [start, start + duration], [offset, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/** Scale from `from` → `to` */
export function scale(
  frame: number,
  start: number,
  duration = 20,
  from = 0.85,
  to = 1
): number {
  return interpolate(frame, [start, start + duration], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(1.2)),
  });
}

/** Spring-like pop */
export function pop(frame: number, start: number, duration = 30): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(2)),
  });
}

/** Returns true if frame is within [start, end) */
export function inRange(frame: number, start: number, end: number): boolean {
  return frame >= start && frame < end;
}

/** Smooth step (0→1) over a range */
export function smooth(
  frame: number,
  start: number,
  end: number,
  from = 0,
  to = 1
): number {
  return interpolate(frame, [start, end], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
}

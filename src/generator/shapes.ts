/**
 * The footprint grammar — stage one's shape vocabulary.
 *
 * A plan is not sampled cell by cell. Independent per-cell draws produce
 * noise: a wall stranded mid-room, a door onto nothing, a room that never
 * closes. Instead a shape is drawn from a small grammar and then dimensioned,
 * and the only randomness is in the dimensions and the orientation.
 *
 * Every shape is returned as a list of axis-aligned rectangles whose union is
 * the floor. The rectangles are in reading order and each one after the first
 * shares an edge with the first, so the union is always connected. They may
 * touch but, as built here, never overlap; a caller that needs a partition
 * should still assign each cell to the first rectangle that contains it, so
 * that stays true even if a shape is added later that does overlap.
 */

import type { Rng } from '../core/types';
import type { ShapeName } from './profiles';

/** An axis-aligned block of cells. `x`/`y` are its top-left cell. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Whether `rect` contains the cell at `(x, y)`. */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/** The cell count of `rect`. */
export function rectArea(rect: Rect): number {
  return rect.w * rect.h;
}

/**
 * The smallest frame each shape needs. Below it the shape degenerates — an L
 * with a one-cell arm, a T with no stem — and `buildFootprint` falls back to
 * a plain rectangle instead of emitting a plan that reads as a mistake.
 */
const MIN_FRAME: Record<ShapeName, { w: number; h: number }> = {
  rectangle: { w: 1, h: 1 },
  l_shape: { w: 4, h: 4 },
  t_shape: { w: 5, h: 4 },
  alcove: { w: 5, h: 4 },
};

/**
 * The shape in its canonical orientation, inside a frame anchored at the
 * origin. `buildFootprint` reflects and transposes the result afterwards, so
 * each shape is written once rather than once per facing.
 */
function canonical(shape: ShapeName, frame: { w: number; h: number }, rng: Rng): Rect[] {
  const { w, h } = frame;
  const min = MIN_FRAME[shape];
  if (shape === 'rectangle' || w < min.w || h < min.h) {
    return [{ x: 0, y: 0, w, h }];
  }

  if (shape === 'l_shape') {
    // A rectangle with its bottom-right corner bitten off.
    const cutW = rng.int(Math.ceil(w / 4), Math.floor(w / 2));
    const cutH = rng.int(Math.ceil(h / 4), Math.floor(h / 2));
    return [
      { x: 0, y: 0, w, h: h - cutH },
      { x: 0, y: h - cutH, w: w - cutW, h: cutH },
    ];
  }

  if (shape === 't_shape') {
    // A full-width band across the top, with a narrower stem below it.
    const bandH = rng.int(Math.ceil(h / 3), Math.floor(h / 2));
    const stemW = rng.int(Math.ceil(w / 3), w - 2);
    const stemX = rng.int(1, w - stemW - 1);
    return [
      { x: 0, y: 0, w, h: bandH },
      { x: stemX, y: bandH, w: stemW, h: h - bandH },
    ];
  }

  // `alcove`: a main room with a shallow nook opening off its bottom edge.
  const nookH = rng.int(1, 2);
  const nookW = rng.int(2, Math.min(3, w - 2));
  const nookX = rng.int(1, w - nookW - 1);
  return [
    { x: 0, y: 0, w, h: h - nookH },
    { x: nookX, y: h - nookH, w: nookW, h: nookH },
  ];
}

/** `rect` mirrored left-to-right inside a frame `w` cells wide. */
function flipX(rect: Rect, w: number): Rect {
  return { x: w - rect.x - rect.w, y: rect.y, w: rect.w, h: rect.h };
}

/** `rect` mirrored top-to-bottom inside a frame `h` cells tall. */
function flipY(rect: Rect, h: number): Rect {
  return { x: rect.x, y: h - rect.y - rect.h, w: rect.w, h: rect.h };
}

/** `rect` with its axes swapped, which turns a `w`×`h` frame into `h`×`w`. */
function transpose(rect: Rect): Rect {
  return { x: rect.y, y: rect.x, w: rect.h, h: rect.w };
}

/**
 * The floor rectangles of a `shape` filling `interior`.
 *
 * `interior` is the area inside the wall ring: the caller insets it from the
 * grid edge so that the derived walls have somewhere to go.
 *
 * Randomness enters in three places and nowhere else — which way the shape
 * faces, and how deep and how wide its cuts are. The shape itself came from
 * the profile's grammar.
 */
export function buildFootprint(shape: ShapeName, interior: Rect, rng: Rng): Rect[] {
  const swapped = rng.int(0, 1) === 1;
  const frame = swapped ? { w: interior.h, h: interior.w } : { w: interior.w, h: interior.h };

  let rects = canonical(shape, frame, rng);
  if (rng.int(0, 1) === 1) {
    rects = rects.map((rect) => flipX(rect, frame.w));
  }
  if (rng.int(0, 1) === 1) {
    rects = rects.map((rect) => flipY(rect, frame.h));
  }
  if (swapped) {
    rects = rects.map(transpose);
  }

  return rects.map((rect) => ({
    x: rect.x + interior.x,
    y: rect.y + interior.y,
    w: rect.w,
    h: rect.h,
  }));
}

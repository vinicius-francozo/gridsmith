/**
 * The asset contract, and the validator that enforces it.
 *
 * Assets are **input, not output**: the library is supplied by whoever runs
 * the tool, and no third-party art is ever versioned here (the licence of the
 * pack this project is designed around forbids shipping it inside a software
 * product). That makes the library an untrusted boundary — the one place
 * where data the engine did not produce walks in — so it gets a validator
 * rather than a convention.
 *
 * What the map's asset contract asks for is: a fixed number of pixels per
 * cell, top-down orthographic projection, a transparent background, a known
 * anchor point, and a single light direction. Only the first and the fourth
 * are decidable from metadata; the rest are properties of the pixels and of
 * the art itself, and are checked by eye. This module states the machine-
 * checkable half and says plainly, in `validateBitmapSize`, where the line is.
 */

import { sizeToPixels } from '../core/grid';
import { PIXELS_PER_CELL } from '../core/types';
import type { AssetDef, AssetKind, PlacedProp, Rotation, Size } from '../core/types';

export { PIXELS_PER_CELL };
export type { AssetDef, AssetKind, AssetLibrary, Rotation } from '../core/types';

/** Every kind an asset may declare, so callers can iterate them exhaustively. */
export const ASSET_KINDS: readonly AssetKind[] = ['tile', 'anchor', 'group', 'scatter'];

/** Every legal rotation, in turning order. */
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** A size in pixels. Pixels exist only in `src/renderer/` and `src/assets/`. */
export type PixelSize = { w: number; h: number };

/** A rectangle in pixels, measured from the top-left of the canvas. */
export type PixelRect = { x: number; y: number; w: number; h: number };

/**
 * The largest footprint an asset may declare, in cells.
 *
 * The map itself is capped at 20x20, so an asset wider than that could never
 * be placed and is a data error rather than a large prop.
 */
export const MAX_FOOTPRINT_CELLS = 20;

/** Asset ids travel into file names in a real library, so they stay slug-safe. */
const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

/** One thing wrong with an asset, phrased for a human reading a report. */
export type ContractIssue = string;

/**
 * The asset id that carries a floor material and one of its variants.
 *
 * `TileRef` names a material and a variant, while `AssetLibrary` is keyed by
 * id alone — `bitmap(id, rotation)` has nowhere to put a variant. This is the
 * agreed spelling that joins the two, so the generator's vocabulary and the
 * library's file names cannot drift apart.
 *
 * @throws {RangeError} if `material` is empty or `variant` is not a
 *                      non-negative integer.
 */
export function tileAssetId(material: string, variant: number): string {
  if (material.length === 0) {
    throw new RangeError('material name must not be empty');
  }
  if (!Number.isInteger(variant) || variant < 0) {
    throw new RangeError(`tile variant must be a non-negative integer, got ${variant}`);
  }
  return `tile/${material}/${variant}`;
}

/**
 * The footprint an asset occupies once turned by `rotation`.
 *
 * A quarter turn swaps the axes: a 2x1 bench laid along a wall becomes 1x2
 * when it is stood against the wall at right angles to it. Getting this wrong
 * is invisible on square assets and wrong on every other one, which is why it
 * is a named function instead of an inline swap at each call site.
 *
 * @throws {RangeError} if `rotation` is not one of `ROTATIONS`. The type
 *                      forbids it, but the library is external data and may
 *                      arrive from JSON that TypeScript never saw.
 */
export function rotatedFootprint(footprint: Size, rotation: Rotation): Size {
  if (!ROTATIONS.includes(rotation)) {
    throw new RangeError(`rotation must be 0, 90, 180 or 270, got ${String(rotation)}`);
  }
  return rotation === 90 || rotation === 270
    ? { w: footprint.h, h: footprint.w }
    : { w: footprint.w, h: footprint.h };
}

/**
 * The pixel dimensions `bitmap(def.id, rotation)` is required to return.
 *
 * @throws {RangeError} if the footprint is not a positive whole size, or the
 *                      rotation is not one of `ROTATIONS`.
 */
export function expectedBitmapSize(def: AssetDef, rotation: Rotation): PixelSize {
  return sizeToPixels(rotatedFootprint(def.footprint, rotation));
}

/** Whether `size` is a whole number of cells on both axes, within the map cap. */
function footprintIssues(footprint: Size): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const axis of ['w', 'h'] as const) {
    const value = footprint[axis];
    if (!Number.isInteger(value) || value < 1) {
      issues.push(`footprint.${axis} must be a positive whole number of cells, got ${value}`);
    } else if (value > MAX_FOOTPRINT_CELLS) {
      issues.push(
        `footprint.${axis} is ${value} cells, larger than the ${MAX_FOOTPRINT_CELLS}-cell map cap`,
      );
    }
  }
  return issues;
}

/**
 * Everything wrong with one asset definition, or an empty array.
 *
 * Returns a list instead of throwing on the first problem so that a report
 * over a whole library names every fault at once; `assertAssetDef` is the
 * throwing form for callers that want to stop.
 */
export function validateAssetDef(def: AssetDef): ContractIssue[] {
  const issues: ContractIssue[] = [];

  // Every field is checked with `typeof` before it is used, because a manifest
  // entry can be missing one outright and the checks themselves coerce: passing
  // an absent id to `RegExp.test` turns it into the string "undefined", which
  // matches the slug pattern. Such an asset would be reported as clean, be
  // accepted by the library, be indexed under the key `undefined`, be returned
  // by `query()` — and then never resolve through `get()`, landing on the map
  // as a magenta rectangle out of a library the validator called sound.
  //
  // The guards are also what keeps this function's promise: it reports rather
  // than throws, so one bad line in a manifest names itself instead of taking
  // the whole report down with a TypeError on a missing property.
  if (typeof def.id !== 'string') {
    issues.push(`id must be a string, got ${typeof def.id}`);
  } else if (!ID_PATTERN.test(def.id)) {
    issues.push(
      `id ${JSON.stringify(def.id)} is not a slug: lowercase letters, digits, and "._/-" only`,
    );
  }
  if (!ASSET_KINDS.includes(def.kind)) {
    issues.push(`kind ${JSON.stringify(def.kind)} is not one of ${ASSET_KINDS.join(', ')}`);
  }

  if (typeof def.footprint !== 'object' || def.footprint === null) {
    // `typeof null` is "object", which is the one answer that tells the reader
    // of the report nothing: a footprint that is an object is a shape problem
    // and a footprint that is absent is a missing field, and they are fixed in
    // different places.
    issues.push(
      `footprint must be a size in cells, got ${
        def.footprint === null ? 'null' : typeof def.footprint
      }`,
    );
  } else {
    issues.push(...footprintIssues(def.footprint));

    // A `TileRef` describes exactly one cell, so a tile that claimed a larger
    // footprint would be drawn once per cell it covers and overlap itself.
    if (def.kind === 'tile' && (def.footprint.w !== 1 || def.footprint.h !== 1)) {
      issues.push(
        `a tile covers exactly one cell, but ${String(def.id)} declares ` +
          `${def.footprint.w}x${def.footprint.h}`,
      );
    }
  }

  // `againstWall` steers prop placement. On a floor tile it would be read by
  // nothing and silently mean nothing, so it is a mistake, not a no-op.
  if (def.kind === 'tile' && def.againstWall === true) {
    issues.push(`a tile cannot be against a wall: ${String(def.id)} sets againstWall`);
  }
  if (typeof def.againstWall !== 'boolean') {
    issues.push(`againstWall must be a boolean, got ${typeof def.againstWall}`);
  }

  if (!Array.isArray(def.tags)) {
    issues.push(`tags must be an array of strings, got ${typeof def.tags}`);
  } else {
    const seen = new Set<string>();
    for (const tag of def.tags) {
      if (typeof tag !== 'string') {
        issues.push(`tags must be strings, got ${typeof tag}`);
        continue;
      }
      if (tag.length === 0) {
        issues.push('tags must not contain an empty string');
      } else if (seen.has(tag)) {
        issues.push(`tag ${JSON.stringify(tag)} is listed twice`);
      }
      seen.add(tag);
    }
  }

  return issues;
}

/**
 * Validates `def` and stops on failure.
 *
 * @throws {TypeError} listing every violation, if `def` breaks the contract.
 */
export function assertAssetDef(def: AssetDef): void {
  const issues = validateAssetDef(def);
  if (issues.length > 0) {
    throw new TypeError(`asset ${def.id} breaks the contract: ${issues.join('; ')}`);
  }
}

/**
 * Everything wrong with a whole catalogue: each definition on its own, plus
 * the one rule that only exists between them — ids are unique.
 *
 * A duplicate id is the failure this catches that per-asset validation cannot:
 * `get()` would return whichever entry won, and the map would quietly draw the
 * wrong prop forever.
 */
export function validateCatalog(defs: readonly AssetDef[]): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const seen = new Set<string>();

  for (const def of defs) {
    for (const issue of validateAssetDef(def)) {
      issues.push(`${def.id}: ${issue}`);
    }
    if (seen.has(def.id)) {
      issues.push(`${def.id}: id is declared twice`);
    }
    seen.add(def.id);
  }

  return issues;
}

/**
 * Everything wrong with a bitmap the library handed back for `def`.
 *
 * This is the machine-checkable half of the asset contract: the art must be
 * drawn at exactly `PIXELS_PER_CELL` per cell, with the anchor at the
 * top-left of the footprint, so a bitmap's dimensions pin both. What it
 * cannot check is the other half — orthographic top-down projection, a
 * transparent background, and one consistent light direction — which live in
 * the pixels and in the drawing, and are judged by eye when a real library
 * arrives.
 */
export function validateBitmapSize(
  def: AssetDef,
  rotation: Rotation,
  actual: PixelSize,
): ContractIssue[] {
  const expected = expectedBitmapSize(def, rotation);
  if (actual.w === expected.w && actual.h === expected.h) {
    return [];
  }
  return [
    `bitmap at rotation ${rotation} is ${actual.w}x${actual.h}px, expected ` +
      `${expected.w}x${expected.h}px (${PIXELS_PER_CELL}px per cell)`,
  ];
}

/**
 * Everything wrong with a placement of `def` on the map.
 *
 * `PlacedProp.footprint` is the footprint **as placed** — already turned —
 * because the generator reserves cells in map space and validates clearance
 * there. `rotation` therefore describes how the art is turned into that
 * space, not a second, conflicting shape. If the two disagree, the generator
 * reserved one area and the renderer would paint another.
 */
export function validatePlacement(def: AssetDef, prop: PlacedProp): ContractIssue[] {
  const issues: ContractIssue[] = [];

  if (prop.assetId !== def.id) {
    issues.push(`placement names ${prop.assetId} but was checked against ${def.id}`);
    return issues;
  }
  if (def.kind === 'tile') {
    issues.push(`${def.id} is a floor tile and cannot be placed as a prop`);
  }
  if (def.kind !== prop.layer) {
    issues.push(`${def.id} is a ${def.kind} asset placed on the ${prop.layer} layer`);
  }

  const expected = rotatedFootprint(def.footprint, prop.rotation);
  if (prop.footprint.w !== expected.w || prop.footprint.h !== expected.h) {
    issues.push(
      `${def.id} placed at rotation ${prop.rotation} occupies ` +
        `${expected.w}x${expected.h} cells, but the placement reserves ` +
        `${prop.footprint.w}x${prop.footprint.h}`,
    );
  }

  return issues;
}

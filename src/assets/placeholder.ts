/**
 * The marking library: an asset library generated entirely by code.
 *
 * No image file is versioned in this repository, for two independent reasons.
 * `.gitignore` blocks `assets/library/`, and the licence of the asset pack
 * this project is designed around forbids bundling its art inside a software
 * product. The real library is supplied locally by whoever runs the tool.
 *
 * So the engine is built against markers: coloured rectangles carrying the
 * asset's id, its footprint and a readable label. They are not art and are not
 * trying to be. They exist so that placement, rotation, layering and shadows
 * are *visible and checkable* long before any real art exists — and so that a
 * map whose props are all in the wrong place looks obviously wrong instead of
 * merely ugly.
 *
 * Nothing here is random. Every colour is derived from the asset's id, so the
 * same seed draws the same picture twice; `Math.random` is never called.
 *
 * The module is split the same way the renderer is: `placeholderMarker` is a
 * pure description of what a marker looks like, testable in Node, and
 * `paintMarker` is the thin browser half that turns that description into
 * pixels.
 */

import { sizeToPixels } from '../core/grid';
import { PIXELS_PER_CELL } from '../core/types';
import type { AssetDef, AssetLibrary, AssetKind, Rotation, Size } from '../core/types';
import {
  expectedBitmapSize,
  rotatedFootprint,
  validateCatalog,
  ROTATIONS,
} from './contract';
import type { PixelRect, PixelSize } from './contract';
import { inkOn, markerColor } from './palette';

/** Which corner of a placed marker was the asset's own top-left, per rotation. */
export type AnchorCorner = 'nw' | 'ne' | 'se' | 'sw';

/**
 * A marker, described in full and in pixels, with no canvas involved.
 *
 * This is the placeholder library's half of the same split the renderer uses:
 * everything decidable is decided here, in a value a test can read.
 */
export type PlaceholderMarker = {
  id: string;
  kind: AssetKind;
  rotation: Rotation;
  /** The footprint as placed, already turned by `rotation`. */
  footprint: Size;
  /** `footprint` in pixels — what `bitmap()` must hand back. */
  size: PixelSize;
  background: string;
  border: string;
  borderWidth: number;
  ink: string;
  /** The asset's own name: the last segment of its id, made readable. */
  label: string;
  /** Footprint and kind, for reading placement off the image directly. */
  sublabel: string;
  /** Where the asset's own top-left ended up after the turn. */
  anchorCorner: AnchorCorner;
  /** A wedge drawn in that corner, so a wrong rotation is visible at a glance. */
  anchorMark: PixelRect;
};

/** The side of the square anchor wedge, in pixels. */
const ANCHOR_MARK_PX = 12;

/** Marker outlines are drawn inside the footprint, never straddling its edge. */
const BORDER_WIDTH_PX = 3;

/**
 * The floor and wall materials the generator emits, and how many variants each
 * one has, as this side of the frozen agreement recorded them.
 *
 * It is a **record, not a mechanism**, and the distinction is worth stating
 * plainly because the two look alike in a diff. The marking library serves no
 * tile bitmap at all (see `PLACEHOLDER_CATALOG`), and `materialColor` derives
 * a colour from any material name it is handed, so nothing in this repository
 * consults this table and nothing fails if it is wrong. It does **not** stop
 * the two vocabularies drifting apart: if the generator gains a material
 * tomorrow, every test here still passes.
 *
 * What it does is make the drift *readable*. The frozen list lives in the
 * plan, in prose; this is the same list in one place in the code, next to the
 * catalogue it belongs with, so that a person comparing the two sides has
 * somewhere to look. `placeholder.test.ts` pins it against an explicit
 * literal, which catches an accidental edit to the record — not a
 * disagreement with the generator, which only a person can see.
 */
export const MATERIAL_VARIANTS: Readonly<Record<string, number>> = {
  void: 1,
  wood_plank: 4,
  flagstone: 4,
  stone_floor: 3,
  dirt_floor: 3,
  stone_wall: 3,
  plaster_wall: 2,
  timber_wall: 2,
  tufa_column: 1,
};

/**
 * The catalogue: every prop the generator places, and **no floor tiles**.
 *
 * Names and footprints are the generator's, because its footprints are
 * structural — placement is computed from them, and a 5x2 counter behaves
 * differently from a 4x1 one. The id spelling is this side's, `<kind>/<name>`,
 * which is also how the four folders of a real library are laid out on disk.
 *
 * Tiles are left out on purpose. A labelled box is exactly right for a prop —
 * `bar counter 5x2` against a wall can be checked at a glance — and exactly
 * wrong for a floor, where the same box repeated four hundred times, with a
 * 3px border and a 12px anchor wedge in every cell, hides everything the map
 * is for. Floors are drawn as the flat colour `materialColor` derives from the
 * material and its variant, which still shows that the generator assigned
 * variants at all.
 */
export const PLACEHOLDER_CATALOG: readonly AssetDef[] = [
  // Anchors: the furniture that defines a room and is placed against a wall.
  { id: 'anchor/bar_counter', kind: 'anchor', footprint: { w: 5, h: 2 }, tags: ['bar', 'wood'], againstWall: true },
  { id: 'anchor/hearth', kind: 'anchor', footprint: { w: 3, h: 2 }, tags: ['hearth', 'stone', 'light'], againstWall: true },
  { id: 'anchor/hearth_small', kind: 'anchor', footprint: { w: 2, h: 1 }, tags: ['hearth', 'stone', 'light'], againstWall: true },
  { id: 'anchor/stairs_up', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['stairs', 'wood'], againstWall: true },
  { id: 'anchor/bed', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['bed', 'furniture', 'wood'], againstWall: true },
  { id: 'anchor/bunk_beds', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['bunks', 'bed', 'furniture', 'wood'], againstWall: true },
  { id: 'anchor/wardrobe', kind: 'anchor', footprint: { w: 2, h: 1 }, tags: ['storage', 'furniture', 'wood'], againstWall: true },
  { id: 'anchor/shelf_row', kind: 'anchor', footprint: { w: 4, h: 1 }, tags: ['shelving', 'storage', 'wood'], againstWall: true },
  { id: 'anchor/shelf_row_short', kind: 'anchor', footprint: { w: 3, h: 1 }, tags: ['shelving', 'storage', 'wood'], againstWall: true },
  { id: 'anchor/weapon_rack', kind: 'anchor', footprint: { w: 5, h: 2 }, tags: ['weapons', 'dungeon'], againstWall: true },
  { id: 'anchor/stone_hearth', kind: 'anchor', footprint: { w: 3, h: 2 }, tags: ['hearth', 'light', 'dungeon'], againstWall: true },
  { id: 'anchor/stone_stairs', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['stairs', 'stone'], againstWall: true },
  { id: 'anchor/cot', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['bed', 'dungeon'], againstWall: true },
  { id: 'anchor/iron_bunks', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['bunks', 'dungeon'], againstWall: true },
  { id: 'anchor/lockers', kind: 'anchor', footprint: { w: 2, h: 1 }, tags: ['storage', 'dungeon'], againstWall: true },
  { id: 'anchor/wall_rack', kind: 'anchor', footprint: { w: 3, h: 1 }, tags: ['shelving', 'dungeon'], againstWall: true },
  { id: 'anchor/wall_torch', kind: 'anchor', footprint: { w: 2, h: 1 }, tags: ['hearth', 'light', 'dungeon'], againstWall: true },
  { id: 'anchor/armory_rack', kind: 'anchor', footprint: { w: 4, h: 1 }, tags: ['shelving', 'weapons'], againstWall: true },

  // Groups: arrangements placed in the open, with room around them.
  { id: 'group/table_round', kind: 'group', footprint: { w: 2, h: 2 }, tags: ['table', 'seating', 'wood'], againstWall: false },
  { id: 'group/table_long', kind: 'group', footprint: { w: 3, h: 1 }, tags: ['table', 'seating', 'wood'], againstWall: false },
  { id: 'group/table_small', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['table', 'seating', 'wood'], againstWall: false },
  { id: 'group/chair', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['seating', 'wood'], againstWall: false },
  { id: 'group/bench', kind: 'group', footprint: { w: 3, h: 1 }, tags: ['seating', 'wood'], againstWall: false },
  { id: 'group/crate', kind: 'group', footprint: { w: 2, h: 1 }, tags: ['storage', 'crate', 'wood'], againstWall: false },
  { id: 'group/crate_small', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['storage', 'crate', 'wood'], againstWall: false },
  { id: 'group/barrel', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['storage', 'barrel', 'wood'], againstWall: false },
  { id: 'group/war_table', kind: 'group', footprint: { w: 2, h: 2 }, tags: ['table', 'dungeon'], againstWall: false },
  { id: 'group/guard_stool', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['seating', 'dungeon'], againstWall: false },
  { id: 'group/stone_bench', kind: 'group', footprint: { w: 3, h: 1 }, tags: ['seating', 'stone'], againstWall: false },
  { id: 'group/war_table_long', kind: 'group', footprint: { w: 3, h: 1 }, tags: ['table', 'dungeon'], againstWall: false },
  { id: 'group/prison_desk', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['table', 'dungeon'], againstWall: false },
  { id: 'group/supply_crate', kind: 'group', footprint: { w: 2, h: 1 }, tags: ['storage', 'dungeon'], againstWall: false },
  { id: 'group/small_crate', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['storage', 'dungeon'], againstWall: false },
  { id: 'group/weapon_bundle', kind: 'group', footprint: { w: 1, h: 1 }, tags: ['weapons', 'dungeon'], againstWall: false },

  // Scatter: one-cell litter, strewn over the floor.
  { id: 'scatter/mug', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['tableware', 'clutter'], againstWall: false },
  { id: 'scatter/stool', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['seating', 'wood'], againstWall: false },
  { id: 'scatter/bottle', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['tableware', 'clutter'], againstWall: false },
  { id: 'scatter/straw', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['clutter', 'debris'], againstWall: false },
  { id: 'scatter/sack', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['storage', 'clutter'], againstWall: false },
  { id: 'scatter/shard', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['clutter', 'debris'], againstWall: false },
  { id: 'scatter/bone', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['dungeon', 'debris'], againstWall: false },
  { id: 'scatter/broken_chain', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['dungeon', 'debris'], againstWall: false },
  { id: 'scatter/rubble', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['stone', 'debris'], againstWall: false },
  { id: 'scatter/dust', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['dungeon', 'debris'], againstWall: false },
  { id: 'scatter/loose_arrow', kind: 'scatter', footprint: { w: 1, h: 1 }, tags: ['weapons', 'debris'], againstWall: false },
];

/**
 * The corner that held the asset's top-left once it is turned `rotation`
 * degrees clockwise.
 *
 * The anchor is the contract's fourth clause, and it is the one thing about a
 * rotated asset that cannot be read off its silhouette. Drawing it means a
 * map rendered with every prop turned the wrong way looks wrong immediately.
 *
 * @throws {RangeError} if `rotation` is not one of `ROTATIONS`.
 */
export function anchorCorner(rotation: Rotation): AnchorCorner {
  switch (rotation) {
    case 0:
      return 'nw';
    case 90:
      return 'ne';
    case 180:
      return 'se';
    case 270:
      return 'sw';
    default:
      throw new RangeError(`rotation must be 0, 90, 180 or 270, got ${String(rotation)}`);
  }
}

/** The wedge rectangle for `corner`, inside a marker of `size`. */
function anchorMarkRect(corner: AnchorCorner, size: PixelSize): PixelRect {
  const side = Math.min(ANCHOR_MARK_PX, size.w, size.h);
  const x = corner === 'ne' || corner === 'se' ? size.w - side : 0;
  const y = corner === 'se' || corner === 'sw' ? size.h - side : 0;
  return { x, y, w: side, h: side };
}

/** `anchor/bar_counter` reads as `bar counter`. */
function readableName(id: string): string {
  const tail = id.slice(id.lastIndexOf('/') + 1);
  return tail.replace(/[_-]+/g, ' ');
}

/**
 * The full description of the marker for `def` at `rotation`, in pixels.
 *
 * @throws {RangeError} if `rotation` is not one of `ROTATIONS`, or `def` has a
 *                      footprint that is not a positive whole size.
 */
export function placeholderMarker(def: AssetDef, rotation: Rotation): PlaceholderMarker {
  const footprint = rotatedFootprint(def.footprint, rotation);
  const size = sizeToPixels(footprint);
  const background = markerColor(def.id);
  const corner = anchorCorner(rotation);

  return {
    id: def.id,
    kind: def.kind,
    rotation,
    footprint,
    size,
    background,
    border: inkOn(background),
    borderWidth: BORDER_WIDTH_PX,
    ink: inkOn(background),
    label: readableName(def.id),
    sublabel: `${footprint.w}x${footprint.h} ${def.kind}`,
    anchorCorner: corner,
    anchorMark: anchorMarkRect(corner, size),
  };
}

/**
 * Draws a marker onto an `OffscreenCanvas`. The thin, browser-only half.
 *
 * @throws {TypeError} if `OffscreenCanvas` or a 2d context is unavailable,
 *                     which is the case under the Node test environment.
 */
export function paintMarker(marker: PlaceholderMarker): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new TypeError(
      'placeholder bitmaps need OffscreenCanvas, which exists only in the browser; ' +
        'use placeholderMarker() to inspect a marker without drawing it',
    );
  }

  const canvas = new OffscreenCanvas(marker.size.w, marker.size.h);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new TypeError('could not get a 2d context for a placeholder bitmap');
  }

  const inset = marker.borderWidth / 2;
  ctx.fillStyle = marker.background;
  ctx.fillRect(0, 0, marker.size.w, marker.size.h);

  ctx.lineWidth = marker.borderWidth;
  ctx.strokeStyle = marker.border;
  ctx.strokeRect(inset, inset, marker.size.w - marker.borderWidth, marker.size.h - marker.borderWidth);

  const mark = marker.anchorMark;
  ctx.fillStyle = marker.ink;
  ctx.fillRect(mark.x, mark.y, mark.w, mark.h);

  ctx.fillStyle = marker.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(PIXELS_PER_CELL * 0.2)}px system-ui, sans-serif`;
  ctx.fillText(marker.label, marker.size.w / 2, marker.size.h / 2 - PIXELS_PER_CELL * 0.11, marker.size.w - ANCHOR_MARK_PX * 2);
  ctx.font = `400 ${Math.round(PIXELS_PER_CELL * 0.15)}px system-ui, sans-serif`;
  ctx.fillText(marker.sublabel, marker.size.w / 2, marker.size.h / 2 + PIXELS_PER_CELL * 0.11, marker.size.w - ANCHOR_MARK_PX * 2);

  return canvas;
}

/**
 * An `AssetLibrary` over `defs`, defaulting to `PLACEHOLDER_CATALOG`.
 *
 * @throws {TypeError} if the catalogue breaks the asset contract — a
 *                     duplicate id included, which `get()` would otherwise
 *                     resolve silently to whichever entry happened to win.
 */
export function createPlaceholderLibrary(
  defs: readonly AssetDef[] = PLACEHOLDER_CATALOG,
): AssetLibrary {
  const issues = validateCatalog(defs);
  if (issues.length > 0) {
    throw new TypeError(`placeholder catalogue breaks the asset contract: ${issues.join('; ')}`);
  }

  const index = new Map(defs.map((def) => [def.id, def]));

  return {
    get(id: string): AssetDef | undefined {
      return index.get(id);
    },

    /**
     * Every asset carrying *all* of `tags`, narrowed to `kind` when given.
     * An empty tag list matches everything, which is how a caller asks for a
     * whole kind.
     */
    query(tags: string[], kind?: AssetKind): AssetDef[] {
      return defs.filter(
        (def) =>
          (kind === undefined || def.kind === kind) &&
          tags.every((tag) => def.tags.includes(tag)),
      );
    },

    /**
     * The marker for `id`, already turned by `rotation` — the library hands
     * back rotated pixels so the executor never has to transform anything.
     *
     * @throws {RangeError} if `id` is not in the catalogue, or `rotation` is
     *                      not one of `ROTATIONS`.
     * @throws {TypeError} outside a browser, where there is no canvas to draw
     *                     on.
     */
    async bitmap(id: string, rotation: Rotation): Promise<ImageBitmap> {
      const def = index.get(id);
      if (def === undefined) {
        throw new RangeError(`no asset ${JSON.stringify(id)} in the placeholder catalogue`);
      }
      // Worded differently from `rotatedFootprint`'s identical check on
      // purpose. Both refuse the same value, so a test that only matched
      // "rotation must be 0, 90, 180 or 270" could not say which one fired,
      // and deleting this guard left the suite green — the call simply fell
      // through to the same message from two frames deeper. Naming the
      // library is what makes the boundary guard identifiable, in a report as
      // well as in a test.
      if (!ROTATIONS.includes(rotation)) {
        throw new RangeError(
          `the placeholder library was asked for rotation ${String(rotation)}; ` +
            'rotations are 0, 90, 180 and 270',
        );
      }
      const marker = placeholderMarker(def, rotation);
      // Belt and braces: the contract says the bitmap is the footprint times
      // PIXELS_PER_CELL, and this is the implementation that has to honour it.
      const expected = expectedBitmapSize(def, rotation);
      if (marker.size.w !== expected.w || marker.size.h !== expected.h) {
        throw new TypeError(`placeholder for ${id} would be the wrong size`);
      }

      // Painted first, on purpose. Written as `createImageBitmap(paintMarker(...))`
      // the missing global is resolved before its argument is evaluated, so
      // outside a browser the caller gets a bare `createImageBitmap is not
      // defined` instead of the explanation `paintMarker` is holding.
      const canvas = paintMarker(marker);
      if (typeof createImageBitmap === 'undefined') {
        throw new TypeError(
          'placeholder bitmaps need createImageBitmap, which exists only in the browser',
        );
      }
      return createImageBitmap(canvas);
    },
  };
}

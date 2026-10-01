/**
 * The executor: the second layer of the renderer.
 *
 * It walks a `DrawList` and calls canvas methods. It makes no decisions —
 * every colour, rectangle, alpha and ordering was settled by `buildDrawList`,
 * which is pure and covered by tests. Keeping this file free of judgement is
 * what makes it small enough to read in one sitting.
 *
 * There is no canvas in the Node test environment, but that is not the same as
 * untestable: `render.test.ts` drives everything below through a recording
 * stand-in and asserts the exact calls, which is how a transposed canvas or a
 * dropped command is caught. What genuinely waits for the browser is the
 * rasteriser's own behaviour — what the pixels look like once these calls
 * land.
 *
 * It never touches `document`. The caller supplies the canvas, which lets the
 * same code render into an on-screen `HTMLCanvasElement` and into an
 * `OffscreenCanvas` for export.
 */

import type { AssetDef, AssetLibrary, Rotation, Scene } from '../core/types';
import { validateBitmapSize, validateCatalog, validatePlacement } from '../assets/contract';
import { buildDrawList } from './drawlist';
import type { DrawList, DrawOptions, PixelLine } from './drawlist';

/** Either canvas the renderer can paint into. */
export type RenderTarget = HTMLCanvasElement | OffscreenCanvas;

/** What both canvases' 2d contexts have in common, which is all we use. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Drawn in place of an asset the library could not supply. */
const MISSING_ASSET_COLOR = '#ff00c8';

/**
 * Rejects a library whose own definitions break the asset contract.
 *
 * `contract.ts` calls the library an untrusted boundary — the one place where
 * data the engine did not produce walks in — and that is exactly why
 * `validateAssetDef` and `validateCatalog` exist. They were only ever run
 * inside `createPlaceholderLibrary`, that is, over the catalogue this
 * repository writes itself, and never over the library an author supplies.
 *
 * What slipped through: a floor tile whose definition claims a 2x2 footprint.
 * `validateBitmapSize` accepts its 140x140px bitmap, because the expected size
 * honours `def.footprint` — while a `fill` command always paints one cell. The
 * pack is scaled 2:1 onto the map, with no error and no magenta, which is the
 * very class of misalignment the size guard was written to stop. The clause
 * that catches it, "a tile covers exactly one cell", lives in
 * `validateAssetDef` and had nowhere to run.
 *
 * This runs it, over every definition the list will actually consult. It
 * refuses instead of drawing a marker, because a malformed definition is a
 * fault in the supplied data rather than one missing piece of art, and it is
 * the author's to fix before the map means anything.
 *
 * Definitions are gathered per distinct id the list asks for, which is also
 * what makes `validateCatalog`'s between-entries clause worth running here: a
 * library that answers two different ids with one definition would draw the
 * same prop in both places forever, and that shows up as a duplicate id in the
 * gathered list. The same reasoning covers a definition whose own `id`
 * disagrees with the id it was fetched under.
 *
 * @throws {TypeError} listing every fault at once.
 */
function assertLibraryDefs(list: DrawList, library: AssetLibrary): void {
  const issues: string[] = [];
  const defs: AssetDef[] = [];
  const asked = new Set<string>();

  for (const command of list.commands) {
    if (command.kind !== 'asset' && command.kind !== 'fill') {
      continue;
    }
    if (asked.has(command.assetId)) {
      continue;
    }
    asked.add(command.assetId);

    const def = library.get(command.assetId);
    if (def === undefined) {
      continue;
    }
    if (def.id !== command.assetId) {
      issues.push(
        `${command.assetId}: the library answers with a definition for ` +
          `${JSON.stringify(def.id)}`,
      );
    }
    defs.push(def);
  }

  issues.push(...validateCatalog(defs));
  if (issues.length > 0) {
    throw new TypeError(`the asset library breaks the contract: ${issues.join('; ')}`);
  }
}

/**
 * Resolves every bitmap the list needs, once per (id, rotation) pair.
 *
 * Bitmaps are fetched up front rather than inside the paint loop because the
 * paint loop must be synchronous: an `await` between two `drawImage` calls
 * would let another frame interleave and reorder the layers the draw list
 * went to the trouble of fixing.
 *
 * A bitmap the library cannot supply resolves to `undefined` rather than
 * rejecting: one bad prop should cost one magenta rectangle, not the whole
 * map, and magenta is loud enough that nobody ships it by accident. A bitmap
 * that breaks the size clause of the asset contract is treated the same way,
 * and for the same reason it was written: `drawImage` scales whatever it is
 * given into the rectangle asked for, so a pack drawn at 64px per cell would
 * come out *looking aligned* and be wrong by six pixels a cell all the way
 * across the map. The check costs one comparison per distinct (id, rotation)
 * pair per render — not per frame, since nothing here runs in a loop.
 *
 * Art is only ever asked for under an id the library will also *describe*. A
 * library that serves a bitmap from `bitmap()` and says nothing from `get()`
 * leaves the size clause with no expected size to compare against, and the
 * guard would be skipped on exactly the library it exists for; drawing that
 * bitmap anyway stretched a 9x9px image across 350x140px in silence. Such an
 * id is treated as missing, which the magenta rectangle already answers.
 *
 * A bitmap that is turned away is closed. `ImageBitmap` holds decoded pixels
 * outside the JavaScript heap, and dropping the reference leaves them to the
 * collector's whim — one leak per distinct (id, rotation) pair, per render,
 * for as long as the badly sized pack is in use.
 */
async function resolveBitmaps(
  list: DrawList,
  library: AssetLibrary,
): Promise<Map<string, ImageBitmap>> {
  const wanted = new Map<string, { id: string; rotation: Rotation; def: AssetDef }>();

  for (const command of list.commands) {
    if (command.kind !== 'asset' && command.kind !== 'fill') {
      continue;
    }
    const def = library.get(command.assetId);
    if (def === undefined) {
      continue;
    }
    wanted.set(`${command.assetId}@${command.rotation}`, {
      id: command.assetId,
      rotation: command.rotation,
      def,
    });
  }

  const resolved = new Map<string, ImageBitmap>();
  await Promise.all(
    [...wanted].map(async ([key, { id, rotation, def }]) => {
      try {
        const bitmap = await library.bitmap(id, rotation);
        if (validateBitmapSize(def, rotation, { w: bitmap.width, h: bitmap.height }).length > 0) {
          bitmap.close();
          return;
        }
        resolved.set(key, bitmap);
      } catch {
        // Left out of the map; the paint loop draws the missing marker.
      }
    }),
  );
  return resolved;
}

/**
 * Strokes the lines a `grid` command carries.
 *
 * Where they start, where they stop and the half pixel they are nudged by were
 * all decided in the draw list. This walks them.
 */
function paintGrid(
  ctx: Context2D,
  lines: readonly PixelLine[],
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const line of lines) {
    ctx.moveTo(line.from.x, line.from.y);
    ctx.lineTo(line.to.x, line.to.y);
  }
  ctx.stroke();
}

/**
 * Executes `list` onto `canvas`, resizing it to the list's own dimensions.
 *
 * @throws {TypeError} if the supplied library's definitions break the asset
 *                     contract, or if the canvas has no 2d context.
 */
export async function executeDrawList(
  list: DrawList,
  library: AssetLibrary,
  canvas: RenderTarget,
): Promise<void> {
  assertLibraryDefs(list, library);
  const bitmaps = await resolveBitmaps(list, library);

  // Assigning the size also clears the canvas, so a second render never shows
  // through the first.
  canvas.width = list.size.w;
  canvas.height = list.size.h;

  const ctx = canvas.getContext('2d') as Context2D | null;
  if (ctx === null) {
    throw new TypeError('the render target has no 2d context');
  }

  for (const command of list.commands) {
    switch (command.kind) {
      case 'fill': {
        ctx.fillStyle = command.color;
        ctx.fillRect(command.rect.x, command.rect.y, command.rect.w, command.rect.h);
        const tile = bitmaps.get(`${command.assetId}@${command.rotation}`);
        if (tile !== undefined) {
          ctx.drawImage(tile, command.rect.x, command.rect.y, command.rect.w, command.rect.h);
        }
        break;
      }
      case 'asset': {
        const bitmap = bitmaps.get(`${command.assetId}@${command.rotation}`);
        if (bitmap === undefined) {
          ctx.fillStyle = MISSING_ASSET_COLOR;
          ctx.fillRect(command.rect.x, command.rect.y, command.rect.w, command.rect.h);
        } else {
          ctx.drawImage(bitmap, command.rect.x, command.rect.y, command.rect.w, command.rect.h);
        }
        break;
      }
      case 'shade': {
        ctx.save();
        ctx.globalAlpha = command.alpha;
        ctx.fillStyle = command.color;
        ctx.fillRect(command.rect.x, command.rect.y, command.rect.w, command.rect.h);
        ctx.restore();
        break;
      }
      case 'door': {
        ctx.fillStyle = command.color;
        ctx.fillRect(command.rect.x, command.rect.y, command.rect.w, command.rect.h);
        ctx.fillStyle = command.thresholdColor;
        ctx.fillRect(
          command.threshold.x,
          command.threshold.y,
          command.threshold.w,
          command.threshold.h,
        );
        break;
      }
      case 'grid': {
        paintGrid(ctx, command.lines, command.color, command.lineWidth);
        break;
      }
      default: {
        // A command kind with no case here would be dropped in silence by the
        // one component whose whole job is to execute the list faithfully.
        // The `never` makes adding a kind a compile error instead.
        const unreachable: never = command;
        throw new TypeError(`unknown draw command: ${JSON.stringify(unreachable)}`);
      }
    }
  }
}

/**
 * Rejects a scene whose placements disagree with the library that will draw it.
 *
 * `PlacedProp.footprint` is the footprint **as placed**, already turned, and
 * `bitmap(id, rotation)` hands back art already turned to match. If a
 * generator writes the unturned footprint on a `bar_counter` placed at 90°,
 * the draw list reserves 350x140px while the library returns 140x350px, and
 * `drawImage` squeezes the art into the rectangle without a word: a prop
 * transposed on the map, no error, no magenta. This is the guard the frozen
 * contract was written for, run where it can catch that.
 *
 * Props the library does not know are left alone — a missing asset is already
 * answered by the magenta rectangle, and there is no definition to check
 * against.
 *
 * @throws {TypeError} listing every placement that breaks the contract.
 */
function assertPlacements(scene: Scene, library: AssetLibrary): void {
  const issues: string[] = [];
  for (const prop of scene.props) {
    const def: AssetDef | undefined = library.get(prop.assetId);
    if (def === undefined) {
      continue;
    }
    for (const issue of validatePlacement(def, prop)) {
      issues.push(`at (${prop.cell.x}, ${prop.cell.y}): ${issue}`);
    }
  }
  if (issues.length > 0) {
    throw new TypeError(`the scene breaks the asset contract: ${issues.join('; ')}`);
  }
}

/**
 * Renders a scene onto `canvas`.
 *
 * The canvas comes out exactly `Floorplan.size` times `PIXELS_PER_CELL` on
 * each axis, which is what keeps the exported image's grid on top of the
 * virtual tabletop's own.
 *
 * @throws {RangeError} if the scene is inconsistent — see `buildDrawList`.
 * @throws {TypeError} if a placement or a library definition breaks the asset
 *                     contract, or if the canvas has no 2d context.
 */
export async function renderScene(
  scene: Scene,
  library: AssetLibrary,
  canvas: RenderTarget,
  options: DrawOptions = {},
): Promise<void> {
  assertPlacements(scene, library);
  await executeDrawList(buildDrawList(scene, options), library, canvas);
}

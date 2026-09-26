/**
 * The executor: the second layer of the renderer.
 *
 * It walks a `DrawList` and calls canvas methods. It makes no decisions —
 * every colour, rectangle, alpha and ordering was settled by `buildDrawList`,
 * which is pure and covered by tests. Keeping this file free of judgement is
 * what makes the untestable half small enough to read in one sitting: there is
 * no canvas in the Node test environment, so everything below is verified in
 * the browser, during integration.
 *
 * It never touches `document`. The caller supplies the canvas, which lets the
 * same code render into an on-screen `HTMLCanvasElement` and into an
 * `OffscreenCanvas` for export.
 */

import type { AssetLibrary, Rotation, Scene } from '../core/types';
import { buildDrawList } from './drawlist';
import type { DrawList } from './drawlist';

/** Either canvas the renderer can paint into. */
export type RenderTarget = HTMLCanvasElement | OffscreenCanvas;

/** What both canvases' 2d contexts have in common, which is all we use. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Drawn in place of an asset the library could not supply. */
const MISSING_ASSET_COLOR = '#ff00c8';

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
 * map, and magenta is loud enough that nobody ships it by accident.
 */
async function resolveBitmaps(
  list: DrawList,
  library: AssetLibrary,
): Promise<Map<string, ImageBitmap>> {
  const wanted = new Map<string, { id: string; rotation: Rotation }>();

  for (const command of list.commands) {
    if (command.kind === 'asset') {
      wanted.set(`${command.assetId}@${command.rotation}`, {
        id: command.assetId,
        rotation: command.rotation,
      });
    } else if (command.kind === 'fill' && library.get(command.assetId) !== undefined) {
      wanted.set(`${command.assetId}@${command.rotation}`, {
        id: command.assetId,
        rotation: command.rotation,
      });
    }
  }

  const resolved = new Map<string, ImageBitmap>();
  await Promise.all(
    [...wanted].map(async ([key, { id, rotation }]) => {
      try {
        resolved.set(key, await library.bitmap(id, rotation));
      } catch {
        // Left out of the map; the paint loop draws the missing marker.
      }
    }),
  );
  return resolved;
}

/** Strokes the grid lines described by a `grid` command. */
function paintGrid(
  ctx: Context2D,
  size: { w: number; h: number },
  spacing: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  // Half-pixel offsets: a 1px line stroked on an integer coordinate is
  // straddled by the rasteriser and comes out two grey pixels wide.
  for (let x = spacing; x < size.w; x += spacing) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, size.h);
  }
  for (let y = spacing; y < size.h; y += spacing) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size.w, y + 0.5);
  }
  ctx.stroke();
}

/**
 * Executes `list` onto `canvas`, resizing it to the list's own dimensions.
 *
 * @throws {TypeError} if the canvas has no 2d context.
 */
export async function executeDrawList(
  list: DrawList,
  library: AssetLibrary,
  canvas: RenderTarget,
): Promise<void> {
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
      case 'grid': {
        paintGrid(ctx, command.size, command.spacing, command.color, command.lineWidth);
        break;
      }
    }
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
 * @throws {TypeError} if the canvas has no 2d context.
 */
export async function renderScene(
  scene: Scene,
  library: AssetLibrary,
  canvas: RenderTarget,
): Promise<void> {
  await executeDrawList(buildDrawList(scene), library, canvas);
}

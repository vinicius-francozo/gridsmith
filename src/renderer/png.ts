/**
 * Encoding the finished canvas as a PNG.
 *
 * PNG and not JPEG: the map is flat colour and hard edges, which JPEG turns to
 * mush along every wall, and a virtual tabletop needs the grid lines crisp.
 *
 * The header reading below is not decoration. The image is the product, and
 * its one hard invariant — width and height are whole multiples of 70, so the
 * grid drawn in the file lands on the tabletop's own grid — is checked here,
 * against the bytes that actually leave, rather than against the canvas we
 * believe we drew.
 */

import { PIXELS_PER_CELL } from '../core/types';
import type { PixelSize } from '../assets/contract';
import type { RenderTarget } from './render';

/**
 * The eight bytes every PNG starts with.
 *
 * The high bit of the first byte and the CRLF/LF pair exist to catch
 * transports that mangle text; they are also why eight bytes are enough to
 * tell a PNG from anything else with confidence.
 */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The number of leading bytes `readPngSize` needs: signature, length, `IHDR`, w, h. */
export const PNG_HEADER_BYTES = 24;

/** Whether `bytes` begins with the PNG signature. */
export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * The pixel dimensions declared in a PNG's `IHDR` chunk.
 *
 * `IHDR` is required by the format to be the first chunk, so its width and
 * height sit at fixed offsets 16 and 20, big-endian.
 *
 * @throws {TypeError} if `bytes` is not a PNG, is too short to hold a header,
 *                     or does not open with an `IHDR` chunk.
 */
export function readPngSize(bytes: Uint8Array): PixelSize {
  if (!isPngBytes(bytes)) {
    throw new TypeError('not a PNG: the file does not start with the PNG signature');
  }
  if (bytes.length < PNG_HEADER_BYTES) {
    throw new TypeError(
      `PNG is ${bytes.length} bytes, too short to hold an IHDR header`,
    );
  }

  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== 'IHDR') {
    throw new TypeError(`PNG opens with a ${JSON.stringify(chunkType)} chunk, expected IHDR`);
  }

  const beUint32 = (offset: number): number =>
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0;

  return { w: beUint32(16), h: beUint32(20) };
}

/**
 * Whether `size` is a whole number of grid cells on both axes.
 *
 * This is the invariant the tabletop cares about: an image whose height is
 * 1399px instead of 1400px lines up at the top-left and drifts a full cell out
 * by the bottom-right, which is only noticed mid-session.
 */
export function isGridAligned(size: PixelSize): boolean {
  return size.w % PIXELS_PER_CELL === 0 && size.h % PIXELS_PER_CELL === 0;
}

/** Promisified `HTMLCanvasElement.toBlob`, which is callback-shaped. */
function htmlCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        // `toBlob` yields null when the canvas has no pixels to encode, which
        // means a zero-sized canvas or one the browser refused to allocate.
        reject(new TypeError('the canvas produced no image data'));
      } else {
        resolve(blob);
      }
    }, 'image/png');
  });
}

/**
 * Encodes `canvas` as a PNG blob, and checks the bytes before handing them
 * over.
 *
 * Only the first 24 bytes are read back, so the check costs nothing next to
 * the encode itself.
 *
 * @throws {TypeError} if the canvas produced no image, if the result is not a
 *                     PNG, or if its dimensions do not match the canvas or are
 *                     not whole cells.
 */
export async function toPng(canvas: RenderTarget): Promise<Blob> {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await htmlCanvasToBlob(canvas);

  const header = new Uint8Array(await blob.slice(0, PNG_HEADER_BYTES).arrayBuffer());
  const size = readPngSize(header);

  if (size.w !== canvas.width || size.h !== canvas.height) {
    throw new TypeError(
      `the encoded PNG is ${size.w}x${size.h}px but the canvas is ` +
        `${canvas.width}x${canvas.height}px`,
    );
  }
  if (!isGridAligned(size)) {
    throw new TypeError(
      `the encoded PNG is ${size.w}x${size.h}px, which is not a whole number of ` +
        `${PIXELS_PER_CELL}px cells`,
    );
  }

  return blob;
}

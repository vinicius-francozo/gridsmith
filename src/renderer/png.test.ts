import { describe, expect, it } from 'vitest';

import { PIXELS_PER_CELL } from '../core/types';
import { PNG_SIGNATURE, isGridAligned, isPngBytes, readPngSize, toPng } from './png';
import type { RenderTarget } from './render';

/** A 24-byte PNG header declaring `width` x `height`, and nothing else. */
function header(width: number, height: number, chunkType = 'IHDR'): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  // Bytes 8..11 are the IHDR chunk length, which is always 13.
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([...chunkType].map((char) => char.charCodeAt(0)), 12);
  const beUint32 = (value: number): number[] => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
  bytes.set(beUint32(width), 16);
  bytes.set(beUint32(height), 20);
  return bytes;
}

describe('isPngBytes', () => {
  it('accepts the PNG signature', () => {
    expect(isPngBytes(header(70, 70))).toBe(true);
  });

  it('rejects a JPEG, which is what a browser falls back to when asked wrongly', () => {
    expect(isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(false);
  });

  it('rejects bytes that differ anywhere in the signature', () => {
    // Every byte of the signature is load-bearing: the high bit and the
    // CRLF/LF pair are there to catch transports that mangle the file.
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
      const bytes = header(70, 70);
      bytes[index] ^= 0xff;
      expect(isPngBytes(bytes)).toBe(false);
    }
  });

  it('rejects a buffer too short to hold the signature', () => {
    expect(isPngBytes(new Uint8Array(PNG_SIGNATURE.slice(0, 7)))).toBe(false);
    expect(isPngBytes(new Uint8Array(0))).toBe(false);
  });
});

describe('readPngSize', () => {
  it('reads the dimensions out of the IHDR chunk', () => {
    expect(readPngSize(header(1400, 700))).toEqual({ w: 1400, h: 700 });
  });

  it('keeps width and height in that order', () => {
    expect(readPngSize(header(350, 140))).toEqual({ w: 350, h: 140 });
  });

  it('reads all four bytes, not just the low two', () => {
    // A 16-bit read would give 4464 for a width of 70000. No map is that big,
    // but a truncating read is the kind of mistake that only shows up once.
    expect(readPngSize(header(70000, 1)).w).toBe(70000);
  });

  it('reads the width as unsigned', () => {
    // A signed read of a width with the high bit set comes out negative, and a
    // negative width compares unequal to every canvas without saying why.
    expect(readPngSize(header(0x80000000, 1)).w).toBe(2147483648);
  });

  it('rejects bytes that are not a PNG', () => {
    expect(() => readPngSize(new Uint8Array(24))).toThrow(/PNG signature/);
  });

  it('rejects a buffer too short to hold a header', () => {
    expect(() => readPngSize(header(70, 70).slice(0, 20))).toThrow(/too short/);
  });

  it('rejects a PNG whose first chunk is not IHDR', () => {
    // The format requires IHDR first. Anything else means the offsets 16 and
    // 20 hold something other than the dimensions.
    expect(() => readPngSize(header(70, 70, 'IDAT'))).toThrow(/expected IHDR/);
  });
});

describe('isGridAligned', () => {
  it('accepts a whole number of cells on both axes', () => {
    expect(isGridAligned({ w: 20 * PIXELS_PER_CELL, h: 3 * PIXELS_PER_CELL })).toBe(true);
  });

  it('rejects an image a single pixel short', () => {
    // One pixel lines up at the top-left and is a whole cell out by the
    // bottom-right, which is only ever noticed mid-session.
    expect(isGridAligned({ w: 1399, h: 1400 })).toBe(false);
    expect(isGridAligned({ w: 1400, h: 1401 })).toBe(false);
  });

  it('rejects the pitch other asset packs are drawn at', () => {
    expect(isGridAligned({ w: 64 * 10, h: 64 * 10 })).toBe(false);
  });
});

// --- Canvas stand-ins for `toPng` -------------------------------------------
//
// Only the browser's own encoder is out of reach under Node. The three guards
// around it, and the choice between the two kinds of canvas, are ordinary code
// and run here: they are what stands between a silently mis-sized export and
// the table.

/** An `OffscreenCanvas`-shaped target, which encodes through `convertToBlob`. */
function offscreenLike(
  width: number,
  height: number,
  bytes: Uint8Array<ArrayBuffer>,
  asked: string[] = [],
): RenderTarget {
  return {
    width,
    height,
    convertToBlob: async (options: { type: string }): Promise<Blob> => {
      asked.push(options.type);
      return new Blob([bytes], { type: options.type });
    },
  } as unknown as RenderTarget;
}

/** An `HTMLCanvasElement`-shaped target, which encodes through `toBlob`. */
function htmlLike(
  width: number,
  height: number,
  bytes: Uint8Array<ArrayBuffer> | null,
  asked: string[] = [],
): RenderTarget {
  return {
    width,
    height,
    toBlob: (callback: (blob: Blob | null) => void, type: string): void => {
      asked.push(type);
      callback(bytes === null ? null : new Blob([bytes], { type }));
    },
  } as unknown as RenderTarget;
}

describe('toPng', () => {
  it('hands back the encoded blob when the bytes check out', async () => {
    const blob = await toPng(offscreenLike(140, 70, header(140, 70)));
    expect(isPngBytes(new Uint8Array(await blob.arrayBuffer()))).toBe(true);
  });

  it('asks for a PNG, not whatever the browser would default to', async () => {
    // JPEG turns every wall and grid line on a battlemap to mush.
    const asked: string[] = [];
    await toPng(offscreenLike(140, 70, header(140, 70), asked));
    expect(asked).toEqual(['image/png']);
  });

  it('takes the callback path for a canvas that has no convertToBlob', async () => {
    const asked: string[] = [];
    const blob = await toPng(htmlLike(70, 70, header(70, 70), asked));
    expect(asked).toEqual(['image/png']);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('rejects when the canvas produced no image data at all', async () => {
    // `toBlob` yields null for a zero-sized canvas or one the browser refused
    // to allocate; unchecked, that null would travel as a download.
    await expect(toPng(htmlLike(70, 70, null))).rejects.toThrow(/no image data/);
  });

  it('rejects bytes that are not a PNG', async () => {
    const jpeg = new Uint8Array(24);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    await expect(toPng(offscreenLike(70, 70, jpeg))).rejects.toThrow(/not a PNG/);
  });

  it('rejects an image whose size is not the canvas it came from', async () => {
    await expect(toPng(offscreenLike(140, 70, header(70, 140)))).rejects.toThrow(
      /140x70px/,
    );
  });

  it('rejects an image that is not a whole number of cells', async () => {
    // Off by one pixel: it lines up at the top-left and drifts a full cell out
    // by the bottom-right, which is only ever noticed mid-session.
    await expect(toPng(offscreenLike(139, 70, header(139, 70)))).rejects.toThrow(
      /whole number of 70px cells/,
    );
  });

  it('reads back only the header, not the whole image', async () => {
    // The check is meant to cost nothing next to the encode. A blob of one
    // header plus a megabyte of payload still passes, and quickly.
    const bytes = new Uint8Array(24 + 1024);
    bytes.set(header(70, 70), 0);
    await expect(toPng(offscreenLike(70, 70, bytes))).resolves.toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';

import { PIXELS_PER_CELL } from '../core/types';
import { PNG_SIGNATURE, isGridAligned, isPngBytes, readPngSize } from './png';

/** A 24-byte PNG header declaring `width` x `height`, and nothing else. */
function header(width: number, height: number, chunkType = 'IHDR'): Uint8Array {
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

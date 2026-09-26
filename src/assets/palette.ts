/**
 * Deterministic colours for placeholder art.
 *
 * The real asset library does not exist yet, and by licence it never ships
 * inside this repository (see `README.md` and `.gitignore`). Until the author
 * supplies one locally, the engine draws itself with flat marker colours, and
 * those colours have to be *derived* rather than authored: the generator
 * invents material names this module has never seen.
 *
 * Every colour here is a pure function of a string. Nothing calls
 * `Math.random`: the same map drawn twice is the same image, byte for byte,
 * which is the invariant the whole project is built on.
 */

/** Void reads as absence, not as a material, so it never takes a hue. */
const VOID_COLOR = '#0b0d10';

/** The material name that `Scene.tiles` uses for a cell outside the plan. */
export const VOID_MATERIAL = 'void';

/**
 * FNV-1a over the UTF-16 code units of `text`, as an unsigned 32-bit integer.
 *
 * FNV-1a rather than a hand-rolled shift-and-add because it avalanches: two
 * material names differing in one letter (`stone_floor` / `stone_floor2`) have
 * to land on visibly different hues, or the placeholder map reads as one
 * undifferentiated smear and the zoning it is supposed to expose stays
 * invisible.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Clamps `value` into `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * An `#rrggbb` string for an HSL colour.
 *
 * @param hue        degrees; wrapped into `[0, 360)`
 * @param saturation percent, clamped into `[0, 100]`
 * @param lightness  percent, clamped into `[0, 100]`
 */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = l - chroma / 2;

  const sextant = Math.floor(h / 60) % 6;
  const rgb: [number, number, number] =
    sextant === 0 ? [chroma, secondary, 0]
    : sextant === 1 ? [secondary, chroma, 0]
    : sextant === 2 ? [0, chroma, secondary]
    : sextant === 3 ? [0, secondary, chroma]
    : sextant === 4 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];

  const channel = (value: number): string =>
    Math.round((value + base) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/**
 * Rejects a variant index that could not have come from the generator.
 *
 * @throws {RangeError} if `variant` is not a non-negative integer. A `-1` or a
 *                      `NaN` would otherwise fold into the lightness shift and
 *                      produce a colour, so a broken `TileRef` would render as
 *                      a perfectly plausible floor and never be noticed.
 */
function assertVariant(variant: number): void {
  if (!Number.isInteger(variant) || variant < 0) {
    throw new RangeError(`tile variant must be a non-negative integer, got ${variant}`);
  }
}

/** How many variants the lightness ladder tells apart before it repeats. */
export const VARIANT_LADDER_RUNGS = 4;

/**
 * The marker colour for a material, with variants of one material separated by
 * lightness only — they are the same floor, cut differently.
 *
 * **Known limit: the ladder has four rungs.** The lightness shift steps
 * through `VARIANT_LADDER_RUNGS` offsets and then repeats, so variant 4 is
 * drawn exactly as variant 0. Any pure map from an unbounded integer into a
 * bounded lightness range has to fold somewhere; this is where. It is not
 * reachable today — the richest materials in the frozen vocabulary,
 * `wood_plank` and `flagstone`, declare four variants each — and it becomes
 * reachable the moment one declares five, at which point two cuts of the same
 * floor become indistinguishable on the map. `palette.test.ts` pins the fold
 * so that it is a known limit rather than a surprise.
 *
 * @throws {RangeError} if `material` is empty, or `variant` is not a
 *                      non-negative integer.
 */
export function materialColor(material: string, variant: number): string {
  if (material.length === 0) {
    throw new RangeError('material name must not be empty');
  }
  assertVariant(variant);
  if (material === VOID_MATERIAL) {
    return VOID_COLOR;
  }

  const hash = hashString(material);
  const hue = hash % 360;
  // Muted on purpose: a battlemap floor is a backdrop, and saturated fills
  // would fight the props drawn on top of them.
  const saturation = 22 + ((hash >>> 9) % 16);
  const lightness = 30 + ((hash >>> 17) % 14) + ((variant % VARIANT_LADDER_RUNGS) * 4 - 6);
  return hslToHex(hue, saturation, lightness);
}

/**
 * The marker colour for an asset, keyed by its id. Brighter and more saturated
 * than a material: a prop has to be legible against the floor it stands on.
 *
 * @throws {RangeError} if `id` is empty.
 */
export function markerColor(id: string): string {
  if (id.length === 0) {
    throw new RangeError('asset id must not be empty');
  }
  const hash = hashString(id);
  return hslToHex(hash % 360, 46 + ((hash >>> 11) % 20), 46 + ((hash >>> 19) % 12));
}

/**
 * A readable ink colour for text laid over `background`.
 *
 * Uses the WCAG relative-luminance split rather than a plain lightness test,
 * because a saturated yellow and a saturated blue of the *same* HSL lightness
 * need opposite ink, and the placeholder label has to stay readable on both.
 *
 * @throws {RangeError} if `background` is not an `#rrggbb` string.
 */
export function inkOn(background: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(background);
  if (match === null) {
    throw new RangeError(`expected an #rrggbb colour, got ${background}`);
  }
  const hex = match[1];
  const linear = (offset: number): number => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(0) + 0.7152 * linear(2) + 0.0722 * linear(4);
  return luminance > 0.36 ? '#101215' : '#f2f4f7';
}

/**
 * The pixel art the page is dressed in: torches, banners, the beam, the floor,
 * the icons, the rat.
 *
 * Every sprite is drawn here, pixel by pixel, rather than shipped as an image.
 * That keeps the page to one request for its own code and its fonts, and it
 * keeps each piece editable as text — a sprite is either a grid of palette
 * letters (`fromRows`) or a few rectangles in a function.
 *
 * None of this is the map. The map is the renderer's, drawn from the asset
 * library; this module only decorates the room the map is shown in, and
 * nothing in it is read back by the generator, the interpreter or the export.
 *
 * Browser only: every function here creates a `<canvas>` through `document`.
 * `scene.ts` is the one caller, and it checks for a document before it calls.
 */

/** A drawn sprite, at one pixel per pixel. The page scales it with CSS. */
export type Sprite = HTMLCanvasElement;

/** Paints a rectangle in a palette letter, or in any CSS colour. */
type Pen = (x: number, y: number, w: number, h: number, colour: string) => void;

/** A seeded source of numbers in [0, 1), so a sprite comes out the same every load. */
type Rng = () => number;

/** The shared palette. Most sprites name colours by one of these letters. */
const PAL: Readonly<Record<string, string>> = {
  k: '#1a1410', n: '#2b1c12', w: '#5a3820', W: '#7a4d2b', h: '#9c6a3c',
  g: '#d9a441', G: '#f2cf72', o: '#8a6424',
  s: '#6d717a', S: '#9aa0a8', d: '#43464d', x: '#121012',
  r: '#9b2b2b', R: '#c9473a', e: '#b8431f', f: '#f08a2c', F: '#ffd35c', y: '#fff2b3',
  m: '#2f5d33', M: '#4c8a43', c: '#e2dccb', C: '#a59f8e', p: '#e8d6a8', P: '#bfa877',
  i: '#50545c', I: '#8a909a',
  v: '#57496a', V: '#7d6c94', b: '#0e1a2e', B: '#1c2f4d', q: '#dfe8f2',
};

/** Mulberry32. Decoration only: nothing here feeds the generator's own seeded RNG. */
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function context(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = cv.getContext('2d');
  if (ctx === null) {
    throw new TypeError('the browser gave no 2d context for a decoration sprite');
  }
  return ctx;
}

function pen(ctx: CanvasRenderingContext2D): Pen {
  return (x, y, w, h, colour) => {
    ctx.fillStyle = PAL[colour] ?? colour;
    ctx.fillRect(x, y, w, h);
  };
}

/** A sprite drawn from rows of palette letters; `.` is transparent. */
function fromRows(rows: readonly string[], palette: Readonly<Record<string, string>> = PAL): Sprite {
  const w = Math.max(...rows.map((row) => row.length));
  const cv = canvas(w, rows.length);
  const ctx = context(cv);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const colour = palette[ch] ?? PAL[ch];
      if (ch !== '.' && colour !== undefined) {
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      }
    });
  });
  return cv;
}

/**
 * A shape given as a test per pixel, outlined where it meets the background.
 *
 * `solid` may cover more than is painted: a key's hole counts as solid so that
 * its rim is not outlined, which is what keeps a 12-pixel ring from coming out
 * as solid black.
 */
function maskIcon(
  w: number,
  h: number,
  solid: (x: number, y: number) => boolean,
  paint: (x: number, y: number) => string,
): Sprite {
  const cv = canvas(w, h);
  const P = pen(context(cv));
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && solid(x, y);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      P(x, y, 1, 1, edge ? 'k' : paint(x, y));
    }
  }
  return cv;
}

// --- Hand-drawn rows ----------------------------------------------------------

const TORCH_BODY = [
  '..kkkkk...', '..kgggk...', '..kGgok...', '...kwk....', '...kWk....', '...kwk....',
  '...kWk....', '...kwk....', '.kkkWkkk..', '.kiIIIik..', '..kkikk...', '...kik....', '....k.....',
];
const TORCH_FLAMES = [
  ['....y.....', '...yFy....', '...FyF....', '..fFyFf...', '..fFFFf...', '.ffFFFff..', '.efFFFfe..', '..efffe...'],
  ['.....y....', '....yF....', '...yFFy...', '..fFyyFf..', '..fFFFFf..', '.ffFFFff..', '.efFFFfe..', '..efffe...'],
  ['...y......', '...Fy.....', '..yFFF....', '..fFyFf...', '.ffFFFf...', '.ffFFFff..', '.efFFFfe..', '..efffe...'],
];

const ANVIL = [
  '..kkkkkkkkkkkkkkkkkkkkkk..', '.kGGGGGGGGGGGGGGGGGGGGGGk.', 'kGgggggggggggggggggggggggk',
  'kkgggggggggggggggggggggok.', '..kkoooooooggggggggggok...', '.......kooggggggggok......',
  '........kogggggggok.......', '.........kgggggggk........', '.........kgggggggk........',
  '........kggggggggok.......', '.......kgGgggggggggok.....', '......kgggggggggggggok....',
  '......kooooooooooooook....', '......kkkkkkkkkkkkkkkk....',
];

const SKULL = [
  '...kkkkk...', '..kcccccck.', '.kccccccCck', '.kcxxcxxcCk', '.kcxxcxxcCk',
  '.kcccxcccCk', '..kcccccCk.', '..kcckcckk.', '...kkkkkk..',
];

const BAT = [
  '.......kk.......', '......kvvk......', '.....kvVvvk.....', '....kvVvvvvk....',
  '....kvRvvRvk....', '.....kvvvvk.....', '......kvvk......', '.......kk.......',
];

const ICON_ROWS: Readonly<Record<string, readonly string[]>> = {
  scroll: ['............', '.PPpppppppP.', '.Pppppppppk.', '..pkkkkkkp..', '..pppppppp..', '..pkkkkkkp..', '..pppppppp..', '..pkkkkp.p..', '..pppppppp..', '.Pppppppppk.', '.PPpppppppP.', '............'],
  sprout: ['............', '.....kk.....', '....kMMk.kk.', '....kMmMkMMk', '.kk.kmMkMMk.', 'kMMk.kmMmk..', 'kMmMkkmk....', '.kMmMkmk....', '..kkkkmk....', '.....kmk....', '...kkwWwkk..', '..kwWwWwWwk.'],
  grid: ['............', '.SSS.SSS.SSS', '.SSS.SSS.SSS', '.SSS.SSS.SSS', '............', '.SSS.SSS.SSS', '.SSS.SSS.SSS', '.SSS.SSS.SSS', '............', '.SSS.SSS.SSS', '.SSS.SSS.SSS', '.SSS.SSS.SSS'],
  download: ['.....GG.....', '.....GG.....', '.....GG.....', '..GGGGGGGG..', '...GGGGGG...', '....GGGG....', '.....GG.....', '............', 'G..........G', 'G..........G', 'GGGGGGGGGGGG', '............'],
};

// --- Icons --------------------------------------------------------------------

function hatIcon(): Sprite {
  // A wizard's hat in the classic blue, a gold band and one star.
  return fromRows(
    ['........kk..', '.......kHk..', '......kHBk..', '......kHBDk.', '.....kHGBDk.', '.....kHyBDk.', '....kHBBBDk.', '...kggGgggok', '.kkHHHHHHHkk', 'kBBBBBBBBBBk', '.kDDDDDDDDk.', '..kkkkkkkk..'],
    { B: '#2f5bbf', H: '#5b86e0', D: '#1c3a85' },
  );
}

function keyIcon(): Sprite {
  const ring = (x: number, y: number): boolean => Math.hypot(x + 0.5 - 3.5, y + 0.5 - 4.5) <= 3.6;
  const hole = (x: number, y: number): boolean => Math.hypot(x + 0.5 - 3.5, y + 0.5 - 4.5) <= 1.25;
  const shaft = (x: number, y: number): boolean => y >= 3 && y <= 5 && x >= 6 && x <= 11;
  const bit = (x: number, y: number): boolean =>
    x >= 8 && x <= 11 && y >= 6 && y <= 9 && !(x === 10 && y >= 7) && !(x === 11 && y === 9);
  return maskIcon(
    12,
    12,
    (x, y) => ring(x, y) || shaft(x, y) || bit(x, y),
    (x, y) => (hole(x, y) ? 'x' : y <= 3 ? 'G' : y >= 6 ? 'o' : 'g'),
  );
}

function hammerIcon(): Sprite {
  // A smith's hammer on the diagonal: an iron head lit from above, its
  // striking face brighter, and a wooden handle with a wrapped grip.
  const centre = [10, 5.6] as const;
  const along = [Math.SQRT1_2, Math.SQRT1_2] as const;
  const across = [-Math.SQRT1_2, Math.SQRT1_2] as const;
  const dot = (x: number, y: number, v: readonly [number, number]): number =>
    (x + 0.5 - centre[0]) * v[0] + (y + 0.5 - centre[1]) * v[1];
  const head = (x: number, y: number): boolean =>
    Math.abs(dot(x, y, along)) <= 5.3 && Math.abs(dot(x, y, across)) <= 2.4;
  const handle = (x: number, y: number): boolean => {
    const t = dot(x, y, across);
    return t >= 1.6 && t <= 13.8 && Math.abs(dot(x, y, along)) <= 1.6;
  };
  return maskIcon(16, 16, (x, y) => head(x, y) || handle(x, y), (x, y) => {
    if (head(x, y)) {
      const a = dot(x, y, along);
      return a > 3.5 ? 'S' : dot(x, y, across) < -0.5 ? 'I' : a < -3.5 ? 'd' : 'i';
    }
    const t = dot(x, y, across);
    if (t > 9.6) return Math.round(t) % 2 ? '#3b2a1c' : '#6a4a32';
    return dot(x, y, along) < 0 ? 'h' : 'W';
  });
}

function bookIcon(): Sprite {
  // Open, with writing on one page and a small map with a red X on the other.
  const cv = canvas(16, 16);
  const P = pen(context(cv));
  const ink = '#5a4632';
  P(0, 11, 16, 4, 'k'); P(1, 12, 14, 2, '#7a3b24'); P(1, 13, 14, 1, '#5a2a19');
  P(0, 2, 16, 11, 'k');
  P(1, 3, 14, 9, 'p'); P(1, 2, 6, 1, 'p'); P(9, 2, 6, 1, 'p');
  P(1, 1, 6, 1, 'k'); P(9, 1, 6, 1, 'k'); P(7, 2, 2, 1, 'k');
  P(1, 11, 14, 1, 'P');
  P(7, 3, 1, 8, 'P'); P(8, 3, 1, 8, 'C');
  P(2, 5, 4, 1, 'C'); P(2, 7, 4, 1, 'C'); P(2, 9, 3, 1, 'C');
  P(10, 4, 4, 1, ink); P(10, 4, 1, 4, ink); P(13, 4, 1, 4, ink); P(10, 7, 4, 1, ink); P(11, 5, 1, 1, ink);
  P(11, 9, 1, 1, 'R'); P(13, 9, 1, 1, 'R'); P(12, 10, 1, 1, 'R');
  P(12, 12, 2, 3, 'r'); P(12, 15, 1, 1, 'r');
  return cv;
}

// --- Textures -----------------------------------------------------------------

/** The wall: dark bricks in staggered rows, a little moss in the joints. */
export function stoneTile(): Sprite {
  const cv = canvas(64, 32);
  const ctx = context(cv);
  const r = rng(11);
  ctx.fillStyle = '#101115';
  ctx.fillRect(0, 0, 64, 32);
  const shades = ['#26292f', '#2b2e35', '#23252b', '#2f333a', '#272a30'];
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 8 : 0;
    for (let bx = -off; bx < 64; bx += 16) {
      const x = bx + 1;
      const y = row * 8 + 1;
      ctx.fillStyle = shades[(r() * shades.length) | 0] ?? shades[0];
      ctx.fillRect(x, y, 15, 7);
      ctx.fillStyle = '#ffffff10';
      ctx.fillRect(x, y, 15, 1);
      ctx.fillStyle = '#00000040';
      ctx.fillRect(x, y + 6, 15, 1);
      if (r() < 0.18) {
        ctx.fillStyle = '#2d4528';
        ctx.fillRect(x + ((r() * 12) | 0), y + 6, 3, 1);
      }
    }
  }
  return cv;
}

/** The ceiling beam, repeated across the top of the page. */
export function beamTile(): Sprite {
  const cv = canvas(32, 12);
  const P = pen(context(cv));
  const r = rng(41);
  P(0, 0, 32, 12, 'W'); P(0, 0, 32, 1, 'h'); P(0, 10, 32, 1, 'w'); P(0, 11, 32, 1, 'k');
  for (let i = 0; i < 6; i++) P((r() * 26) | 0, 2 + ((r() * 7) | 0), 3 + ((r() * 7) | 0), 1, 'w');
  P(20, 5, 2, 2, 'n'); P(21, 5, 1, 1, 'w');
  return cv;
}

/**
 * The floor: a stone skirting, its shadow, then three rows of flags that get
 * taller and lighter toward the viewer, so it reads as a plane and not a line.
 */
export function floorTile(): Sprite {
  const cv = canvas(48, 26);
  const P = pen(context(cv));
  const r = rng(91);
  P(0, 0, 48, 26, '#101114');
  for (let x = 0; x < 48; x += 12) {
    P(x, 0, 11, 4, '#4a4e56'); P(x, 0, 11, 1, '#6b7079'); P(x, 3, 11, 1, '#33363c');
  }
  P(0, 4, 48, 2, '#08090a');
  const rows: readonly (readonly [number, number, number, readonly string[]])[] = [
    [6, 5, 8, ['#2a2c31', '#26282d', '#2d2f35']],
    [12, 6, 12, ['#33363c', '#2f3237', '#373a40']],
    [19, 7, 16, ['#3c3f46', '#383b41', '#41444b']],
  ];
  for (const [y, h, w, tones] of rows) {
    const off = (y % 2) * (w / 2);
    for (let x = -off; x < 48; x += w) {
      P(x + 1, y, w - 1, h - 1, tones[(r() * tones.length) | 0] ?? tones[0] ?? '#333');
      P(x + 1, y, w - 1, 1, 'rgba(255,255,255,.07)');
      if (r() < 0.35) P(x + 2 + ((r() * (w - 5)) | 0), y + 2, 2, 1, 'rgba(0,0,0,.25)');
    }
  }
  return cv;
}

/** Aged parchment for the "Criar mapa" tag: fibres, specks and stains. */
export function parchmentTile(): Sprite {
  const cv = canvas(32, 16);
  const P = pen(context(cv));
  const r = rng(63);
  P(0, 0, 32, 16, '#e8d6a8');
  const flecks = ['#dcc795', '#f1e3bd', '#e2cf9e'];
  for (let i = 0; i < 60; i++) P((r() * 32) | 0, (r() * 16) | 0, 1, 1, flecks[(r() * 3) | 0] ?? '#dcc795');
  for (let i = 0; i < 6; i++) P((r() * 28) | 0, (r() * 16) | 0, 3 + ((r() * 5) | 0), 1, '#dfca99');
  for (let i = 0; i < 5; i++) P((r() * 31) | 0, (r() * 15) | 0, 1, 1, '#c3ab76');
  return cv;
}

// --- Procedural props ---------------------------------------------------------

function banner(): Sprite {
  const cv = canvas(20, 36);
  const P = pen(context(cv));
  P(0, 1, 20, 2, 'k'); P(1, 1, 18, 1, 'g'); P(0, 0, 2, 4, 'o'); P(18, 0, 2, 4, 'o');
  P(2, 3, 16, 25, 'k'); P(3, 3, 14, 25, 'g'); P(4, 3, 12, 25, 'm'); P(5, 3, 2, 25, 'M');
  for (let i = 0; i < 7; i++) {
    P(2 + i, 28 + i, 7 - i, 1, 'k'); P(3 + i, 28 + i, 5 - i, 1, i < 5 ? 'm' : 'g');
    P(11, 28 + i, 7 - i, 1, 'k'); P(11, 28 + i, 6 - i, 1, i < 5 ? 'm' : 'g');
  }
  // The project's emblem, a three-by-three grid in gold.
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const x = 5 + gx * 4;
      const y = 9 + gy * 4;
      P(x, y, 3, 3, 'g'); P(x, y, 1, 1, 'G'); P(x + 2, y + 2, 1, 1, 'o');
    }
  }
  return cv;
}

/** A strand of ivy `len` pixels long, different for every seed. */
export function vine(len: number, seed: number): Sprite {
  const r = rng(seed);
  const cv = canvas(12, len);
  const P = pen(context(cv));
  let x = 6;
  for (let y = 0; y < len; y++) {
    if (r() < 0.28) x += r() < 0.5 ? -1 : 1;
    x = Math.max(3, Math.min(8, x));
    P(x, y, 1, 1, '#24451f');
    if (y % 4 === 2 && y < len - 1) {
      const right = ((y / 4) | 0) % 2 === 0;
      const lx = right ? x + 1 : x - 3;
      P(lx, y - 1, 2, 1, 'M'); P(lx, y, 3, 1, 'm'); P(right ? lx + 1 : lx, y + 1, 2, 1, '#24451f');
      if (r() < 0.3) P(right ? lx + 2 : lx, y - 1, 1, 1, '#7bb26a');
    }
  }
  return cv;
}

/** An iron chain of `links` links, hanging straight down. */
export function chain(links: number): Sprite {
  const cv = canvas(6, links * 4 + 1);
  const P = pen(context(cv));
  for (let i = 0; i < links; i++) {
    const y = i * 4;
    if (i % 2 === 0) {
      P(1, y, 4, 5, 'k'); P(2, y + 1, 2, 3, 'x'); P(1, y, 4, 1, 'I'); P(1, y, 1, 4, 'I'); P(4, y + 1, 1, 4, 'i');
    } else {
      P(2, y, 2, 5, 'k'); P(2, y + 1, 1, 3, 'I'); P(3, y + 1, 1, 3, 'i');
    }
  }
  return cv;
}

function bracket(): Sprite {
  const cv = canvas(8, 14);
  const P = pen(context(cv));
  P(0, 0, 8, 14, 'k'); P(1, 0, 6, 13, 'i'); P(1, 0, 6, 1, 'I'); P(1, 0, 1, 13, 'I');
  P(3, 3, 2, 2, 'I'); P(3, 9, 2, 2, 'I'); P(4, 4, 1, 1, 'k'); P(4, 10, 1, 1, 'k');
  return cv;
}

function candles(frame: number): Sprite {
  const cv = canvas(22, 22);
  const P = pen(context(cv));
  const f = frame % 2;
  P(1, 19, 20, 2, 'o'); P(1, 19, 20, 1, 'g'); P(0, 21, 22, 1, 'k');
  for (const [x, t, w] of [[3, 9, 4], [9, 5, 5], [16, 12, 4]] as const) {
    P(x - 1, t, w + 2, 19 - t, 'k'); P(x, t, w, 19 - t, 'c'); P(x + w - 1, t + 1, 1, 18 - t, 'C');
    P(x, t + 2, 1, 3, 'c'); P(x - 1, t + 3, 1, 2, 'c'); P(x + w, t + 5, 1, 2, 'C');
    const cx = x + (w >> 1);
    P(cx, t - 1, 1, 1, 'k');
    P(cx - 1, t - 3, 3, 2, 'f'); P(cx - 1 + f, t - 5, 2, 3, 'F'); P(cx - f, t - 6, 1, 1, 'y');
  }
  return cv;
}

function books(): Sprite {
  const cv = canvas(36, 22);
  const P = pen(context(cv));
  P(0, 16, 26, 6, 'k'); P(1, 17, 24, 4, '#2f4b7a'); P(24, 17, 1, 4, 'p'); P(4, 17, 1, 4, 'g'); P(7, 17, 1, 4, 'g');
  P(2, 11, 22, 6, 'k'); P(3, 12, 20, 4, 'r'); P(3, 12, 20, 1, 'R'); P(22, 12, 1, 4, 'p'); P(6, 12, 2, 4, 'g');
  P(5, 7, 17, 5, 'k'); P(6, 8, 15, 3, 'm'); P(6, 8, 15, 1, 'M'); P(20, 8, 1, 3, 'p');
  P(27, 3, 5, 19, 'k'); P(28, 4, 3, 17, 'W'); P(28, 4, 3, 1, 'h'); P(28, 7, 3, 1, 'g'); P(28, 17, 3, 1, 'g');
  P(31, 6, 5, 16, 'k'); P(32, 7, 3, 14, '#4a2c5e'); P(32, 10, 3, 1, 'g');
  return cv;
}

function potions(): Sprite {
  const cv = canvas(26, 18);
  const P = pen(context(cv));
  P(1, 8, 9, 10, 'k'); P(2, 9, 7, 8, 'R'); P(2, 12, 7, 5, 'r'); P(4, 4, 3, 5, 'k'); P(5, 5, 1, 4, 'C'); P(4, 2, 3, 2, 'W'); P(3, 10, 1, 2, 'y');
  P(11, 2, 6, 16, 'k'); P(12, 3, 4, 14, 'M'); P(12, 8, 4, 9, 'm'); P(12, 0, 4, 3, 'W'); P(13, 4, 1, 4, '#b9e3a8');
  P(19, 9, 6, 9, 'k'); P(20, 10, 4, 7, '#3b6fb0'); P(20, 13, 4, 4, '#2a4f86'); P(20, 7, 4, 3, 'W'); P(21, 11, 1, 2, '#bcd4f5');
  return cv;
}

function shield(): Sprite {
  const cv = canvas(34, 40);
  const ctx = context(cv);
  const P = pen(ctx);
  P(16, 0, 3, 3, 'k'); P(17, 1, 1, 1, 'I');
  for (let t = 1; t < 6; t++) { P(17 - t * 2, 2 + t, 2, 1, 'P'); P(17 + t * 2 - 1, 2 + t, 2, 1, 'P'); }
  ctx.translate(0, 6);
  for (let i = 0; i < 30; i++) {
    P(2 + i, 1 + i, 2, 2, 'k'); P(3 + i, 1 + i, 1, 1, 'I');
    P(30 - i, 1 + i, 2, 2, 'k'); P(30 - i, 1 + i, 1, 1, 'I');
  }
  P(24, 21, 8, 2, 'g'); P(2, 21, 8, 2, 'g');
  P(28, 25, 3, 3, 'w'); P(3, 25, 3, 3, 'w');
  P(31, 29, 3, 3, 'g'); P(0, 29, 3, 3, 'g');
  for (let y = 5; y <= 30; y++) {
    const hw = y < 20 ? 11 : Math.max(0, 11 - Math.round((y - 20) * 1.15));
    P(17 - hw - 1, y, (hw + 1) * 2, 1, 'k');
    if (hw > 0) {
      P(17 - hw, y, hw * 2, 1, 'g');
      if (hw > 1) { P(17 - hw + 1, y, hw - 1, 1, 'R'); P(17, y, hw - 1, 1, 'r'); }
    }
  }
  P(6, 5, 22, 1, 'G');
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) P(13 + gx * 3, 11 + gy * 3, 2, 2, 'g');
  return cv;
}

function parchmentMap(): Sprite {
  const cv = canvas(32, 40);
  const P = pen(context(cv));
  const r = rng(77);
  const ink = '#5a4632';
  P(15, 0, 2, 2, 'i');
  for (let t = 0; t < 6; t++) { P(15 - t * 2, 2 + t, 1, 1, 'C'); P(16 + t * 2, 2 + t, 1, 1, 'C'); }
  P(1, 7, 30, 3, 'k'); P(2, 8, 28, 1, 'h');
  P(3, 10, 26, 25, 'p'); P(3, 10, 26, 1, 'P'); P(3, 34, 26, 1, 'P'); P(3, 10, 1, 25, 'P'); P(28, 10, 1, 25, 'P');
  for (let i = 0; i < 9; i++) P(4 + ((r() * 23) | 0), 11 + ((r() * 22) | 0), 1, 1, 'P');
  const box = (x: number, y: number, w: number, h: number): void => {
    P(x, y, w, 1, ink); P(x, y + h - 1, w, 1, ink); P(x, y, 1, h, ink); P(x + w - 1, y, 1, h, ink);
  };
  box(6, 13, 9, 7); box(17, 13, 9, 10); box(6, 22, 9, 9); P(15, 16, 2, 1, ink); P(10, 20, 1, 2, ink);
  for (let i = 0; i < 6; i++) P(9 + i * 2, 27, 1, 1, 'r');
  P(20, 25, 1, 1, 'R'); P(22, 25, 1, 1, 'R'); P(21, 26, 1, 1, 'R'); P(20, 27, 1, 1, 'R'); P(22, 27, 1, 1, 'R');
  P(1, 35, 30, 3, 'k'); P(2, 36, 28, 1, 'h');
  return cv;
}

function barrel(): Sprite {
  const cv = canvas(18, 22);
  const P = pen(context(cv));
  P(2, 0, 14, 22, 'k'); P(1, 3, 16, 16, 'k'); P(3, 1, 12, 20, 'W'); P(2, 4, 14, 14, 'W');
  P(6, 1, 1, 20, 'w'); P(11, 1, 1, 20, 'w'); P(4, 2, 1, 18, 'h');
  P(1, 5, 16, 2, 'i'); P(1, 15, 16, 2, 'i'); P(1, 5, 16, 1, 'I'); P(1, 15, 16, 1, 'I');
  return cv;
}

function cobweb(): Sprite {
  const cv = canvas(30, 30);
  const ctx = context(cv);
  ctx.fillStyle = '#d8d2c4';
  ctx.globalAlpha = 0.5;
  const dot = (x: number, y: number): void => ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  const spokes = [0, 18, 36, 54, 72, 90].map((a) => (a * Math.PI) / 180);
  for (const a of spokes) for (let r = 0; r < 30; r += 0.5) dot(29 - r * Math.cos(a), r * Math.sin(a));
  for (const radius of [7, 13, 19, 25]) {
    for (let s = 0; s < spokes.length - 1; s++) {
      const from = spokes[s] ?? 0;
      const to = spokes[s + 1] ?? 0;
      for (let t = 0; t <= 1; t += 0.04) {
        const a = from + (to - from) * t;
        const sag = radius - 1.6 * Math.sin(t * Math.PI);
        dot(29 - sag * Math.cos(a), sag * Math.sin(a));
      }
    }
  }
  return cv;
}

function windowArch(): Sprite {
  const cv = canvas(28, 36);
  const P = pen(context(cv));
  for (let y = 0; y < 36; y++) {
    for (let x = 0; x < 28; x++) {
      const dx = x - 13.5;
      const d = Math.hypot(dx, y - 12);
      const outer = y < 12 ? d <= 13 : Math.abs(dx) <= 13 && y <= 32;
      const inner = y < 12 ? d <= 9.5 : Math.abs(dx) <= 9.5 && y <= 30;
      if (!outer) continue;
      if (!inner) P(x, y, 1, 1, (x * 3 + y * 5) % 11 === 0 ? 'd' : (y < 12 && d > 12) || Math.abs(dx) > 12.5 ? 'k' : 's');
      else P(x, y, 1, 1, y < 16 ? 'b' : 'B');
    }
  }
  P(17, 6, 3, 3, 'q'); P(18, 5, 1, 1, 'q'); P(16, 7, 1, 1, 'q'); P(19, 7, 1, 1, 'b');
  for (const [x, y] of [[8, 9], [11, 5], [21, 13], [7, 18], [20, 22]] as const) P(x, y, 1, 1, 'y');
  for (const x of [9, 14, 19]) { P(x, 3, 1, 28, 'i'); P(x - 1, 3, 1, 28, 'k'); }
  P(4, 19, 20, 1, 'i'); P(4, 20, 20, 1, 'k');
  P(1, 31, 26, 2, 'S'); P(1, 33, 26, 3, 's'); P(1, 35, 26, 1, 'k');
  return cv;
}

function lantern(frame: number): Sprite {
  const cv = canvas(14, 24);
  const P = pen(context(cv));
  const f = frame % 2;
  P(5, 0, 4, 2, 'k'); P(6, 0, 2, 1, 'I');
  P(3, 2, 8, 3, 'k'); P(4, 3, 6, 1, 'i');
  P(2, 5, 10, 13, 'k'); P(3, 6, 8, 11, '#e9a640'); P(4, 7, 6, 9, 'F');
  P(6, 10 - f, 2, 5 + f, 'y'); P(5 + f, 12, 1, 3, 'f');
  P(2, 5, 1, 13, 'i'); P(11, 5, 1, 13, 'i'); P(6, 5, 2, 1, 'i');
  P(3, 18, 8, 2, 'k'); P(4, 18, 6, 1, 'i'); P(6, 20, 2, 2, 'k');
  return cv;
}

function shackle(): Sprite {
  const cv = canvas(10, 22);
  const P = pen(context(cv));
  P(2, 0, 6, 4, 'k'); P(3, 1, 4, 2, 'i'); P(3, 1, 1, 1, 'I');
  for (let i = 0; i < 3; i++) { const y = 4 + i * 3; P(4, y, 2, 3, 'k'); P(4, y, 1, 3, i % 2 ? 'i' : 'I'); }
  for (let a = 0; a < 360; a += 12) {
    const t = (a * Math.PI) / 180;
    P(Math.round(5 + 3.6 * Math.cos(t)) - 1, Math.round(17 + 3.6 * Math.sin(t)), 2, 1, a < 180 ? 'i' : 'I');
  }
  return cv;
}

function crack(seed: number): Sprite {
  const cv = canvas(12, 16);
  const P = pen(context(cv));
  const r = rng(seed);
  let x = 6;
  for (let y = 0; y < 16; y++) {
    x += r() < 0.45 ? (r() < 0.5 ? -1 : 1) : 0;
    x = Math.max(1, Math.min(10, x));
    P(x, y, 1, 1, '#08080a');
    if (r() < 0.3) P(x + 1, y, 1, 1, '#ffffff12');
    if (y === 7) for (let k = 1; k < 5; k++) P(x + k, y + k, 1, 1, '#08080a');
  }
  return cv;
}

function moss(): Sprite {
  const cv = canvas(12, 6);
  const P = pen(context(cv));
  const r = rng(5);
  const greens = ['M', 'm', '#24451f'];
  for (let i = 0; i < 30; i++) {
    const x = (r() * 12) | 0;
    const y = (r() * 6) | 0;
    if (Math.abs(x - 6) / 6 + y / 6 < 1.1) P(x, y, 1, 1, greens[(r() * 3) | 0] ?? 'M');
  }
  return cv;
}

function rat(frame: number): Sprite {
  // Side view, facing right. The body is a mask so every edge pixel gets its
  // outline and the inside gets three tones — back, flank, belly; the tail
  // leaves the haunch, runs along the floor and curls up at the tip.
  const cv = canvas(30, 11);
  const ctx = context(cv);
  const P = pen(ctx);
  for (const [x, y] of [[10, 6], [9, 6], [8, 6], [7, 6], [6, 7], [5, 7], [4, 7], [3, 8], [2, 8], [1, 8], [0, 7], [0, 6], [1, 5]] as const) P(x, y, 1, 1, '#b58c86');
  for (const [x, y] of [[5, 6], [3, 7], [1, 7]] as const) P(x, y, 1, 1, '#8f6964');
  ctx.translate(6, 0);
  const runs: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
    1: [[15, 17]], 2: [[8, 12], [14, 18]], 3: [[6, 19]], 4: [[5, 21]], 5: [[4, 22]], 6: [[4, 21]], 7: [[5, 19]], 8: [[7, 16]],
  };
  const inMask = (x: number, y: number): boolean => (runs[y] ?? []).some(([a, b]) => x >= a && x <= b);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 24; x++) {
      if (!inMask(x, y)) continue;
      const edge = !inMask(x - 1, y) || !inMask(x + 1, y) || !inMask(x, y - 1) || !inMask(x, y + 1);
      P(x, y, 1, 1, edge ? '#2a211c' : y <= 3 ? '#9c8f83' : y >= 7 ? '#c2b5a5' : '#7a6d62');
    }
  }
  P(16, 2, 1, 1, '#e29a9a'); P(15, 2, 1, 1, '#c27a7a');
  P(19, 4, 1, 1, '#120d0b'); P(19, 3, 1, 1, '#cfc6ba');
  P(22, 5, 1, 1, '#e29a9a');
  P(23, 4, 1, 1, 'rgba(220,214,204,.7)'); P(23, 6, 1, 1, 'rgba(220,214,204,.7)');
  const legs = frame % 2
    ? ([[9, 9], [9, 10], [14, 9], [14, 10]] as const)
    : ([[8, 9], [7, 10], [15, 9], [16, 10]] as const);
  for (const [x, y] of legs) P(x, y, 1, 1, y === 10 ? '#d99a92' : '#2a211c');
  return cv;
}

function crates(): Sprite {
  const cv = canvas(26, 24);
  const P = pen(context(cv));
  const crate = (x: number, y: number, w: number, h: number): void => {
    P(x, y, w, h, 'k'); P(x + 1, y + 1, w - 2, h - 2, 'W'); P(x + 1, y + 1, w - 2, 1, 'h');
    for (let i = 0; i < w - 4; i++) P(x + 2 + i, y + 2 + Math.round((i * (h - 5)) / (w - 5)), 1, 1, 'w');
    P(x + 1, y + (h >> 1), w - 2, 1, 'w');
  };
  crate(0, 11, 16, 13); crate(15, 14, 11, 10); crate(3, 0, 12, 11);
  return cv;
}

function sack(): Sprite {
  const cv = canvas(14, 15);
  const P = pen(context(cv));
  [4, 4, 6, 8, 10, 12, 12, 12, 12, 12, 12, 12, 10].forEach((w, i) => {
    const x = 7 - (w >> 1);
    P(x - 1, i + 2, w + 2, 1, 'k'); P(x, i + 2, w, 1, i > 6 ? 'C' : 'P');
  });
  P(5, 1, 4, 2, 'w'); P(6, 0, 2, 1, 'k'); P(4, 8, 1, 3, 'P'); P(9, 6, 2, 1, 'C');
  return cv;
}

function chest(): Sprite {
  const cv = canvas(18, 14);
  const P = pen(context(cv));
  P(1, 1, 16, 13, 'k'); P(2, 0, 14, 2, 'k'); P(2, 2, 14, 4, 'h'); P(3, 1, 12, 1, 'h'); P(2, 6, 14, 1, 'w');
  P(2, 7, 14, 6, 'W'); P(4, 1, 1, 12, 'i'); P(13, 1, 1, 12, 'i'); P(8, 5, 2, 4, 'g'); P(8, 7, 2, 1, 'o');
  return cv;
}

/** Bones, coins, straw and pebbles, spread along a strip of floor. */
export function litter(seed: number): Sprite {
  const cv = canvas(110, 8);
  const P = pen(context(cv));
  const r = rng(seed);
  for (let i = 0; i < 3; i++) {
    const x = (r() * 100) | 0;
    const y = 2 + ((r() * 4) | 0);
    P(x, y, 5, 1, 'c'); P(x - 1, y - 1, 1, 3, 'C'); P(x + 5, y - 1, 1, 3, 'C');
  }
  for (let i = 0; i < 4; i++) { const x = (r() * 104) | 0; const y = 1 + ((r() * 6) | 0); P(x, y, 2, 1, 'g'); P(x, y, 1, 1, 'G'); }
  for (let i = 0; i < 7; i++) { const x = (r() * 104) | 0; const y = (r() * 6) | 0; for (let k = 0; k < 3; k++) P(x + k, y + (k >> 1), 1, 1, 'P'); }
  for (let i = 0; i < 6; i++) P((r() * 108) | 0, (r() * 7) | 0, 2, 1, r() < 0.5 ? 's' : 'd');
  return cv;
}

// --- The catalogue ------------------------------------------------------------

/**
 * Every named sprite, as its frames. One frame for a still piece; more for the
 * ones that flicker or run, which `scene.ts` steps through.
 */
export function drawSprites(): Readonly<Record<string, readonly Sprite[]>> {
  const sprites: Record<string, Sprite[]> = {
    torch: TORCH_FLAMES.map((flame) => fromRows([...flame, ...TORCH_BODY])),
    anvil: [fromRows(ANVIL)],
    banner: [banner()],
    bracket: [bracket()],
    candles: [candles(0), candles(1)],
    books: [books()],
    potions: [potions()],
    skull: [fromRows(SKULL)],
    shield: [shield()],
    parchment: [parchmentMap()],
    barrel: [barrel()],
    cobweb: [cobweb()],
    window: [windowArch()],
    lantern: [lantern(0), lantern(1)],
    shackle: [shackle()],
    crack: [crack(3)],
    crack2: [crack(19)],
    moss: [moss()],
    bat: [fromRows(BAT)],
    rat: [rat(0), rat(1)],
    crates: [crates()],
    sack: [sack()],
    chest: [chest()],
  };
  return sprites;
}

/** The icons the page's labels, buttons and titles wear, as CSS backgrounds. */
export function drawIcons(): Readonly<Record<string, Sprite>> {
  const icons: Record<string, Sprite> = {
    hat: hatIcon(),
    key: keyIcon(),
    hammer: hammerIcon(),
    book: bookIcon(),
  };
  for (const [name, rows] of Object.entries(ICON_ROWS)) icons[name] = fromRows(rows);
  return icons;
}

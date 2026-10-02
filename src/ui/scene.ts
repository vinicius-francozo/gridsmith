/**
 * Dresses the page as a room: a beam overhead, banners and torches around the
 * plaque, shelves to the sides, a floor with a rat running across it.
 *
 * Everything here is scenery. It is all `aria-hidden`, none of it takes a
 * click, and nothing in the page reads it back — `mountApp` builds the page a
 * person uses and the tests drive, and this only adds to it afterwards, from
 * `mount`. Which is also why it is allowed to give up: if there is no window
 * (the tests run in Node), or the page is not the shape this expects, or the
 * browser will not draw, it returns and the page stays plain and whole.
 *
 * The pixels come from `art.ts`. The pictures the stylesheet needs — the
 * stone, the floor, the icons — go onto the root element as `--gs-art-*`
 * custom properties holding data URLs; the rest are canvases put where they
 * stand.
 */

import { beamTile, chain, drawIcons, drawSprites, floorTile, litter, parchmentTile, stoneTile, vine } from './art';
import type { Sprite } from './art';

/** How often the flames flicker and the rat's legs move, in milliseconds. */
const FRAME_MS = 220;

type Animated = { canvas: HTMLCanvasElement; frames: readonly Sprite[]; phase: number };

type Placement = {
  /** Draw at this many screen pixels per sprite pixel. Omitted: the stylesheet sizes it. */
  scale?: number;
  /** Which frame an animated sprite starts on, so two torches do not flicker in step. */
  phase?: number;
  /** Inline positioning, for the pieces that each stand in a place of their own. */
  style?: Readonly<Record<string, string>>;
};

export function dressScene(root: HTMLElement): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const app = root.querySelector<HTMLElement>('.gs-app');
  const hall = root.querySelector<HTMLElement>('.gs-hall');
  const plaque = root.querySelector<HTMLElement>('.gs-plaque');
  const formBoard = root.querySelector<HTMLElement>('.gs-form-board');
  const mapBoard = root.querySelector<HTMLElement>('.gs-map-board');
  if (app === null || hall === null || plaque === null || formBoard === null || mapBoard === null) {
    return;
  }
  try {
    build(root, { app, hall, plaque, formBoard, mapBoard });
  } catch {
    // Scenery that could not be drawn is scenery left out. The page under it
    // was finished before this started, and nothing here is worth an error.
  }
}

function build(
  root: HTMLElement,
  at: { app: HTMLElement; hall: HTMLElement; plaque: HTMLElement; formBoard: HTMLElement; mapBoard: HTMLElement },
): void {
  const doc = root.ownerDocument;
  const sprites = drawSprites();
  const animated: Animated[] = [];

  const art = (name: string, picture: Sprite): void => {
    doc.documentElement.style.setProperty(`--gs-art-${name}`, `url(${picture.toDataURL()})`);
  };
  for (const [name, icon] of Object.entries(drawIcons())) art(name, icon);
  art('stone', stoneTile());
  art('floor', floorTile());
  art('beam', beamTile());
  art('parchment', parchmentTile());
  const anvil = sprites['anvil']?.[0];
  if (anvil !== undefined) art('anvil', anvil);

  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    style: Readonly<Record<string, string>> = {},
  ): HTMLElementTagNameMap[K] => {
    const made = doc.createElement(tag);
    made.className = className;
    made.setAttribute('aria-hidden', 'true');
    for (const [property, value] of Object.entries(style)) made.style.setProperty(property, value);
    return made;
  };

  const put = (frames: readonly Sprite[] | undefined, className: string, how: Placement = {}): HTMLCanvasElement => {
    const canvas = element('canvas', `gs-px ${className}`, how.style);
    const first = frames?.[0];
    if (frames === undefined || first === undefined) return canvas;
    canvas.width = first.width;
    canvas.height = first.height;
    if (how.scale !== undefined) {
      canvas.style.width = `${first.width * how.scale}px`;
      canvas.style.height = `${first.height * how.scale}px`;
    }
    canvas.getContext('2d')?.drawImage(first, 0, 0);
    if (frames.length > 1) animated.push({ canvas, frames, phase: how.phase ?? 0 });
    return canvas;
  };
  const sprite = (name: string, className: string, how?: Placement): HTMLCanvasElement =>
    put(sprites[name], className, how);

  const standing = (child: HTMLElement, className = ''): HTMLSpanElement => {
    const span = element('span', `gs-standing ${className}`.trim());
    span.append(child);
    return span;
  };

  // --- Overhead: the beam, and the hall around the plaque --------------------

  const beam = element('div', 'gs-beam');
  beam.append(
    sprite('bracket', 'gs-bracket', { scale: 3, style: { left: '16%' } }),
    sprite('bracket', 'gs-bracket', { scale: 3, style: { right: '16%' } }),
  );
  at.app.prepend(beam);

  const torch = (side: 'l' | 'r', phase: number, embers: readonly (readonly [string, string, string])[]): HTMLElement => {
    const wrap = element('div', `gs-torch-wrap ${side}`);
    wrap.append(sprite('torch', 'gs-torch gs-wall-shadow', { phase }));
    for (const [x, delay, drift] of embers) {
      wrap.append(element('i', 'gs-ember', { '--x': x, '--d': delay, '--dx': drift }));
    }
    return wrap;
  };

  const lantern = element('span', 'gs-prop gs-lantern gs-glow');
  lantern.append(
    put([chain(4)], 'gs-chain gs-soft-shadow'),
    sprite('lantern', 'gs-lamp gs-wall-shadow'),
  );

  // The beam is a child of the window, so that it starts at the glass at any
  // size: placed beside it, the two were sized in different units and drifted.
  const moonlitWindow = element('span', 'gs-prop gs-window');
  moonlitWindow.append(sprite('window', 'gs-wall-shadow'), element('i', 'gs-moonbeam'));

  const hallVine = (length: number, seed: number, where: Readonly<Record<string, string>>): HTMLCanvasElement =>
    put([vine(length, seed)], 'gs-vine gs-soft-shadow', { style: { '--len': String(length), ...where } });

  at.hall.prepend(
    moonlitWindow,
    sprite('bat', 'gs-prop gs-bat gs-soft-shadow'),
    sprite('shackle', 'gs-prop gs-ring l gs-wall-shadow'),
    sprite('shackle', 'gs-prop gs-ring r gs-wall-shadow'),
    lantern,
    sprite('crack', 'gs-prop gs-crack', { style: { left: '22%', top: '58%' } }),
    sprite('crack2', 'gs-prop gs-crack', { style: { right: '23%', top: '20%' } }),
    sprite('moss', 'gs-prop gs-moss', { style: { left: '1%', bottom: '6%' } }),
    sprite('moss', 'gs-prop gs-moss', { style: { right: '12%', bottom: '10%' } }),
    hallVine(38, 3, { left: '2%' }),
    hallVine(22, 8, { left: '27%' }),
    hallVine(30, 14, { right: '26%' }),
    hallVine(44, 21, { right: '3%' }),
  );
  // Before and after the plaque, not appended: the hall is a grid, and an item
  // placed in an earlier column than the one before it starts a new row.
  at.plaque.before(
    sprite('banner', 'gs-banner l gs-wall-shadow'),
    torch('l', 0, [['14px', '0s', '-6px'], ['20px', '.9s', '5px'], ['17px', '1.8s', '-2px']]),
  );
  at.plaque.after(
    torch('r', 1, [['16px', '.4s', '4px'], ['21px', '1.3s', '-5px'], ['13px', '2.2s', '3px']]),
    sprite('banner', 'gs-banner r gs-wall-shadow'),
  );
  at.plaque.prepend(
    put([chain(3)], 'gs-chain gs-soft-shadow', { scale: 3, style: { left: '28px' } }),
    put([chain(3)], 'gs-chain gs-soft-shadow', { scale: 3, style: { right: '28px' } }),
  );

  // --- The walls to either side, on a wide enough screen ----------------------

  const shelf = (...items: HTMLElement[]): HTMLElement => {
    const plank = element('div', 'gs-shelf');
    plank.append(...items);
    return plank;
  };
  const glowing = (child: HTMLElement): HTMLSpanElement => {
    const span = element('span', 'gs-glow');
    span.append(child);
    return span;
  };
  const floorRow = (...items: HTMLElement[]): HTMLElement => {
    const row = element('div', 'gs-floor-row');
    row.append(...items);
    return row;
  };

  const left = element('aside', 'gs-side l');
  left.append(
    sprite('shield', 'gs-wall-shadow', { scale: 3 }),
    shelf(
      glowing(sprite('candles', 'gs-soft-shadow', { scale: 2, phase: 1 })),
      sprite('books', 'gs-soft-shadow', { scale: 2 }),
      sprite('skull', 'gs-soft-shadow', { scale: 2 }),
    ),
    element('i', 'gs-grow'),
    floorRow(
      standing(sprite('crates', '', { scale: 2 })),
      standing(sprite('barrel', '', { scale: 3 })),
      standing(sprite('sack', '', { scale: 2 })),
    ),
  );
  const right = element('aside', 'gs-side r');
  right.append(
    sprite('parchment', 'gs-wall-shadow', { scale: 3 }),
    shelf(
      sprite('potions', 'gs-soft-shadow', { scale: 2 }),
      glowing(sprite('candles', 'gs-soft-shadow', { scale: 2 })),
    ),
    element('i', 'gs-grow'),
    floorRow(standing(sprite('books', '', { scale: 2 })), standing(sprite('chest', '', { scale: 3 }))),
  );
  at.app.prepend(left, right);

  // --- The boards: rivets, ivy, a cobweb, candles at their feet ---------------

  for (const board of [at.formBoard, at.mapBoard]) {
    for (const corner of ['tl', 'tr', 'bl', 'br']) board.append(element('i', `gs-rivet ${corner}`));
  }
  const candleStand = (side: 'left' | 'right', phase: number): HTMLElement => {
    const stand = element('span', 'gs-deco gs-edge gs-glow gs-stand gs-standing', { [side]: '-50px' });
    stand.append(sprite('candles', '', { scale: 3, phase }));
    return stand;
  };
  at.formBoard.append(
    put([litter(11)], 'gs-deco gs-edge gs-litter', { style: { left: '26%' } }),
    put([vine(70, 5)], 'gs-deco gs-edge gs-soft-shadow', { scale: 3, style: { left: '-20px', top: '70px' } }),
    sprite('cobweb', 'gs-deco', { scale: 3, style: { right: '4px', top: '4px' } }),
    candleStand('left', 0),
  );
  at.mapBoard.append(
    put([litter(23)], 'gs-deco gs-edge gs-litter', { style: { left: '14%' } }),
    put([litter(37)], 'gs-deco gs-edge gs-litter', { style: { left: '58%' } }),
    put([vine(56, 17)], 'gs-deco gs-edge gs-soft-shadow', { scale: 3, style: { right: '-20px', top: '24px' } }),
    candleStand('right', 1),
  );

  // --- Underfoot ---------------------------------------------------------------

  const critters = element('div', 'gs-critters');
  critters.append(sprite('rat', 'gs-rat'));
  root.append(element('div', 'gs-floor'), critters);

  // --- And then it moves, unless the person asked for stillness ----------------

  const still = doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? true;
  if (still || animated.length === 0) {
    return;
  }
  let tick = 0;
  doc.defaultView?.setInterval(() => {
    tick += 1;
    for (const { canvas, frames, phase } of animated) {
      const frame = frames[(tick + phase) % frames.length];
      const context = canvas.getContext('2d');
      if (frame === undefined || context === null) continue;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frame, 0, 0);
    }
  }, FRAME_MS);
}

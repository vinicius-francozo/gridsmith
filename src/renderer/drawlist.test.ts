import { describe, expect, it } from 'vitest';

import { PIXELS_PER_CELL } from '../core/types';
import type { LightSource, PlacedProp, Scene, Size, TileRef } from '../core/types';
import { materialColor } from '../assets/palette';
import { tileAssetId } from '../assets/contract';
import { cellRect } from './geometry';
import {
  GRID_LINE_COLOR,
  LAYER_ORDER,
  buildDrawList,
  fillCommand,
} from './drawlist';
import type { AssetCommand, DrawCommand, FillCommand, GridCommand, ShadeCommand } from './drawlist';

/**
 * A tile grid from ASCII art, one character per cell, so a test can show the
 * plan it is talking about.
 *
 * `#` is wall, `.` is floor, ` ` is void. Rows short of the first one are
 * rejected: a ragged sketch would otherwise leave holes in a grid the whole
 * module treats as total, and the very check under test would go unexercised.
 */
function tilesFrom(rows: string[]): { size: Size; tiles: TileRef[][] } {
  const size: Size = { w: rows[0].length, h: rows.length };
  const material: Record<string, string> = { '#': 'plaster_wall', '.': 'oak_plank', ' ': 'void' };
  const tiles = rows.map((row, y) => {
    if (row.length !== size.w) {
      throw new Error(`tilesFrom(): row ${y} is ${row.length} characters, expected ${size.w}`);
    }
    return [...row].map((char, x) => {
      const name = material[char];
      if (name === undefined) {
        throw new Error(`tilesFrom(): unknown character ${JSON.stringify(char)}`);
      }
      return { material: name, variant: x % 2, rotation: 0 } as TileRef;
    });
  });
  return { size, tiles };
}

/** A scene over `rows`, with props and lights supplied by the test. */
function sceneFrom(
  rows: string[],
  props: PlacedProp[] = [],
  lights: LightSource[] = [],
): Scene {
  const { size, tiles } = tilesFrom(rows);
  return {
    floorplan: { size, cells: [], doors: [], walls: [] },
    zones: [],
    tiles,
    props,
    lights,
  };
}

function prop(overrides: Partial<PlacedProp> = {}): PlacedProp {
  return {
    assetId: 'group/table_long',
    cell: { x: 1, y: 1 },
    footprint: { w: 1, h: 1 },
    rotation: 0,
    layer: 'group',
    ...overrides,
  };
}

const fills = (commands: DrawCommand[]): FillCommand[] =>
  commands.filter((c): c is FillCommand => c.kind === 'fill');
const assets = (commands: DrawCommand[]): AssetCommand[] =>
  commands.filter((c): c is AssetCommand => c.kind === 'asset');
const shades = (commands: DrawCommand[]): ShadeCommand[] =>
  commands.filter((c): c is ShadeCommand => c.kind === 'shade');

/** The index of the last command of `kind`, or -1. `findLastIndex` needs ES2023. */
function lastIndexOfKind(commands: DrawCommand[], kind: DrawCommand['kind']): number {
  let found = -1;
  commands.forEach((command, index) => {
    if (command.kind === kind) {
      found = index;
    }
  });
  return found;
}

/** The index of the first command of `kind`, or -1. */
function firstIndexOfKind(commands: DrawCommand[], kind: DrawCommand['kind']): number {
  return commands.findIndex((command) => command.kind === kind);
}

describe('tilesFrom', () => {
  it('rejects ragged art, which would leave a hole in a grid that must be total', () => {
    expect(() => tilesFrom(['###', '#.', '###'])).toThrow('row 1 is 2 characters');
  });
});

describe('the canvas the draw list asks for', () => {
  it('is the plan size at exactly the grid pitch', () => {
    const list = buildDrawList(sceneFrom(['###', '#.#', '###']));
    expect(list.size).toEqual({ w: 3 * PIXELS_PER_CELL, h: 3 * PIXELS_PER_CELL });
  });

  it('keeps width and height in that order on a non-square plan', () => {
    // 5 wide by 2 tall. A transposed conversion would give 140x350 and only
    // ever be caught on a map that is not a square.
    const list = buildDrawList(sceneFrom(['#####', '#####']));
    expect(list.size).toEqual({ w: 350, h: 140 });
  });

  it('is a whole number of cells at the largest map the generator may emit', () => {
    const row = '#'.repeat(20);
    const list = buildDrawList(sceneFrom(Array.from({ length: 20 }, () => row)));
    expect(list.size).toEqual({ w: 1400, h: 1400 });
    expect(list.size.w % PIXELS_PER_CELL).toBe(0);
    expect(list.size.h % PIXELS_PER_CELL).toBe(0);
  });

  it('refuses a plan with no cells in it', () => {
    const scene = sceneFrom(['#']);
    scene.floorplan.size = { w: 0, h: 1 };
    expect(() => buildDrawList(scene)).toThrow(RangeError);
  });

  it('refuses a plan measured in fractions of a cell', () => {
    const scene = sceneFrom(['#']);
    scene.floorplan.size = { w: 1.5, h: 1 };
    expect(() => buildDrawList(scene)).toThrow(RangeError);
  });
});

describe('the floor', () => {
  it('fills every cell, walls and void included', () => {
    // `Scene.tiles` is total by contract. A renderer that skipped walls or void
    // would leave the canvas showing through wherever the room is not floor.
    const list = buildDrawList(sceneFrom(['###', '#. ', '###']));
    expect(fills(list.commands)).toHaveLength(9);
  });

  it('visits the cells row by row, which is the order the list is executed in', () => {
    const list = buildDrawList(sceneFrom(['##', '##']));
    expect(fills(list.commands).map((c) => c.cell)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('reads the tile grid as [y][x]', () => {
    // The cell at x=0, y=1 is floor and the one at x=1, y=0 is wall. A
    // transposed read swaps them and still produces a plausible image.
    const list = buildDrawList(sceneFrom(['.#', '..']));
    const at = (x: number, y: number): FillCommand => {
      const found = fills(list.commands).find((c) => c.cell.x === x && c.cell.y === y);
      if (found === undefined) {
        throw new Error(`no fill for (${x}, ${y})`);
      }
      return found;
    };
    expect(at(1, 0).material).toBe('plaster_wall');
    expect(at(0, 1).material).toBe('oak_plank');
  });

  it('places each fill on the cell it names', () => {
    const list = buildDrawList(sceneFrom(['##', '##']));
    for (const command of fills(list.commands)) {
      expect(command.rect).toEqual(cellRect(command.cell));
    }
  });

  it('carries the material’s colour and its tile asset id', () => {
    const list = buildDrawList(sceneFrom(['..']));
    const [first, second] = fills(list.commands);
    expect(first.color).toBe(materialColor('oak_plank', 0));
    expect(first.assetId).toBe(tileAssetId('oak_plank', 0));
    // The art helper varies the variant by column, so the two cells differ.
    expect(second.assetId).toBe(tileAssetId('oak_plank', 1));
    expect(second.color).not.toBe(first.color);
  });

  it('keeps the tile’s own rotation, which a real tile bitmap needs', () => {
    const scene = sceneFrom(['.']);
    scene.tiles[0][0] = { material: 'oak_plank', variant: 0, rotation: 270 };
    expect(fills(buildDrawList(scene).commands)[0].rotation).toBe(270);
  });

  it('draws void as void rather than as another kind of floor', () => {
    const list = buildDrawList(sceneFrom([' ']));
    expect(fills(list.commands)[0].material).toBe('void');
    expect(fills(list.commands)[0].color).toBe(materialColor('void', 0));
  });

  it('refuses a tile grid with fewer rows than the plan', () => {
    const scene = sceneFrom(['##', '##']);
    scene.tiles.pop();
    expect(() => buildDrawList(scene)).toThrow(/has 1 rows, expected 2/);
  });

  it('refuses a tile grid with more rows than the plan', () => {
    const scene = sceneFrom(['##', '##']);
    scene.tiles.push(scene.tiles[0]);
    expect(() => buildDrawList(scene)).toThrow(RangeError);
  });

  it('refuses a short row, naming the row', () => {
    const scene = sceneFrom(['##', '##']);
    scene.tiles[1].pop();
    expect(() => buildDrawList(scene)).toThrow(/row 1 has 1 entries, expected 2/);
  });
});

describe('fillCommand', () => {
  it('rejects a variant that could not have come from the generator', () => {
    expect(() => fillCommand({ x: 0, y: 0 }, { material: 'oak', variant: -1, rotation: 0 })).toThrow(
      RangeError,
    );
  });

  it('rejects an empty material name', () => {
    expect(() => fillCommand({ x: 0, y: 0 }, { material: '', variant: 0, rotation: 0 })).toThrow(
      RangeError,
    );
  });

  it('copies the cell instead of aliasing the caller’s object', () => {
    const cell = { x: 1, y: 2 };
    const command = fillCommand(cell, { material: 'oak', variant: 0, rotation: 0 });
    cell.x = 99;
    expect(command.cell).toEqual({ x: 1, y: 2 });
  });
});

describe('the props', () => {
  it('draws one asset command per prop', () => {
    const list = buildDrawList(sceneFrom(['...', '...', '...'], [prop(), prop({ cell: { x: 2, y: 2 } })]));
    expect(assets(list.commands)).toHaveLength(2);
  });

  it('orders the layers bottom to top whatever order the generator listed them in', () => {
    // Scatter is litter on the floor and must land last, or a tankard on a
    // table disappears under it.
    const list = buildDrawList(
      sceneFrom(
        ['...', '...', '...'],
        [
          prop({ assetId: 'scatter/straw', layer: 'scatter' }),
          prop({ assetId: 'anchor/hearth', layer: 'anchor', cell: { x: 0, y: 0 } }),
          prop({ assetId: 'group/table_long', layer: 'group', cell: { x: 2, y: 2 } }),
        ],
      ),
    );
    // Spelled out rather than compared against LAYER_ORDER: comparing the
    // output to the constant that produced it passes however the constant is
    // reordered, which is exactly the mistake that would ship.
    expect(assets(list.commands).map((c) => c.layer)).toEqual(['anchor', 'group', 'scatter']);
    expect([...LAYER_ORDER]).toEqual(['anchor', 'group', 'scatter']);
  });

  it('keeps the generator’s order inside a layer, so the same scene draws the same', () => {
    const list = buildDrawList(
      sceneFrom(
        ['...', '...', '...'],
        [
          prop({ assetId: 'group/a', cell: { x: 0, y: 0 } }),
          prop({ assetId: 'group/b', cell: { x: 1, y: 0 } }),
          prop({ assetId: 'group/c', cell: { x: 2, y: 0 } }),
        ],
      ),
    );
    expect(assets(list.commands).map((c) => c.assetId)).toEqual(['group/a', 'group/b', 'group/c']);
  });

  it('covers the footprint the prop reserved and carries its rotation', () => {
    const list = buildDrawList(
      sceneFrom(['....', '....'], [prop({ cell: { x: 1, y: 0 }, footprint: { w: 3, h: 1 }, rotation: 180 })]),
    );
    const [command] = assets(list.commands);
    expect(command.rect).toEqual({ x: 70, y: 0, w: 210, h: 70 });
    expect(command.rotation).toBe(180);
  });

  it('refuses a prop whose body hangs off the map even though its anchor does not', () => {
    // The anchor is in bounds; two of the three cells are not. Drawing it would
    // silently clip the prop and hide a generator bug.
    const scene = sceneFrom(['...', '...'], [prop({ cell: { x: 2, y: 0 }, footprint: { w: 3, h: 1 } })]);
    expect(() => buildDrawList(scene)).toThrow(/falls outside the 3x2 map/);
  });

  it('refuses a prop anchored outside the map', () => {
    expect(() => buildDrawList(sceneFrom(['..'], [prop({ cell: { x: -1, y: 0 } })]))).toThrow(
      RangeError,
    );
  });
});

describe('the shadows', () => {
  const room = ['.....', '.....', '.....'];

  it('appear when there is a light', () => {
    const list = buildDrawList(
      sceneFrom(room, [prop({ layer: 'anchor', cell: { x: 3, y: 1 } })], [
        { cell: { x: 0, y: 1 }, radiusCells: 8, colorHex: '#ffd9a0' },
      ]),
    );
    expect(shades(list.commands)).toHaveLength(1);
    expect(shades(list.commands)[0].alpha).toBeGreaterThan(0);
  });

  it('do not appear in an unlit room', () => {
    const list = buildDrawList(sceneFrom(room, [prop({ layer: 'anchor', cell: { x: 3, y: 1 } })]));
    expect(shades(list.commands)).toEqual([]);
  });

  it('are all laid down before any prop, so no prop is darkened by a neighbour', () => {
    const list = buildDrawList(
      sceneFrom(
        room,
        [prop({ layer: 'anchor', cell: { x: 2, y: 1 } }), prop({ layer: 'group', cell: { x: 3, y: 1 } })],
        [{ cell: { x: 0, y: 1 }, radiusCells: 9, colorHex: '#ffd9a0' }],
      ),
    );
    const lastShade = lastIndexOfKind(list.commands, 'shade');
    const firstAsset = firstIndexOfKind(list.commands, 'asset');
    expect(lastShade).toBeGreaterThanOrEqual(0);
    expect(lastShade).toBeLessThan(firstAsset);
  });

  it('are laid down after the floor, or nothing would be darkened at all', () => {
    const list = buildDrawList(
      sceneFrom(room, [prop({ layer: 'anchor', cell: { x: 3, y: 1 } })], [
        { cell: { x: 0, y: 1 }, radiusCells: 8, colorHex: '#ffd9a0' },
      ]),
    );
    const lastFill = lastIndexOfKind(list.commands, 'fill');
    const firstShade = firstIndexOfKind(list.commands, 'shade');
    expect(lastFill).toBeLessThan(firstShade);
  });
});

describe('the grid lines', () => {
  it('are the last thing drawn, over everything else', () => {
    const list = buildDrawList(sceneFrom(['..', '..'], [prop({ cell: { x: 0, y: 0 } })]));
    const last = list.commands[list.commands.length - 1];
    expect(last.kind).toBe('grid');
  });

  it('are ruled at the grid pitch across the whole canvas', () => {
    const list = buildDrawList(sceneFrom(['...', '...']));
    const grid = list.commands[list.commands.length - 1] as GridCommand;
    expect(grid.spacing).toBe(PIXELS_PER_CELL);
    expect(grid.size).toEqual(list.size);
    expect(grid.color).toBe(GRID_LINE_COLOR);
    expect(grid.lineWidth).toBe(1);
  });

  it('are ruled exactly once', () => {
    const list = buildDrawList(sceneFrom(['...', '...']));
    expect(list.commands.filter((c) => c.kind === 'grid')).toHaveLength(1);
  });
});

describe('determinism', () => {
  it('builds an identical list from an identical scene', () => {
    // The project's central invariant: the same description and seed produce
    // the same image, byte for byte. Nothing in the draw list may vary.
    const build = (): DrawCommand[] =>
      buildDrawList(
        sceneFrom(
          ['....', '....', '....'],
          [
            prop({ assetId: 'anchor/hearth', layer: 'anchor', cell: { x: 0, y: 0 } }),
            prop({ assetId: 'scatter/straw', layer: 'scatter', cell: { x: 3, y: 2 } }),
          ],
          [{ cell: { x: 2, y: 1 }, radiusCells: 6, colorHex: '#ffd9a0' }],
        ),
      ).commands;
    expect(build()).toEqual(build());
  });
});

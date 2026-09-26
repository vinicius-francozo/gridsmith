import { describe, expect, it } from 'vitest';

import { PIXELS_PER_CELL } from '../core/types';
import type {
  AssetDef,
  AssetLibrary,
  AssetKind,
  Door,
  LightSource,
  PlacedProp,
  Rotation,
  Scene,
  Size,
  TileRef,
} from '../core/types';
import { expectedBitmapSize } from '../assets/contract';
import { materialColor } from '../assets/palette';
import { buildDrawList } from './drawlist';
import type { DrawCommand, DrawList } from './drawlist';
import { executeDrawList, renderScene } from './render';
import type { RenderTarget } from './render';

// --- A canvas that records instead of painting -------------------------------
//
// The same trick `placeholder.test.ts` uses for `OffscreenCanvas`, pointed at
// the executor. There is no canvas under Node, but the executor's whole job is
// to make a fixed sequence of calls, and a `Proxy` records that sequence
// exactly. What still waits for a browser is what the rasteriser does with the
// calls once they land — not which calls are made, and not with what.

type Call = { method: string; args: unknown[] };

class RecordingCanvas {
  width = 0;
  height = 0;
  readonly calls: Call[] = [];

  constructor(private readonly hasContext = true) {}

  getContext(): unknown {
    if (!this.hasContext) {
      return null;
    }
    return new Proxy(
      {},
      {
        get:
          (_target, property) =>
          (...args: unknown[]): undefined => {
            this.calls.push({ method: String(property), args });
            return undefined;
          },
        set: (_target, property, value: unknown) => {
          this.calls.push({ method: `set ${String(property)}`, args: [value] });
          return true;
        },
      },
    );
  }

  /** Every call to `method`, in order. */
  of(method: string): Call[] {
    return this.calls.filter((call) => call.method === method);
  }

  /** The index of the first call to `method`, or -1. */
  first(method: string): number {
    return this.calls.findIndex((call) => call.method === method);
  }

  /** The index of the last call to `method`, or -1. */
  last(method: string): number {
    let found = -1;
    this.calls.forEach((call, index) => {
      if (call.method === method) {
        found = index;
      }
    });
    return found;
  }

  /** The value the last `set fillStyle` before `index` left in place. */
  fillStyleAt(index: number): unknown {
    let value: unknown;
    this.calls.slice(0, index).forEach((call) => {
      if (call.method === 'set fillStyle') {
        value = call.args[0];
      }
    });
    return value;
  }

  asTarget(): RenderTarget {
    return this as unknown as RenderTarget;
  }
}

/** A bitmap stand-in: the executor only ever reads its dimensions. */
function fakeBitmap(size: { w: number; h: number }): ImageBitmap {
  return { width: size.w, height: size.h, close: () => undefined } as unknown as ImageBitmap;
}

function assetDef(overrides: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'group/table_long',
    kind: 'group',
    footprint: { w: 3, h: 1 },
    tags: [],
    againstWall: false,
    ...overrides,
  };
}

/**
 * A library over `defs`, serving bitmaps at exactly the size the contract asks
 * for unless `sizeOf` says otherwise, and rejecting anything it has never
 * heard of.
 */
function libraryOf(
  defs: readonly AssetDef[],
  sizeOf?: (def: AssetDef, rotation: Rotation) => { w: number; h: number },
): AssetLibrary {
  const index = new Map(defs.map((def) => [def.id, def]));
  return {
    get: (id: string): AssetDef | undefined => index.get(id),
    query: (tags: string[], kind?: AssetKind): AssetDef[] =>
      defs.filter((def) => (kind === undefined || def.kind === kind) && tags.every((tag) => def.tags.includes(tag))),
    bitmap: async (id: string, rotation: Rotation): Promise<ImageBitmap> => {
      const def = index.get(id);
      if (def === undefined) {
        throw new RangeError(`no asset ${id}`);
      }
      return fakeBitmap(sizeOf === undefined ? expectedBitmapSize(def, rotation) : sizeOf(def, rotation));
    },
  };
}

/** A scene of `size` cells, floored in one material, plus whatever is asked for. */
function sceneOf(
  size: Size,
  extras: { props?: PlacedProp[]; doors?: Door[]; lights?: LightSource[]; material?: string } = {},
): Scene {
  const material = extras.material ?? 'wood_plank';
  const tiles: TileRef[][] = Array.from({ length: size.h }, () =>
    Array.from({ length: size.w }, () => ({ material, variant: 0, rotation: 0 }) as TileRef),
  );
  return {
    floorplan: { size, cells: [], doors: extras.doors ?? [], walls: [] },
    zones: [],
    tiles,
    props: extras.props ?? [],
    lights: extras.lights ?? [],
  };
}

function prop(overrides: Partial<PlacedProp> = {}): PlacedProp {
  return {
    assetId: 'group/table_long',
    cell: { x: 0, y: 0 },
    footprint: { w: 3, h: 1 },
    rotation: 0,
    layer: 'group',
    ...overrides,
  };
}

describe('the canvas the executor paints into', () => {
  it('comes out at exactly the plan size times the grid pitch', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 3, h: 2 }), libraryOf([]), canvas.asTarget());
    expect(canvas.width).toBe(3 * PIXELS_PER_CELL);
    expect(canvas.height).toBe(2 * PIXELS_PER_CELL);
  });

  it('does not transpose a map that is not square', async () => {
    // 5 wide by 2 tall. Transposed, this is 140x350: every map the generator
    // will ever emit is rectangular, so the bug would be in every export, and
    // a square test map cannot see it.
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 5, h: 2 }), libraryOf([]), canvas.asTarget());
    expect([canvas.width, canvas.height]).toEqual([350, 140]);
  });

  it('says plainly when the target has no 2d context', async () => {
    const canvas = new RecordingCanvas(false);
    await expect(renderScene(sceneOf({ w: 1, h: 1 }), libraryOf([]), canvas.asTarget())).rejects.toThrow(
      TypeError,
    );
  });
});

describe('the floor', () => {
  it('fills every cell with the colour the list chose, at the rectangle it chose', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 2, h: 1 }), libraryOf([]), canvas.asTarget());
    const fills = canvas.of('fillRect');
    expect(fills).toHaveLength(2);
    expect(fills[0].args).toEqual([0, 0, 70, 70]);
    expect(fills[1].args).toEqual([70, 0, 70, 70]);
    expect(canvas.fillStyleAt(canvas.first('fillRect'))).toBe(materialColor('wood_plank', 0));
  });

  it('composites tile art over the fill when the library has any', async () => {
    const tile = assetDef({ id: 'tile/wood_plank/0', kind: 'tile', footprint: { w: 1, h: 1 } });
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 1, h: 1 }), libraryOf([tile]), canvas.asTarget());
    expect(canvas.of('drawImage')[0].args.slice(1)).toEqual([0, 0, 70, 70]);
    expect(canvas.first('fillRect')).toBeLessThan(canvas.first('drawImage'));
  });

  it('leaves the flat colour standing when the library has no tile art', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 1, h: 1 }), libraryOf([]), canvas.asTarget());
    expect(canvas.of('drawImage')).toEqual([]);
  });
});

describe('the props', () => {
  it('draws the prop’s bitmap over the rectangle it reserved', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(
      sceneOf({ w: 3, h: 1 }, { props: [prop()] }),
      libraryOf([assetDef()]),
      canvas.asTarget(),
    );
    const [call] = canvas.of('drawImage');
    expect(call.args.slice(1)).toEqual([0, 0, 210, 70]);
    expect((call.args[0] as ImageBitmap).width).toBe(210);
  });

  it('draws a magenta rectangle where a bitmap could not be had', async () => {
    // One bad prop costs one loud rectangle, not the whole map.
    const canvas = new RecordingCanvas();
    await renderScene(
      sceneOf({ w: 3, h: 1 }, { props: [prop({ assetId: 'group/unknown' })] }),
      libraryOf([]),
      canvas.asTarget(),
    );
    expect(canvas.of('drawImage')).toEqual([]);
    const marker = canvas.of('fillRect').at(-1);
    expect(marker?.args).toEqual([0, 0, 210, 70]);
    expect(canvas.fillStyleAt(canvas.last('fillRect'))).toBe('#ff00c8');
  });

  it('refuses a bitmap that breaks the size clause of the asset contract', async () => {
    // `drawImage` scales whatever it is given into the rectangle asked for, so
    // a pack drawn at 64px per cell would come out *looking* aligned and be
    // wrong by six pixels a cell across the whole map. Magenta instead.
    const canvas = new RecordingCanvas();
    await renderScene(
      sceneOf({ w: 3, h: 1 }, { props: [prop()] }),
      libraryOf([assetDef()], () => ({ w: 3 * 64, h: 64 })),
      canvas.asTarget(),
    );
    expect(canvas.of('drawImage')).toEqual([]);
    expect(canvas.fillStyleAt(canvas.last('fillRect'))).toBe('#ff00c8');
  });

  it('refuses a placement whose footprint disagrees with the library’s own', async () => {
    // A bar counter turned 90° occupies 2x5 cells. A generator that wrote the
    // unturned 5x2 would have the list reserve 350x140px while the library
    // hands back 140x350px, and `drawImage` would squeeze the art into it
    // without a word: a prop transposed on the map, no error, no magenta.
    const counter = assetDef({ id: 'anchor/bar_counter', kind: 'anchor', footprint: { w: 5, h: 2 } });
    const scene = sceneOf(
      { w: 6, h: 6 },
      { props: [prop({ assetId: counter.id, layer: 'anchor', rotation: 90, footprint: { w: 5, h: 2 } })] },
    );
    const canvas = new RecordingCanvas();
    await expect(renderScene(scene, libraryOf([counter]), canvas.asTarget())).rejects.toThrow(
      /breaks the asset contract/,
    );
    expect(canvas.of('fillRect')).toEqual([]);
  });

  it('accepts the same counter when the placement is the turned footprint', async () => {
    const counter = assetDef({ id: 'anchor/bar_counter', kind: 'anchor', footprint: { w: 5, h: 2 } });
    const scene = sceneOf(
      { w: 6, h: 6 },
      { props: [prop({ assetId: counter.id, layer: 'anchor', rotation: 90, footprint: { w: 2, h: 5 } })] },
    );
    const canvas = new RecordingCanvas();
    await renderScene(scene, libraryOf([counter]), canvas.asTarget());
    expect(canvas.of('drawImage')[0].args.slice(1)).toEqual([0, 0, 140, 350]);
  });
});

describe('the shadows', () => {
  it('darkens under a saved alpha and restores it, so nothing else is dimmed', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(
      sceneOf({ w: 5, h: 1 }, {
        props: [prop({ assetId: 'anchor/hearth', layer: 'anchor', footprint: { w: 1, h: 1 }, cell: { x: 3, y: 0 } })],
        lights: [{ cell: { x: 0, y: 0 }, radiusCells: 8, colorHex: '#ffd9a0' }],
      }),
      libraryOf([]),
      canvas.asTarget(),
    );
    const save = canvas.first('save');
    const restore = canvas.first('restore');
    expect(save).toBeGreaterThanOrEqual(0);
    expect(restore).toBeGreaterThan(save);
    const alpha = canvas.of('set globalAlpha')[0].args[0] as number;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe('the doors', () => {
  it('fills the door cell and then its threshold', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(
      sceneOf({ w: 2, h: 2 }, { doors: [{ cell: { x: 1, y: 0 }, facing: 'n' }] }),
      libraryOf([]),
      canvas.asTarget(),
    );
    const fills = canvas.of('fillRect');
    // Four floor cells, then the door cell, then the threshold band.
    expect(fills.slice(4).map((call) => call.args)).toEqual([
      [70, 0, 70, 70],
      [70, 0, 70, 14],
    ]);
  });
});

describe('the grid', () => {
  it('strokes exactly the lines the list measured, half a pixel off the cell edge', async () => {
    // A 2x1 map is 140x70px: one interior line, down the middle, at x=70.5.
    // On an integer coordinate the rasteriser straddles it and every rule on
    // the map comes out two grey pixels wide instead of one.
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 2, h: 1 }), libraryOf([]), canvas.asTarget());
    expect(canvas.of('moveTo').map((call) => call.args)).toEqual([[70.5, 0]]);
    expect(canvas.of('lineTo').map((call) => call.args)).toEqual([[70.5, 70]]);
    expect(canvas.of('beginPath')).toHaveLength(1);
    expect(canvas.of('stroke')).toHaveLength(1);
  });

  it('rules both axes on a larger map', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(sceneOf({ w: 3, h: 2 }), libraryOf([]), canvas.asTarget());
    expect(canvas.of('moveTo').map((call) => call.args)).toEqual([
      [70.5, 0],
      [140.5, 0],
      [0, 70.5],
    ]);
    expect(canvas.of('lineTo').map((call) => call.args)).toEqual([
      [70.5, 140],
      [140.5, 140],
      [210, 70.5],
    ]);
  });

  it('is the last thing on the canvas, over everything else', async () => {
    const canvas = new RecordingCanvas();
    await renderScene(
      sceneOf({ w: 2, h: 2 }, { props: [prop({ footprint: { w: 1, h: 1 } })] }),
      libraryOf([assetDef({ footprint: { w: 1, h: 1 } })]),
      canvas.asTarget(),
    );
    expect(canvas.last('stroke')).toBe(canvas.calls.length - 1);
    expect(canvas.last('drawImage')).toBeLessThan(canvas.first('beginPath'));
  });
});

describe('executeDrawList', () => {
  it('refuses a command kind it does not know instead of dropping it', async () => {
    // The `never` in the default branch makes a new command kind a compile
    // error. This is the same guarantee at run time, for a list that arrived
    // from anywhere the compiler did not see.
    const list: DrawList = {
      size: { w: 70, h: 70 },
      commands: [{ kind: 'sparkle' } as unknown as DrawCommand],
    };
    const canvas = new RecordingCanvas();
    await expect(executeDrawList(list, libraryOf([]), canvas.asTarget())).rejects.toThrow(
      /unknown draw command/,
    );
  });

  it('executes the list in the order the list is in', async () => {
    const scene = sceneOf({ w: 2, h: 2 }, {
      doors: [{ cell: { x: 0, y: 0 }, facing: 'n' }],
      props: [prop({ footprint: { w: 1, h: 1 }, cell: { x: 1, y: 1 } })],
      lights: [{ cell: { x: 0, y: 1 }, radiusCells: 6, colorHex: '#ffd9a0' }],
    });
    const list = buildDrawList(scene);
    const canvas = new RecordingCanvas();
    await executeDrawList(list, libraryOf([assetDef({ footprint: { w: 1, h: 1 } })]), canvas.asTarget());
    expect(list.commands.map((command) => command.kind)).toEqual([
      'fill',
      'fill',
      'fill',
      'fill',
      'door',
      'shade',
      'asset',
      'grid',
    ]);
    expect(canvas.first('save')).toBeGreaterThan(canvas.first('fillRect'));
    expect(canvas.first('drawImage')).toBeGreaterThan(canvas.first('restore'));
    expect(canvas.first('beginPath')).toBeGreaterThan(canvas.first('drawImage'));
  });
});

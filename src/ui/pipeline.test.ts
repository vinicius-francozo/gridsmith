import { describe, expect, it } from 'vitest';

import type { AssetLibrary, Constraints, Interpreter, Scene } from '../core/types';
import { createPlaceholderLibrary } from '../assets/placeholder';
import { createRng } from '../core/prng';
import { generate } from '../generator/generate';
import { resolve } from '../interpreter/resolve';
import { ClaudeInterpreter } from '../interpreter/claude';
import { MissingApiKeyError } from '../interpreter/errors';
import type { RenderTarget } from '../renderer/render';

import { generateMap } from './pipeline';

// --- A canvas that records instead of painting -------------------------------
//
// The same `Proxy` stand-in `render.test.ts` and `placeholder.test.ts` use.
// There is no canvas under Node, and the executor's whole job is to make a
// fixed sequence of calls, so a recorder is enough to prove the pipeline
// reached the renderer and the renderer reached a surface. What still waits for
// a browser is what the rasteriser does with the calls once they land.

class RecordingCanvas {
  width = 0;
  height = 0;
  readonly calls: string[] = [];

  getContext(): unknown {
    return new Proxy(
      {},
      {
        get:
          (_target, property) =>
          (...args: unknown[]): undefined => {
            this.calls.push(`${String(property)}(${args.length})`);
            return undefined;
          },
        set: () => true,
      },
    );
  }
}

function recorder(): { target: RenderTarget; canvas: RecordingCanvas } {
  const canvas = new RecordingCanvas();
  return { target: canvas as unknown as RenderTarget, canvas };
}

// --- An interpreter that answers without a network ---------------------------
//
// No test in this project calls the API. This stands in for the model, and each
// answer below is what a model would plausibly return for one of the three
// example descriptions in the map.

function constraintsFor(overrides: Partial<Constraints> = {}): Constraints {
  return {
    place: { building: 'tavern', room: 'hall' },
    light: 'dim',
    condition: 'lived_in',
    clutter: 0.4,
    furnishing: 0.4,
    features: [],
    excluded: [],
    unresolved: [],
    ...overrides,
  };
}

/** An interpreter that answers `constraints` and remembers what it was asked. */
function fakeInterpreter(constraints: Constraints): Interpreter & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    interpret(text: string): Promise<Constraints> {
      asked.push(text);
      return Promise.resolve(constraints);
    },
  };
}

/** The three descriptions the map names as the acceptance case. */
const EXAMPLES: ReadonlyArray<{ description: string; constraints: Constraints }> = [
  {
    description: 'um salão de taverna, luz baixa, móveis derrubados',
    constraints: constraintsFor({
      place: { building: 'tavern', room: 'hall' },
      light: 'dark',
      condition: 'disordered',
      clutter: 0.6,
      features: ['bar', 'hearth'],
    }),
  },
  {
    description: 'um quarto de taverna pequeno e bagunçado',
    constraints: constraintsFor({
      place: { building: 'tavern', room: 'room' },
      sizeHint: 'small',
      light: 'dim',
      condition: 'disordered',
      clutter: 0.5,
      features: ['bunks'],
    }),
  },
  {
    description: 'um depósito de taverna com engradados empilhados',
    constraints: constraintsFor({
      place: { building: 'tavern', room: 'storeroom' },
      light: 'dark',
      condition: 'lived_in',
      clutter: 0.7,
      features: ['shelving'],
    }),
  },
];

function library(): AssetLibrary {
  return createPlaceholderLibrary();
}

/** A serialisation that does not depend on the order the keys were written in. */
function stable(scene: Scene): string {
  return JSON.stringify(scene, (_key, raw: unknown) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return raw;
    }
    const record = raw as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

describe('the whole loop, end to end', () => {
  for (const example of EXAMPLES) {
    it(`draws a map for: ${example.description}`, async () => {
      const { target, canvas } = recorder();
      const interpreter = fakeInterpreter(example.constraints);

      const result = await generateMap(
        { description: example.description, seed: 20250926 },
        { interpreter, library: library(), target },
      );

      expect(interpreter.asked).toEqual([example.description]);
      expect(result.params.place).toBe(example.constraints.place);
      expect(result.scene.props.length).toBeGreaterThan(0);
      // The surface was resized and painted. `render.test.ts` owns what the
      // commands are; this owns that the pipeline got there at all.
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.calls.length).toBeGreaterThan(0);
    });

    it(`sizes the surface in whole square cells for: ${example.description}`, async () => {
      const { target, canvas } = recorder();

      const result = await generateMap(
        { description: example.description, seed: 20250926 },
        { interpreter: fakeInterpreter(example.constraints), library: library(), target },
      );

      const { size } = result.scene.floorplan;
      // Stated in cells, not in pixels: this layer has no business knowing how
      // many pixels a cell is. What it can say is that the surface came out a
      // whole number of cells on each axis, and the same number on both.
      expect(canvas.width % size.w).toBe(0);
      expect(canvas.height % size.h).toBe(0);
      expect(canvas.width / size.w).toBe(canvas.height / size.h);
    });
  }
});

describe('one seed, one map', () => {
  const example = EXAMPLES[0];

  it('gives back the same scene for the same description and seed', async () => {
    const first = await generateMap(
      { description: example.description, seed: 777 },
      { interpreter: fakeInterpreter(example.constraints), library: library(), target: recorder().target },
    );
    const second = await generateMap(
      { description: example.description, seed: 777 },
      { interpreter: fakeInterpreter(example.constraints), library: library(), target: recorder().target },
    );

    expect(stable(second.scene)).toBe(stable(first.scene));
  });

  it('gives back a different scene for a different seed', async () => {
    // Without this the determinism check above would also pass on a pipeline
    // that ignored the seed entirely.
    const first = await generateMap(
      { description: example.description, seed: 1 },
      { interpreter: fakeInterpreter(example.constraints), library: library(), target: recorder().target },
    );
    const second = await generateMap(
      { description: example.description, seed: 2 },
      { interpreter: fakeInterpreter(example.constraints), library: library(), target: recorder().target },
    );

    expect(stable(second.scene)).not.toBe(stable(first.scene));
  });

  it('builds exactly what resolve and generate build from that seed', async () => {
    // The two tests above compare whole runs, and they pass on a pipeline that
    // hands `generate` a generator seeded from a constant: `resolve` already
    // varies the footprint and the door count with the seed, so the scenes
    // differ anyway and the second stream is never checked. This pins the
    // composition itself — the same three calls, made here by hand.
    const result = await generateMap(
      { description: example.description, seed: 4242 },
      { interpreter: fakeInterpreter(example.constraints), library: library(), target: recorder().target },
    );

    const expected = generate(resolve(example.constraints, 4242), createRng(4242));

    expect(stable(result.scene)).toBe(stable(expected));
  });

  it('puts the seed it was given into the params it hands back', async () => {
    const result = await generateMap(
      { description: example.description, seed: 4242 },
      { interpreter: fakeInterpreter(example.constraints), library: library(), target: recorder().target },
    );

    // The file name is built from this. A seed that did not survive the loop
    // would name every export after the wrong number.
    expect(result.params.seed).toBe(4242);
  });
});

describe('what the loop could not do comes back with the map', () => {
  it('carries the unresolved list through untouched', async () => {
    const constraints = constraintsFor({
      unresolved: ['unsupported_request:um segundo andar', 'unsupported_request:chuva lá fora'],
    });

    const result = await generateMap(
      { description: 'um salão com um segundo andar, chovendo', seed: 5 },
      { interpreter: fakeInterpreter(constraints), library: library(), target: recorder().target },
    );

    expect(result.constraints.unresolved).toEqual(constraints.unresolved);
  });

  it('reports a feature that does not belong in the place as a conflict', async () => {
    const constraints = constraintsFor({ place: { building: 'tavern', room: 'room' }, features: ['bar'] });

    const result = await generateMap(
      { description: 'um quarto de taverna com um balcão', seed: 5 },
      { interpreter: fakeInterpreter(constraints), library: library(), target: recorder().target },
    );

    expect(result.params.conflicts).toContain('feature_not_in_place:bar');
    expect(result.params.features).not.toContain('bar');
  });
});

describe('a failure keeps the type the interface needs', () => {
  it('lets an interpreter failure through as itself', async () => {
    // Flattened to one `Error` here, the interface could not tell "paste a key"
    // from "check your proxy", which is the distinction `errors.ts` exists for.
    const failing: Interpreter = {
      interpret: () => Promise.reject(new MissingApiKeyError()),
    };

    await expect(
      generateMap(
        { description: 'um salão de taverna', seed: 1 },
        { interpreter: failing, library: library(), target: recorder().target },
      ),
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('lets the renderer refuse a library that breaks the asset contract', async () => {
    // The renderer validates the library it is handed. If the pipeline
    // swallowed that, a map would come back drawn entirely in magenta and
    // nothing would say why.
    const broken: AssetLibrary = {
      get: () => ({ id: 'anchor/bar_counter', kind: 'tile', footprint: { w: 5, h: 2 }, tags: [], againstWall: true }),
      query: () => [],
      bitmap: () => Promise.reject(new Error('no art here')),
    };

    await expect(
      generateMap(
        { description: 'um salão de taverna', seed: 1 },
        { interpreter: fakeInterpreter(EXAMPLES[0].constraints), library: broken, target: recorder().target },
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('refuses a seed that is not an integer, before any map is drawn', async () => {
    const { target, canvas } = recorder();

    await expect(
      generateMap(
        { description: 'um salão de taverna', seed: 1.5 },
        { interpreter: fakeInterpreter(EXAMPLES[0].constraints), library: library(), target },
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(canvas.calls).toEqual([]);
  });
});

describe('the real interpreter fails without reaching the network', () => {
  // Two paths the interface has to show, both reached with no request sent and
  // no key needed. Nothing in this project ever calls the API from a test.

  it('refuses an empty description before building a client', async () => {
    await expect(
      generateMap(
        { description: '   ', seed: 1 },
        {
          interpreter: new ClaudeInterpreter({ apiKey: 'sk-ant-api03-exemplo' }),
          library: library(),
          target: recorder().target,
        },
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('refuses a blank key as missing rather than letting the API reject it', async () => {
    await expect(
      generateMap(
        { description: 'um salão de taverna', seed: 1 },
        { interpreter: new ClaudeInterpreter({ apiKey: '' }), library: library(), target: recorder().target },
      ),
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });
});

import { describe, expect, it } from 'vitest';

import { ClassificationFailedError, ModelUnavailableError } from './errors';
import { LocalInterpreter } from './local';
import type { ModelProgress, PipelineLoader, ZeroShotOutput, ZeroShotPipeline } from './pipeline';
import {
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
} from './templates';
import type { ChoiceTemplate } from './templates';

/**
 * No test here downloads a model. Every one of them hands in a loader, which is
 * the seam the class is built around, and several of them assert that the
 * loader was *not* called — which is the half of lazy loading that an ordinary
 * stand-in would hide.
 */

const ALL_TEMPLATES: Array<ChoiceTemplate<string>> = [
  PLACE_TYPE_TEMPLATE,
  LIGHT_TEMPLATE,
  CONDITION_TEMPLATE,
  SIZE_HINT_TEMPLATE,
  FEATURE_TEMPLATE,
];

/**
 * An answer that puts all of its weight on `winner` and spreads the rest.
 *
 * Enough to get a whole `Constraints` out of the class; `interpret.test.ts` is
 * where the reading of the scores is actually pinned down.
 */
function confidentAbout(template: ChoiceTemplate<string>, winner: string): ZeroShotOutput {
  const values = Object.keys(template.labels);
  const rest = values.length > 1 ? 0.1 / (values.length - 1) : 0;
  return {
    labels: values.map((value) => template.labels[value]),
    scores: values.map((value) => (value === winner ? 0.9 : rest)),
  };
}

/** A classifier that answers every one of the five questions. */
const answering: ZeroShotPipeline = (_text, _labels, options) => {
  const template = ALL_TEMPLATES.find((each) => each.hypothesis === options.hypothesisTemplate);
  if (template === undefined) {
    throw new Error(`nothing answers "${options.hypothesisTemplate}"`);
  }
  const winner = template === FEATURE_TEMPLATE ? 'bar' : Object.keys(template.labels)[0];
  return Promise.resolve(confidentAbout(template, winner));
};

/** A loader that hands back `pipeline`, and a count of how often it was asked. */
function loaderFor(pipeline: ZeroShotPipeline = answering): {
  loadPipeline: PipelineLoader;
  loads: number;
} {
  const state = {
    loads: 0,
    loadPipeline: (): Promise<ZeroShotPipeline> => {
      state.loads += 1;
      return Promise.resolve(pipeline);
    },
  };
  return state;
}

describe('refusing before downloading anything', () => {
  it('refuses an empty description without starting the download', async () => {
    const loader = loaderFor();
    const interpreter = new LocalInterpreter({ loadPipeline: loader.loadPipeline });

    await expect(interpreter.interpret('')).rejects.toThrow(RangeError);

    expect(loader.loads).toBe(0);
  });

  it('refuses a description that is only spaces', async () => {
    const loader = loaderFor();
    const interpreter = new LocalInterpreter({ loadPipeline: loader.loadPipeline });

    await expect(interpreter.interpret('   \n ')).rejects.toThrow(RangeError);

    expect(loader.loads).toBe(0);
  });
});

describe('loading the model lazily', () => {
  it('downloads nothing when it is constructed', () => {
    const loader = loaderFor();

    new LocalInterpreter({ loadPipeline: loader.loadPipeline });

    expect(loader.loads).toBe(0);
  });

  it('loads on the first description', async () => {
    const loader = loaderFor();
    const interpreter = new LocalInterpreter({ loadPipeline: loader.loadPipeline });

    await interpreter.interpret('um salão de taverna');

    expect(loader.loads).toBe(1);
  });

  it('loads once, however many descriptions follow', async () => {
    const loader = loaderFor();
    const interpreter = new LocalInterpreter({ loadPipeline: loader.loadPipeline });

    await interpreter.interpret('um salão de taverna');
    await interpreter.interpret('um quarto de taverna');

    expect(loader.loads).toBe(1);
  });

  it('makes two descriptions asked at once wait on one download', async () => {
    // The promise is held, not the pipeline. Holding the pipeline would start a
    // second 303 MB download for the second click.
    const loader = loaderFor();
    const interpreter = new LocalInterpreter({ loadPipeline: loader.loadPipeline });

    await Promise.all([interpreter.interpret('um salão'), interpreter.interpret('um quarto')]);

    expect(loader.loads).toBe(1);
  });

  it('lets a failed load be tried again', async () => {
    // A cached rejection would leave the button dead for the rest of the visit
    // over one dropped connection.
    let attempts = 0;
    const loadPipeline: PipelineLoader = () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(answering);
    };
    const interpreter = new LocalInterpreter({ loadPipeline });

    await expect(interpreter.interpret('um salão')).rejects.toThrow(ModelUnavailableError);
    await expect(interpreter.interpret('um salão')).resolves.toMatchObject({ placeType: 'tavern_hall' });

    expect(attempts).toBe(2);
  });
});

describe('when the model will not load', () => {
  it('reports it as the model being unavailable', async () => {
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.reject(new Error('WebAssembly.instantiate: out of memory')),
    });

    await expect(interpreter.interpret('um salão')).rejects.toThrow(ModelUnavailableError);
  });

  it('keeps what went wrong in the message', async () => {
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.reject(new Error('WebAssembly.instantiate: out of memory')),
    });

    await expect(interpreter.interpret('um salão')).rejects.toThrow(/out of memory/);
  });

  it('does not wrap a failure the loader already reported as this', async () => {
    const already = new ModelUnavailableError('failed to fetch');
    const interpreter = new LocalInterpreter({ loadPipeline: () => Promise.reject(already) });

    await expect(interpreter.interpret('um salão')).rejects.toBe(already);
  });

  it('reports something that is not an Error at all', async () => {
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.reject('the worker died'),
    });

    await expect(interpreter.interpret('um salão')).rejects.toThrow(/the worker died/);
  });
});

describe('when the model runs and answers badly', () => {
  it('reports an unreadable answer as a classification failure', async () => {
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.resolve(() => Promise.resolve({ labels: ['x'], scores: [1] })),
    });

    await expect(interpreter.interpret('um salão')).rejects.toThrow(ClassificationFailedError);
  });

  it('says what was wrong once, not wrapped inside itself', async () => {
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.resolve(() => Promise.resolve({ labels: ['x'], scores: [1] })),
    });

    const failure = await interpreter.interpret('um salão').catch((error: unknown) => error);

    expect(String(failure).match(/could not be read/g)).toHaveLength(1);
  });

  it('reports the session itself throwing as a classification failure', async () => {
    // Out of memory part way through, a WebGPU device lost — the library throws
    // a plain Error from inside a session that had already loaded.
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.resolve(() => Promise.reject(new Error('device lost'))),
    });

    await expect(interpreter.interpret('um salão')).rejects.toThrow(ClassificationFailedError);
    await expect(interpreter.interpret('um salão')).rejects.toThrow(/device lost/);
  });

  it('does not report a bad answer as the model being unavailable', async () => {
    // The model is there. Saying it is not would send the person to check a
    // connection that is fine.
    const interpreter = new LocalInterpreter({
      loadPipeline: () => Promise.resolve(() => Promise.resolve({ labels: ['x'], scores: [1] })),
    });

    await expect(interpreter.interpret('um salão')).rejects.not.toBeInstanceOf(ModelUnavailableError);
  });
});

describe('saying where the load has got to', () => {
  it('passes every step on to whoever asked', async () => {
    const seen: ModelProgress[] = [];
    const interpreter = new LocalInterpreter({
      onProgress: (progress) => seen.push(progress),
      loadPipeline: (report) => {
        report({ kind: 'starting' });
        report({ kind: 'downloading', file: 'model_quantized.onnx', ratio: 0.5 });
        report({ kind: 'ready', backend: 'wasm' });
        return Promise.resolve(answering);
      },
    });

    await interpreter.interpret('um salão');

    expect(seen).toEqual([
      { kind: 'starting' },
      { kind: 'downloading', file: 'model_quantized.onnx', ratio: 0.5 },
      { kind: 'ready', backend: 'wasm' },
    ]);
  });

  it('runs perfectly well with nobody listening', async () => {
    const interpreter = new LocalInterpreter({
      loadPipeline: (report) => {
        report({ kind: 'starting' });
        return Promise.resolve(answering);
      },
    });

    await expect(interpreter.interpret('um salão')).resolves.toBeDefined();
  });
});

describe('what it answers with', () => {
  it('produces constraints in the closed vocabulary', async () => {
    const interpreter = new LocalInterpreter({ loadPipeline: loaderFor().loadPipeline });

    await expect(interpreter.interpret('um salão de taverna')).resolves.toEqual({
      placeType: 'tavern_hall',
      sizeHint: 'small',
      light: 'dark',
      condition: 'tidy',
      clutter: expect.any(Number) as unknown as number,
      features: ['bar'],
      unresolved: [],
    });
  });

  it('never reports anything unresolved, because a classifier cannot notice one', async () => {
    const interpreter = new LocalInterpreter({ loadPipeline: loaderFor().loadPipeline });

    const constraints = await interpreter.interpret('um salão com um segundo andar e um alçapão');

    expect(constraints.unresolved).toEqual([]);
  });
});

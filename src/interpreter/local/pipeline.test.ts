import { describe, expect, it } from 'vitest';

import { ClassificationFailedError, ModelUnavailableError } from './errors';
import {
  createTransformersLoader,
  MODEL_DEVICE,
  MODEL_DTYPE,
  MODEL_ID,
  readRawProgress,
  readZeroShotOutput,
} from './pipeline';
import type { ModelProgress } from './pipeline';

/**
 * Nothing here downloads a model or reaches `@huggingface/transformers`. The
 * library is handed in through `importModule`, which exists for exactly this.
 */

describe('where the model runs', () => {
  it('is WebAssembly, and is not asked of the browser', () => {
    // Written out as a literal rather than read back from the constant, which
    // would agree with `'webgpu'` just as happily. The four tests that used to
    // stand here drove a `detectBackend` that probed `navigator.gpu`; the probe
    // is gone because WebGPU's `DequantizeLinear` bug returns wrong numbers on
    // q8 weights rather than throwing, and a fallback cannot catch that.
    expect(MODEL_DEVICE).toBe('wasm');
  });
});

describe('reading the library progress events', () => {
  it('ignores anything that is not a download step', () => {
    expect(readRawProgress({ status: 'initiate', file: 'model.onnx' })).toBeUndefined();
    expect(readRawProgress({ status: 'download', file: 'model.onnx' })).toBeUndefined();
  });

  it('reads the library\'s "done" as the graph compile starting', () => {
    // `done` is dispatched by `getModelFile` once a file's last byte is in,
    // cache hit or fetch alike, and it is the only such signal this front gets.
    // It used to be thrown away, which is why `preparing` was reported from the
    // wrong side of the await that holds the compile.
    expect(readRawProgress({ status: 'done', file: 'model_quantized.onnx' })).toEqual({
      kind: 'preparing',
    });
  });

  it('ignores an event that is not an object at all', () => {
    expect(readRawProgress(undefined)).toBeUndefined();
    expect(readRawProgress('downloading')).toBeUndefined();
    expect(readRawProgress(null)).toBeUndefined();
  });

  it('takes the ratio from the byte counts when they are there', () => {
    expect(
      readRawProgress({ status: 'progress', file: 'model.onnx', loaded: 80, total: 320, progress: 12 }),
    ).toEqual({ kind: 'downloading', file: 'model.onnx', ratio: 0.25 });
  });

  it('falls back to the percentage the library computed', () => {
    expect(readRawProgress({ status: 'progress', file: 'model.onnx', progress: 40 })).toEqual({
      kind: 'downloading',
      file: 'model.onnx',
      ratio: 0.4,
    });
  });

  it('reports no ratio when the response carried no length', () => {
    // Better than a bar that fills by guesswork.
    expect(readRawProgress({ status: 'progress', file: 'model.onnx', loaded: 80, total: 0 })).toEqual({
      kind: 'downloading',
      file: 'model.onnx',
      ratio: undefined,
    });
  });

  it('keeps the ratio inside 0..1 however the library overshoots', () => {
    expect(readRawProgress({ status: 'progress', file: 'a', progress: 140 })).toEqual({
      kind: 'downloading',
      file: 'a',
      ratio: 1,
    });
    expect(readRawProgress({ status: 'progress', file: 'a', progress: -5 })).toEqual({
      kind: 'downloading',
      file: 'a',
      ratio: 0,
    });
  });

  it('names the file as an empty string rather than inventing one', () => {
    expect(readRawProgress({ status: 'progress', progress: 10 })).toEqual({
      kind: 'downloading',
      file: '',
      ratio: 0.1,
    });
  });
});

describe('reading what the classifier answered', () => {
  it('keeps a well-formed answer', () => {
    expect(readZeroShotOutput({ sequence: 'x', labels: ['a', 'b'], scores: [0.7, 0.3] })).toEqual({
      labels: ['a', 'b'],
      scores: [0.7, 0.3],
    });
  });

  it('refuses an answer that is not an object', () => {
    expect(() => readZeroShotOutput(null)).toThrow(ClassificationFailedError);
  });

  it('refuses an answer with no list of labels', () => {
    expect(() => readZeroShotOutput({ scores: [1] })).toThrow(/labels/);
  });

  it('refuses labels that are not strings', () => {
    expect(() => readZeroShotOutput({ labels: [1, 2], scores: [0.5, 0.5] })).toThrow(/labels/);
  });

  it('refuses scores that are not numbers', () => {
    expect(() => readZeroShotOutput({ labels: ['a'], scores: ['0.5'] })).toThrow(/scores/);
  });

  it('refuses two lists of different lengths, instead of reading past the end', () => {
    expect(() => readZeroShotOutput({ labels: ['a', 'b'], scores: [1] })).toThrow(
      /2 labels and 1 scores/,
    );
  });
});

// --- The loader --------------------------------------------------------------

type PipelineCall = { task: string; model: string; options: Record<string, unknown> };
type ClassifyCall = { text: string; labels: string[]; options: Record<string, unknown> };

/** A stand-in for the library, and a record of how it was used. */
function fakeLibrary(answer: unknown = { labels: ['a'], scores: [1] }): {
  importModule: () => Promise<{
    pipeline: (
      task: string,
      model: string,
      options: Record<string, unknown>,
    ) => Promise<(text: string, labels: string[], options: Record<string, unknown>) => Promise<unknown>>;
  }>;
  built: PipelineCall[];
  classified: ClassifyCall[];
} {
  const built: PipelineCall[] = [];
  const classified: ClassifyCall[] = [];
  return {
    built,
    classified,
    importModule: () =>
      Promise.resolve({
        pipeline: (task: string, model: string, options: Record<string, unknown>) => {
          built.push({ task, model, options });
          return Promise.resolve((text: string, labels: string[], callOptions: Record<string, unknown>) => {
            classified.push({ text, labels, options: callOptions });
            return Promise.resolve(answer);
          });
        },
      }),
  };
}

describe('the model this front asks for', () => {
  it('is the one the bench picked, by name', () => {
    // Written out rather than read back from the constant, which would agree
    // with any model at all. The one it replaced, `Xenova/mDeBERTa-v3-base-
    // xnli-multilingual-nli-2mil7`, could not do `features` at all in fp32 —
    // its negatives came back at 0.998, on top of its positives.
    expect(MODEL_ID).toBe('Horizon-Labs/multilingual-zeroshot-small');
  });

  it('is asked for quantised, because the float build is 2.1 times the weights', () => {
    // 563,101,474 B against 268,409,234 B, both measured on the real files.
    // The name of this test said "four times" while `pipeline.ts` said 2.1 —
    // the number corrected there was left standing here, in the test the same
    // commit added.
    expect(MODEL_DTYPE).toBe('q8');
  });
});

describe('loading a real pipeline', () => {
  it('touches nothing until the loader is called', () => {
    // The whole reason this front is shaped around a loader: 303 MB may not
    // start arriving because a page was opened.
    const library = fakeLibrary();

    createTransformersLoader({ importModule: library.importModule });

    expect(library.built).toEqual([]);
  });

  it('asks the library for the model this front is written against', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule });

    await load(() => undefined);

    expect(library.built).toEqual([
      {
        task: 'zero-shot-classification',
        model: MODEL_ID,
        options: expect.objectContaining({ device: 'wasm', dtype: MODEL_DTYPE }) as unknown,
      },
    ]);
  });

  it('asks for WebAssembly however capable the browser is', async () => {
    // Nothing is probed and nothing is passed in: there is no arm of this
    // function that can reach `'webgpu'` any more, and that is the fix. The
    // browser's own WebGPU support is irrelevant to what is asked for.
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule });

    await load(() => undefined);

    expect(library.built[0].options.device).toBe('wasm');
  });

  it('says where it got to', async () => {
    // No `preparing` here, and that is not an omission: this library stand-in
    // emits no `done`, and `preparing` is now raised from `done`. The step is
    // covered by the two tests below, which emit one.
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule });
    const seen: ModelProgress[] = [];

    await load((progress) => seen.push(progress));

    expect(seen).toEqual([{ kind: 'starting' }, { kind: 'ready' }]);
  });

  it('passes the library download events on as progress', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule });
    const seen: ModelProgress[] = [];

    await load((progress) => seen.push(progress));
    const report = library.built[0].options.progress_callback as (raw: unknown) => void;
    report({ status: 'progress', file: 'model_quantized.onnx', loaded: 1, total: 4 });
    report({ status: 'initiate', file: 'model_quantized.onnx' });

    expect(seen.filter((progress) => progress.kind === 'downloading')).toEqual([
      { kind: 'downloading', file: 'model_quantized.onnx', ratio: 0.25 },
    ]);
  });

  it('goes back to downloading when another file follows the one that finished', async () => {
    // Every file gets its own `done`, so `preparing` is raised more than once
    // and most of them are premature. What this pins is the recovery: the next
    // file's `progress` puts the line back to downloading, so a premature
    // `preparing` costs a flicker and not a wrong status for the rest of the
    // load.
    //
    // It does *not* pin that the last `done` is the model's. It is not: the
    // library awaits the tokenizer and the model in one `Promise.all`, and this
    // holds on a cold cache only because the 268 MB of weights are the last
    // thing to arrive. `readRawProgress` says which case that leaves broken —
    // a partially warm cache — and why neither mechanical fix for it is worth
    // taking. The sequence below is the guaranteed part.
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule });
    const seen: ModelProgress[] = [];

    await load((progress) => seen.push(progress));
    const report = library.built[0].options.progress_callback as (raw: unknown) => void;
    report({ status: 'progress', file: 'tokenizer.json', loaded: 1, total: 2 });
    report({ status: 'done', file: 'tokenizer.json' });
    report({ status: 'progress', file: 'model_quantized.onnx', loaded: 2, total: 4 });
    report({ status: 'done', file: 'model_quantized.onnx' });

    expect(seen.map((progress) => progress.kind)).toEqual([
      'starting',
      'ready',
      'downloading',
      'preparing',
      'downloading',
      'preparing',
    ]);
  });

  it('reports the compile from inside the await that holds it, not after it', async () => {
    // The defect this replaced: `preparing` and `ready` were two synchronous
    // statements in a row, with no suspension between them, and a browser
    // paints between tasks rather than between statements. Measured, the state
    // was current for 0.04 ms and no macrotask turn observed it — the page sat
    // on "Baixando o modelo local… 100%" for the whole compile.
    //
    // So asserting that `preparing` is reported would not be enough: it was
    // reported before, too. What has to hold is that a turn of the event loop
    // runs while it is still the current state. `whileCompiling` is taken after
    // a real macrotask boundary inside the library's own `pipeline()` call,
    // which is where the graph compile lives.
    const seen: ModelProgress[] = [];
    const whileCompiling: ModelProgress[] = [];

    const load = createTransformersLoader({
      importModule: () =>
        Promise.resolve({
          pipeline: async (_task: string, _model: string, options: Record<string, unknown>) => {
            const notify = options.progress_callback as (raw: unknown) => void;
            notify({ status: 'progress', file: 'model_quantized.onnx', loaded: 4, total: 4 });
            notify({ status: 'done', file: 'model_quantized.onnx' });
            // The compile, standing in for seconds of WebAssembly. One
            // macrotask turn is the browser's chance to paint.
            await new Promise((resolve) => setTimeout(resolve, 0));
            whileCompiling.push(...seen);
            return () => Promise.resolve({ labels: ['a'], scores: [1] });
          },
        }),
    });

    await load((progress) => seen.push(progress));

    expect(whileCompiling.at(-1)).toEqual({ kind: 'preparing' });
    expect(seen.map((progress) => progress.kind)).toEqual([
      'starting',
      'downloading',
      'preparing',
      'ready',
    ]);
  });

  it('translates the request into the names the library uses', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule });

    const pipeline = await load(() => undefined);
    await pipeline('um salão', ['a', 'b'], { hypothesisTemplate: 'É {}.', multiLabel: true });

    expect(library.classified).toEqual([
      {
        text: 'um salão',
        labels: ['a', 'b'],
        options: { hypothesis_template: 'É {}.', multi_label: true },
      },
    ]);
  });

  it('checks what the library answered before handing it on', async () => {
    const library = fakeLibrary({ labels: ['a', 'b'], scores: [1] });
    const load = createTransformersLoader({ importModule: library.importModule });

    const pipeline = await load(() => undefined);

    await expect(
      pipeline('um salão', ['a', 'b'], { hypothesisTemplate: 'É {}.', multiLabel: false }),
    ).rejects.toThrow(ClassificationFailedError);
  });

  it('reports a library that will not load as the model being unavailable', async () => {
    const load = createTransformersLoader({
      importModule: () => Promise.reject(new Error('failed to fetch the module')),
    });

    await expect(load(() => undefined)).rejects.toThrow(ModelUnavailableError);
  });

  it('reports a download that fails the same way, with what went wrong', async () => {
    const load = createTransformersLoader({
      importModule: () =>
        Promise.resolve({
          pipeline: () => Promise.reject(new Error('Unable to load model from hub')),
        }),
    });

    await expect(load(() => undefined)).rejects.toThrow(/Unable to load model from hub/);
  });

  it('never reports a backend for a load that failed', async () => {
    const load = createTransformersLoader({
      importModule: () => Promise.reject(new Error('offline')),
    });
    const seen: ModelProgress[] = [];

    await expect(load((progress) => seen.push(progress))).rejects.toThrow(ModelUnavailableError);

    expect(seen.map((progress) => progress.kind)).toEqual(['starting']);
  });
});

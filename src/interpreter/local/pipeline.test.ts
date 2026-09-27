import { describe, expect, it } from 'vitest';

import { ClassificationFailedError, ModelUnavailableError } from './errors';
import {
  createTransformersLoader,
  detectBackend,
  MODEL_DTYPE,
  MODEL_ID,
  readRawProgress,
  readZeroShotOutput,
} from './pipeline';
import type { GpuProbe, ModelProgress } from './pipeline';

/**
 * Nothing here downloads a model or reaches `@huggingface/transformers`. The
 * library is handed in through `importModule`, which exists for exactly this.
 */

describe('choosing where the model runs', () => {
  it('falls back to WebAssembly when the browser has no WebGPU at all', async () => {
    await expect(detectBackend(undefined)).resolves.toBe('wasm');
  });

  it('falls back to WebAssembly when WebGPU hands back no adapter', async () => {
    // A browser that exposes `navigator.gpu` on a machine whose GPU is
    // blocklisted. `'gpu' in navigator` would have said yes here.
    const gpu: GpuProbe = { requestAdapter: () => Promise.resolve(null) };

    await expect(detectBackend(gpu)).resolves.toBe('wasm');
  });

  it('falls back to WebAssembly when asking for an adapter throws', async () => {
    const gpu: GpuProbe = { requestAdapter: () => Promise.reject(new Error('no device')) };

    await expect(detectBackend(gpu)).resolves.toBe('wasm');
  });

  it('uses WebGPU when an adapter comes back', async () => {
    const gpu: GpuProbe = { requestAdapter: () => Promise.resolve({ name: 'adapter' }) };

    await expect(detectBackend(gpu)).resolves.toBe('webgpu');
  });
});

describe('reading the library progress events', () => {
  it('ignores anything that is not a download step', () => {
    expect(readRawProgress({ status: 'initiate', file: 'model.onnx' })).toBeUndefined();
    expect(readRawProgress({ status: 'done', file: 'model.onnx' })).toBeUndefined();
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

const NO_GPU = (): GpuProbe | undefined => undefined;
const WITH_GPU = (): GpuProbe => ({ requestAdapter: () => Promise.resolve({}) });

describe('loading a real pipeline', () => {
  it('touches nothing until the loader is called', () => {
    // The whole reason this front is shaped around a loader: 317 MB may not
    // start arriving because a page was opened.
    const library = fakeLibrary();

    createTransformersLoader({ importModule: library.importModule, gpu: NO_GPU });

    expect(library.built).toEqual([]);
  });

  it('asks the library for the model this front is written against', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule, gpu: WITH_GPU });

    await load(() => undefined);

    expect(library.built).toEqual([
      {
        task: 'zero-shot-classification',
        model: MODEL_ID,
        options: expect.objectContaining({ device: 'webgpu', dtype: MODEL_DTYPE }) as unknown,
      },
    ]);
  });

  it('builds on WebAssembly when there is no WebGPU', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule, gpu: NO_GPU });

    await load(() => undefined);

    expect(library.built[0].options.device).toBe('wasm');
  });

  it('says where it got to, and which backend it ended on', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule, gpu: NO_GPU });
    const seen: ModelProgress[] = [];

    await load((progress) => seen.push(progress));

    expect(seen).toEqual([{ kind: 'starting' }, { kind: 'preparing' }, { kind: 'ready', backend: 'wasm' }]);
  });

  it('passes the library download events on as progress', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule, gpu: NO_GPU });
    const seen: ModelProgress[] = [];

    await load((progress) => seen.push(progress));
    const report = library.built[0].options.progress_callback as (raw: unknown) => void;
    report({ status: 'progress', file: 'model_quantized.onnx', loaded: 1, total: 4 });
    report({ status: 'initiate', file: 'model_quantized.onnx' });

    expect(seen.filter((progress) => progress.kind === 'downloading')).toEqual([
      { kind: 'downloading', file: 'model_quantized.onnx', ratio: 0.25 },
    ]);
  });

  it('translates the request into the names the library uses', async () => {
    const library = fakeLibrary();
    const load = createTransformersLoader({ importModule: library.importModule, gpu: NO_GPU });

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
    const load = createTransformersLoader({ importModule: library.importModule, gpu: NO_GPU });

    const pipeline = await load(() => undefined);

    await expect(
      pipeline('um salão', ['a', 'b'], { hypothesisTemplate: 'É {}.', multiLabel: false }),
    ).rejects.toThrow(ClassificationFailedError);
  });

  it('reports a library that will not load as the model being unavailable', async () => {
    const load = createTransformersLoader({
      importModule: () => Promise.reject(new Error('failed to fetch the module')),
      gpu: NO_GPU,
    });

    await expect(load(() => undefined)).rejects.toThrow(ModelUnavailableError);
  });

  it('reports a download that fails the same way, with what went wrong', async () => {
    const load = createTransformersLoader({
      importModule: () =>
        Promise.resolve({
          pipeline: () => Promise.reject(new Error('Unable to load model from hub')),
        }),
      gpu: NO_GPU,
    });

    await expect(load(() => undefined)).rejects.toThrow(/Unable to load model from hub/);
  });

  it('never reports a backend for a load that failed', async () => {
    const load = createTransformersLoader({
      importModule: () => Promise.reject(new Error('offline')),
      gpu: NO_GPU,
    });
    const seen: ModelProgress[] = [];

    await expect(load((progress) => seen.push(progress))).rejects.toThrow(ModelUnavailableError);

    expect(seen.map((progress) => progress.kind)).toEqual(['starting']);
  });
});

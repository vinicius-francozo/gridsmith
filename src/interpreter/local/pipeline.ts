/**
 * The one place that knows a machine-learning library exists.
 *
 * Everything else in `src/interpreter/local/` is written against
 * `ZeroShotPipeline`, which is three lines of structural type: give it a
 * sentence, a list of labels and a hypothesis, get back a label list and a
 * score list. That narrowness is the point — it is what lets every test in this
 * front stand the classifier in without a download, and it is what keeps
 * `@huggingface/transformers` out of the files that decide anything.
 *
 * ## The hand-written shape, now that the dependency is here
 *
 * This file used to import the library behind a `@ts-expect-error`, because
 * `package.json` belonged to another front and the package was not installed.
 * That directive was written to become a TS2578 the moment it was — an alarm
 * whose whole purpose was to force somebody to read the real module's types
 * instead of trusting the shape below for ever. It went off, and this is that
 * reading: `TransformersModule` is now narrow enough that the real module is
 * *assignable* to it, so `importTransformers` returns the import with no cast
 * at all. A library that changes its signature now fails `npm run typecheck`
 * here, which is what the alarm was for.
 *
 * It is still hand-written and still three fields wide, on purpose. Taking the
 * library's own types would put `PipelineType`, `DataType` and a hundred other
 * names into a front that asks one question, and would make the stand-in every
 * test uses something that has to implement a module.
 */

import { ClassificationFailedError, ModelUnavailableError } from './errors';

/**
 * The model this front is written against.
 *
 * 279M parameters, cross-lingual NLI over a hundred languages, and an int8 ONNX
 * build of about 317 MB. Provisional in the same sense the templates are: it is
 * the smallest thing found that judges a Portuguese premise against a
 * Portuguese hypothesis, and a better one replaces this constant and nothing
 * else.
 */
export const MODEL_ID = 'Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7';

/** The quantised build to fetch. The float build is four times the download. */
export const MODEL_DTYPE = 'q8';

/** Where the model actually runs. */
export type Backend = 'webgpu' | 'wasm';

/**
 * What the loader is doing, for the status line to say.
 *
 * `downloading` carries a ratio rather than a byte count because the page shows
 * a percentage, and `undefined` when the server sent no length — which happens,
 * and is better said as "baixando" than as a percentage invented from nothing.
 */
export type ModelProgress =
  | { readonly kind: 'starting' }
  | { readonly kind: 'downloading'; readonly file: string; readonly ratio: number | undefined }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'ready'; readonly backend: Backend };

/** Told each time the load moves on. */
export type ProgressReport = (progress: ModelProgress) => void;

/** One classification, as the pipeline answers it. */
export type ZeroShotOutput = {
  /** The labels that were asked about, in the pipeline's own order. */
  readonly labels: readonly string[];
  /** The score for each label, positionally. */
  readonly scores: readonly number[];
};

/** How to ask. */
export type ZeroShotOptions = {
  /** The hypothesis, with `{}` where the label goes. */
  readonly hypothesisTemplate: string;
  /**
   * Whether the labels are independent.
   *
   * `false` spreads one unit of probability across the labels — one of them is
   * the answer. `true` scores each on its own — any number of them can be true.
   */
  readonly multiLabel: boolean;
};

/**
 * The whole of what this front needs from a classifier.
 *
 * Named in this project's own vocabulary rather than the library's, so that the
 * library's argument names do not leak into five other files.
 */
export type ZeroShotPipeline = (
  text: string,
  labels: readonly string[],
  options: ZeroShotOptions,
) => Promise<ZeroShotOutput>;

/** How a pipeline is obtained. Injected, so the tests never download one. */
export type PipelineLoader = (report: ProgressReport) => Promise<ZeroShotPipeline>;

/** The part of `navigator.gpu` that answers whether WebGPU is usable. */
export type GpuProbe = { requestAdapter: () => Promise<unknown> };

/**
 * `navigator.gpu`, when there is one.
 *
 * Read through a cast because `lib.dom` in this TypeScript version does not
 * declare `gpu`, and declaring it globally from here would put a WebGPU type on
 * `navigator` for the whole project.
 */
export function browserGpu(): GpuProbe | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  const gpu = (navigator as unknown as { gpu?: GpuProbe }).gpu;
  return typeof gpu?.requestAdapter === 'function' ? gpu : undefined;
}

/**
 * Where the model will run, given what the browser offers.
 *
 * The library falls back to WebAssembly on its own when WebGPU is missing, so
 * this is not what makes the fallback work — it is what makes the fallback
 * *honest*. The page tells the person which one they got, because the
 * difference between the two is seconds against tens of seconds per
 * classification, and a page that stays silent about that reads as a page that
 * has hung.
 *
 * Asking for an adapter is the real test, not `'gpu' in navigator`: a browser
 * can expose the object and still hand back no adapter on a machine whose GPU
 * is blocklisted, and a `requestAdapter` that throws is the same answer as one
 * that returns null.
 */
export async function detectBackend(gpu: GpuProbe | undefined): Promise<Backend> {
  if (gpu === undefined) {
    return 'wasm';
  }
  try {
    return (await gpu.requestAdapter()) === null ? 'wasm' : 'webgpu';
  } catch {
    return 'wasm';
  }
}

/** What the library's `progress_callback` is handed, as much of it as is read. */
type RawProgress = {
  status?: unknown;
  file?: unknown;
  progress?: unknown;
  loaded?: unknown;
  total?: unknown;
};

/**
 * One of the library's progress events, in this front's own vocabulary, or
 * `undefined` for an event the status line has nothing to say about.
 *
 * Byte counts are preferred over the library's own `progress` field because
 * that field is a percentage and this type carries a ratio; deriving the ratio
 * from the bytes avoids a second rounding. When the response carried no length
 * there is no ratio to give, and saying so is better than showing a bar that
 * fills by guesswork.
 */
export function readRawProgress(raw: unknown): ModelProgress | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const event = raw as RawProgress;
  if (event.status !== 'progress') {
    return undefined;
  }
  const file = typeof event.file === 'string' ? event.file : '';
  return { kind: 'downloading', file, ratio: readRatio(event) };
}

/** The fraction of `event` that has arrived, when that is knowable. */
function readRatio(event: RawProgress): number | undefined {
  const { loaded, total } = event;
  if (typeof loaded === 'number' && typeof total === 'number' && total > 0) {
    return clampRatio(loaded / total);
  }
  // The library's own figure is a percentage, not a fraction.
  if (typeof event.progress === 'number') {
    return clampRatio(event.progress / 100);
  }
  return undefined;
}

/** `value` inside 0..1, and `undefined` rather than `NaN`. */
function clampRatio(value: number): number | undefined {
  if (Number.isNaN(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * A pipeline's answer, checked into `ZeroShotOutput`.
 *
 * The library is untyped here by construction — see the import note at the top
 * — so what comes back is `unknown` and is treated as such. A quantised build
 * that answers with mismatched arrays is not a hypothetical: it is the shape
 * every reader downstream would otherwise index past the end of.
 *
 * @throws {ClassificationFailedError} if the answer is not two arrays of the
 *                                     same length, of strings and of numbers.
 */
export function readZeroShotOutput(raw: unknown): ZeroShotOutput {
  if (typeof raw !== 'object' || raw === null) {
    throw new ClassificationFailedError('the classifier answered with no result object');
  }
  const { labels, scores } = raw as { labels?: unknown; scores?: unknown };
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === 'string')) {
    throw new ClassificationFailedError('the classifier answered without a list of labels');
  }
  if (!Array.isArray(scores) || !scores.every((score) => typeof score === 'number')) {
    throw new ClassificationFailedError('the classifier answered without a list of scores');
  }
  if (labels.length !== scores.length) {
    throw new ClassificationFailedError(
      `the classifier answered with ${String(labels.length)} labels and ${String(scores.length)} scores`,
    );
  }
  return { labels, scores };
}

/**
 * A built classifier, as much of it as is called.
 *
 * The option names are the library's, not this project's — this is the one
 * boundary where they are allowed, and `ZeroShotPipeline` is the same thing in
 * this front's own words on the other side of it.
 */
type ZeroShotSession = (
  text: string,
  labels: string[],
  options: { hypothesis_template: string; multi_label: boolean },
) => Promise<unknown>;

/**
 * What the library exposes, as much of it as is used.
 *
 * Every type here is as narrow as the one call site needs — the literal task
 * name, the two devices this front detects, the one dtype it asks for. That
 * narrowness is what makes the real module assignable to it: a wider `task:
 * string` or `dtype: string` would not be, because the library's own signature
 * accepts neither.
 */
type TransformersModule = {
  pipeline: (
    task: 'zero-shot-classification',
    model: string,
    options: {
      device: Backend;
      dtype: typeof MODEL_DTYPE;
      progress_callback: (raw: unknown) => void;
    },
  ) => Promise<ZeroShotSession>;
};

/**
 * The library itself.
 *
 * No cast. The import is returned as it is, and TypeScript checks the real
 * module against `TransformersModule` — which is the whole of what this front
 * claims the library does. The check is worth more than it looks: it covers the
 * task name, the three options passed below, and the shape of the session that
 * comes back.
 *
 * Still its own function, so that the one dynamic import in this project is one
 * statement with a name, and so that `TransformersLoaderOptions.importModule`
 * has something to stand in for.
 */
async function importTransformers(): Promise<TransformersModule> {
  return await import('@huggingface/transformers');
}

/** What `createTransformersLoader` may be told to do differently, for tests. */
export type TransformersLoaderOptions = {
  /** Where the library comes from. */
  readonly importModule?: () => Promise<TransformersModule>;
  /** What WebGPU looks like. */
  readonly gpu?: () => GpuProbe | undefined;
};

/**
 * A loader that downloads the real model and returns a real pipeline.
 *
 * Lazy by construction: this function builds a loader and touches nothing. The
 * download happens when the loader is called, which `LocalInterpreter` does on
 * the first description and never at construction — 317 MB may not begin
 * arriving because a page was opened.
 *
 * @throws {ModelUnavailableError} from the returned loader, for every way the
 *                                 library or the download can fail.
 */
export function createTransformersLoader(options: TransformersLoaderOptions = {}): PipelineLoader {
  const importModule = options.importModule ?? importTransformers;
  const gpu = options.gpu ?? browserGpu;

  return async (report: ProgressReport): Promise<ZeroShotPipeline> => {
    report({ kind: 'starting' });
    const backend = await detectBackend(gpu());

    let classify;
    try {
      const transformers = await importModule();
      classify = await transformers.pipeline('zero-shot-classification', MODEL_ID, {
        device: backend,
        dtype: MODEL_DTYPE,
        progress_callback: (raw: unknown) => {
          const progress = readRawProgress(raw);
          if (progress !== undefined) {
            report(progress);
          }
        },
      });
    } catch (error) {
      throw new ModelUnavailableError(messageOf(error), { cause: error });
    }

    // Between the last byte and the first answer the runtime is still compiling
    // the graph, which on the WebAssembly path is seconds of a frozen page.
    report({ kind: 'preparing' });
    report({ kind: 'ready', backend });

    return async (text, labels, zeroShotOptions) => {
      const raw = await classify(text, [...labels], {
        hypothesis_template: zeroShotOptions.hypothesisTemplate,
        multi_label: zeroShotOptions.multiLabel,
      });
      return readZeroShotOutput(raw);
    };
  };
}

/** Whatever `error` has to say for itself, without assuming it is an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

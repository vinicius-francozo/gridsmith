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
 * ## The dependency this front could not add
 *
 * `package.json` belongs to the orchestrator, so `@huggingface/transformers` is
 * not installed and the import below does not resolve. It is suppressed with
 * `@ts-expect-error`, which is the same mechanism `src/main.ts` used for
 * `./ui/mount` before the UI front landed, and it works the same way round: the
 * moment the package is installed, TypeScript reports the directive as unused
 * (TS2578) and `npm run typecheck` fails until somebody deletes it. That is the
 * alarm, not a regression — it is what forces the real module's types to be
 * looked at instead of the hand-written shape below being trusted for ever.
 *
 * Until then, `npm run typecheck` and `npm run test` pass and `npm run build`
 * does not: a bundler cannot resolve a package that is not there. See the
 * report.
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

/** What the library exposes, as much of it as is used. */
type TransformersModule = {
  pipeline: (
    task: string,
    model: string,
    options: Record<string, unknown>,
  ) => Promise<(text: string, labels: string[], options: Record<string, unknown>) => Promise<unknown>>;
};

/**
 * The library itself.
 *
 * Split into its own function so the suppression covers one statement and
 * nothing else. The value is taken as `unknown` and cast afterwards, on purpose:
 * an `unknown` assignment cannot fail, so once the package is installed the
 * line stops erring and the directive above it becomes the TS2578 that this
 * file's header describes — which is the whole mechanism. Casting on the same
 * line would let a mismatch between the real module and `TransformersModule` be
 * suppressed along with the missing module, and nobody would hear about it.
 */
async function importTransformers(): Promise<TransformersModule> {
  // @ts-expect-error `@huggingface/transformers` is not in package.json yet — it is the
  // orchestrator's file. Delete this directive when the dependency lands; see the header.
  const loaded: unknown = await import('@huggingface/transformers');
  return loaded as TransformersModule;
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

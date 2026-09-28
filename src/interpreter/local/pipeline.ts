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
 * The model this front is written against, and the bench picked.
 *
 * 141M parameters and about 303 MB to fetch.
 *
 * What it costs to run, with the conditions attached, because a bare
 * millisecond figure is worthless without them: measured in Node on this
 * machine — `onnxruntime-node`, twelve CPU cores, no GPU — a whole description
 * takes a median of about 510 ms. That is the five questions this front asks,
 * twenty forward passes, and it held within 11 ms across three runs of a
 * hundred timings each. Taken apart, the three-label questions are about 80 ms,
 * the four-label one about 105 ms and the seven-label `features` question about
 * 170 ms; `templates.ts` quotes the four-label figure out of this same run, so
 * the two files cannot drift into contradicting each other.
 *
 * The browser is a different runtime — WebAssembly, one tab, whatever machine
 * the person has — so this is the shape of the cost and not a promise. Nothing
 * in this front has been timed in a browser.
 *
 * That figure is the whole download, measured off disk after a real one:
 * 302,821,014 B, of which `model_quantized.onnx` is 268,409,234 B and
 * `tokenizer.json` is 34,363,287 B — a multilingual ModernBERT vocabulary, and
 * far too large to round away — plus the two configs. The weights alone are
 * what a model card quotes; the browser fetches all of it, so all of it is what
 * the page promises.
 *
 * It replaced `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7`, which is
 * larger in every reading and — the reason it had to go rather than merely the
 * reason this one is nicer — **unusable for `features`**. In fp32 that model
 * returned 0.998 for labels that were not there, overlapping the ones that
 * were, so no threshold anywhere separated them. Its respectable int8 numbers
 * were an artefact of quantisation. Nothing about that is fixable from this
 * file, which is why the constant moved.
 *
 * The sizes, with the dtypes said out loud, because a ratio between two
 * different dtypes is not a fact about either model. Weights only, both
 * quantised: its `model_int8.onnx` is 317,250,309 B against this model's
 * `model_quantized.onnx` at 268,409,234 B — 1.18 times. Weights only, both
 * float: 1,116,115,064 B against 563,101,474 B — 1.98 times. Whole download,
 * both quantised: 333,568,013 B against 302,821,014 B — 1.10 times, the gap
 * narrowed by this model's much larger vocabulary file. All four measured off
 * disk after a real fetch.
 *
 * Its latency has not been measured. The bench that timed this model never ran
 * a clock against mDeBERTa, so there is no ratio to quote and none is quoted.
 */
export const MODEL_ID = 'Horizon-Labs/multilingual-zeroshot-small';

/** The quantised build to fetch. The float build is 2.1 times the weights. */
export const MODEL_DTYPE = 'q8';

/**
 * Where the model runs. Fixed, and not detected.
 *
 * This front used to probe `navigator.gpu` and ask for `'webgpu'` whenever an
 * adapter came back. It does not any more, and the reason is not that WebGPU is
 * awkward to start — it is that it can answer **wrongly**.
 *
 * `MODEL_DTYPE` is `q8`, so every weight in this model goes through
 * `DequantizeLinear`. The open bug in that operator on onnxruntime-web's JSEP
 * WebGPU backend is not specific to one architecture: it is in the operator
 * that *every* per-tensor uint8/int8 model runs, which is exactly this one.
 *
 * - https://github.com/microsoft/onnxruntime/issues/32578 — open.
 *   `DequantizeLinear` under JSEP, with JSEP itself declared to be in
 *   maintenance mode in favour of a new WebGPU EP.
 * - https://github.com/huggingface/transformers.js/issues/1512 — open. WASM and
 *   WebGPU returning *different results* for int8 models.
 * - https://github.com/huggingface/transformers.js/issues/1317 —
 *   `[MatMul] ... shared dimension does not match`.
 *
 * Retrying — try WebGPU, fall back to WebAssembly when it throws — was weighed
 * and refused, and the reasoning belongs here because the next reader will
 * think of it again. Measured, the failure it would repair is real: a loader
 * whose `pipeline()` throws was called three times in a row and chose
 * `["webgpu","webgpu","webgpu"]`, because `local.ts` clears its cached load on
 * failure and a redetection lands on the same answer — the person fetches
 * 310 MB and gets "A interpretação da descrição falhou." for ever in that
 * browser. But retry only repairs the case where WebGPU fails *loudly*. It does
 * nothing for the case where it returns a tensor of the right shape holding the
 * wrong numbers, which is what the three issues above describe and which
 * nothing in this front can tell apart from a right answer. A wrong answer
 * wearing the face of a right one is the failure mode `unresolved` spent four
 * rounds of review removing from this project. Speed does not buy it back.
 *
 * Revisit this when the new WebGPU EP reaches transformers.js: that is the
 * event that makes the question worth measuring again, and it is the only one.
 *
 * And the measurement that does **not** exist should be said out loud, because
 * its absence is half of the decision: nothing in this front has ever been
 * timed in a browser. The ~510 ms quoted against `MODEL_ID` is Node with
 * `onnxruntime-node` on twelve CPU cores, not WebAssembly in a tab, and it is
 * no evidence about what is being given up here.
 */
export const MODEL_DEVICE = 'wasm';

/**
 * What the loader is doing, for the status line to say.
 *
 * `downloading` carries a ratio rather than a byte count because the page shows
 * a percentage, and `undefined` when the server sent no length — which happens,
 * and is better said as "baixando" than as a percentage invented from nothing.
 *
 * `preparing` is the graph compile — see `readRawProgress`, which is where it
 * is raised from and where the reason it is raised from there is written down.
 *
 * `ready` carries nothing. It used to carry the backend, so that the page could
 * say which of the two the person had got; there is only `MODEL_DEVICE` now, so
 * a field reporting it would be a constant travelling through three files.
 */
export type ModelProgress =
  | { readonly kind: 'starting' }
  | { readonly kind: 'downloading'; readonly file: string; readonly ratio: number | undefined }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'ready' };

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
 *
 * ## Why `done` becomes `preparing` here, of all places
 *
 * The library emits `initiate`, `download`, `progress` and `done` per file —
 * `getModelFile` in `@huggingface/transformers/src/utils/hub.js`, which
 * dispatches `done` unconditionally at the end, on a cache hit as well as after
 * a real fetch. `done` is therefore the only signal this front gets that a
 * file's last byte is in, and after the *last* file's `done` comes the thing
 * the status line exists to explain: `pipeline()` builds the inference session
 * and the runtime compiles the graph, which on the WebAssembly path is seconds
 * of a frozen page.
 *
 * That state was reported from the loader instead, one statement before
 * `ready`, with no `await` between the two. No browser paints between two
 * synchronous statements of the same task, and it does not here either:
 * measured, `preparing` was the current state for **0.04 ms** and not one
 * macrotask turn observed it. The page sat on "Baixando o modelo local… 100%"
 * for the whole compile, and the single sentence written to explain the pause
 * never reached anybody. Moving that same report to *before* the await would
 * have been the opposite lie — "carregando na memória" across the entire
 * download.
 *
 * ## What raising it on every `done` does and does not guarantee
 *
 * It is raised on *every* `done`, and a `done` followed by more downloading is
 * overwritten by the next `progress` event. In the ordinary case that is enough
 * and no list of filenames is needed: the last `done` is the one left on screen
 * across the compile, where it belongs.
 *
 * **That is a tendency and not a property, and the difference is written down
 * here because a sentence in this front claiming more than it has is the defect
 * this front has paid for most.** The files do not load one after another —
 * `pipeline()` in `@huggingface/transformers/src/pipelines.js` awaits the
 * tokenizer and the model in one `Promise.all`, and the graph compile starts
 * inside the model's branch as soon as *its* `done` has fired, while the
 * tokenizer's branch may still be emitting `progress`. What makes the ordinary
 * case work is arithmetic, not ordering: `model_quantized.onnx` is
 * 268,409,234 B of the 302,821,014 B fetched, so on a cold cache it is
 * overwhelmingly the one that finishes last.
 *
 * The case where it does not hold is a **partially warm cache** — model cached,
 * tokenizer not, which is what a reload after an interrupted first visit looks
 * like. The model's `done` fires at once, `preparing` goes up, the compile
 * starts, and the tokenizer's `progress` events push the line back to
 * "Baixando… X%" for the duration. That is the defect above, in a narrower
 * place, and it is not fixed here.
 *
 * It is not fixed here because both mechanical fixes for it fail *silently*,
 * which is worse than the cosmetic wrong it would repair:
 *
 * - **Counting files in flight** and raising `preparing` when the count returns
 *   to zero looks exact and is not. An optional file that 404s takes the
 *   `handleError` return at `hub.js:350`, which is before the `done` dispatch
 *   at `hub.js:467` — it emits `initiate` and never `done`. The count would
 *   never return to zero and `preparing` would never appear at all.
 * - **Matching the model's filename** ties this to a string the library owns.
 *   A dtype variant or a path convention moving the file renames it, and
 *   `preparing` silently stops appearing.
 *
 * Both trade a status line that is sometimes wrong for one that is sometimes
 * absent with nothing to say so. Neither has been measured in a browser, and
 * nothing in this front has. So the behaviour stays as it is and the limit is
 * stated instead of asserted away.
 */
export function readRawProgress(raw: unknown): ModelProgress | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const event = raw as RawProgress;
  if (event.status === 'done') {
    return { kind: 'preparing' };
  }
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
 * name, the one device this front asks for, the one dtype it asks for. That
 * narrowness is what makes the real module assignable to it: a wider `task:
 * string` or `dtype: string` would not be, because the library's own signature
 * accepts neither.
 */
type TransformersModule = {
  pipeline: (
    task: 'zero-shot-classification',
    model: string,
    options: {
      device: typeof MODEL_DEVICE;
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
 * task name, the three options passed below, and the *signature* of the session
 * that comes back — how it is called, and with what.
 *
 * What it deliberately does not cover is the session's *answer*:
 * `ZeroShotSession` resolves to `Promise<unknown>`, because a type here would
 * be this front asserting a shape it cannot check at run time, which is the
 * cast this design exists to avoid. `readZeroShotOutput` is what guards that
 * shape, on the value itself, every call.
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
};

/**
 * A loader that downloads the real model and returns a real pipeline.
 *
 * Lazy by construction: this function builds a loader and touches nothing. The
 * download happens when the loader is called, which `LocalInterpreter` does on
 * the first description and never at construction — 303 MB may not begin
 * arriving because a page was opened.
 *
 * @throws {ModelUnavailableError} from the returned loader, for every way the
 *                                 library or the download can fail.
 */
export function createTransformersLoader(options: TransformersLoaderOptions = {}): PipelineLoader {
  const importModule = options.importModule ?? importTransformers;

  return async (report: ProgressReport): Promise<ZeroShotPipeline> => {
    report({ kind: 'starting' });

    let classify;
    try {
      const transformers = await importModule();
      classify = await transformers.pipeline('zero-shot-classification', MODEL_ID, {
        device: MODEL_DEVICE,
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

    // `preparing` is deliberately not reported here. The compile it describes
    // happens inside the await above, so a report on this side of it is a state
    // no browser turn can observe — measured at 0.04 ms of visibility before it
    // was moved. It is raised from the library's `done` event instead; see
    // `readRawProgress`.
    report({ kind: 'ready' });

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

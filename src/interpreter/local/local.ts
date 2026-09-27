/**
 * The fifth implementation of `Interpreter`: no key, no backend, no network
 * after the first description.
 *
 * `ClaudeInterpreter` sends a sentence to a language model and reads JSON back.
 * This one runs a 279M-parameter multilingual NLI model in the browser and asks
 * it five entailment questions — see `interpret.ts` for what each one is and
 * `templates.ts` for how each is phrased. The output is the same `Constraints`,
 * through the same schema, and the two are interchangeable at the call site
 * because `Interpreter` was an interface from the first day.
 *
 * What it costs is the model: about 317 MB of int8 ONNX, fetched once and then
 * cached by the browser. That number is the whole reason this class is shaped
 * the way it is. Constructing it downloads nothing; the first `interpret` does,
 * and reports where it has got to through `onProgress`, because 317 MB behind a
 * silent page is indistinguishable from a page that has crashed.
 */

import type { Constraints, Interpreter } from '../../core/types';
import { InterpreterError } from '../errors';

import { ClassificationFailedError, ModelUnavailableError } from './errors';
import { classify } from './interpret';
import { createTransformersLoader } from './pipeline';
import type { PipelineLoader, ModelProgress, ProgressReport, ZeroShotPipeline } from './pipeline';

/** How to build one. */
export type LocalInterpreterOptions = {
  /**
   * Told where the load has got to, and which backend it ended on.
   *
   * Optional because the contract is `Interpreter`, and a caller that does not
   * want a status line should not have to invent one. A page that omits it on a
   * cold cache shows nothing for several minutes, which is a choice rather than
   * a default.
   */
  readonly onProgress?: ProgressReport;
  /**
   * Where the classifier comes from. Test seam.
   *
   * Every test in this front passes one. Nothing else does — the default
   * reaches `@huggingface/transformers` and the network.
   */
  readonly loadPipeline?: PipelineLoader;
};

export class LocalInterpreter implements Interpreter {
  private readonly loadPipeline: PipelineLoader;
  private readonly onProgress: ProgressReport | undefined;
  /**
   * The load, once it has started.
   *
   * The *promise* is held rather than the pipeline, so that two descriptions
   * asked for while the model is still arriving wait on one download instead of
   * starting a second. It is cleared again when the load fails, because a
   * failed download is worth retrying — a cached rejection would make the
   * button dead for the rest of the visit over one dropped connection.
   */
  private loading: Promise<ZeroShotPipeline> | undefined;

  constructor(options: LocalInterpreterOptions = {}) {
    this.loadPipeline = options.loadPipeline ?? createTransformersLoader();
    this.onProgress = options.onProgress;
  }

  /**
   * The constraints `text` describes.
   *
   * @throws {RangeError} if `text` has nothing in it — the same refusal
   *                      `ClaudeInterpreter` makes, for the same reason: there
   *                      is no map in an empty description, and here it would
   *                      also start a 317 MB download to find that out.
   * @throws {ModelUnavailableError} if the model could not be made ready.
   * @throws {ClassificationFailedError} if it ran and answered unusably.
   */
  async interpret(text: string): Promise<Constraints> {
    if (text.trim() === '') {
      throw new RangeError('interpret() needs a description to work from');
    }

    const pipeline = await this.ready();

    try {
      return await classify(text, pipeline);
    } catch (error) {
      // `classify` and `readZeroShotOutput` already say precisely what was
      // wrong; re-wrapping would nest one sentence inside another. Everything
      // else is the library throwing from inside the session — out of memory,
      // a lost WebGPU device — and that is what this arm is for.
      throw error instanceof InterpreterError
        ? error
        : new ClassificationFailedError(messageOf(error), { cause: error });
    }
  }

  /**
   * The pipeline, loading it if this is the first call.
   *
   * @throws {ModelUnavailableError} for every way loading can fail. The default
   *                                 loader already reports its own failures as
   *                                 this type; the wrapping here is for a
   *                                 loader that does not, which includes every
   *                                 one a caller supplies.
   */
  private async ready(): Promise<ZeroShotPipeline> {
    this.loading ??= this.loadPipeline(this.report);
    try {
      return await this.loading;
    } catch (error) {
      this.loading = undefined;
      throw error instanceof ModelUnavailableError
        ? error
        : new ModelUnavailableError(messageOf(error), { cause: error });
    }
  }

  /**
   * Passes progress on, if anyone asked for it.
   *
   * A bound property rather than a method, because it is handed to the loader
   * as a plain function and would otherwise arrive with no `this`.
   */
  private readonly report = (progress: ModelProgress): void => {
    this.onProgress?.(progress);
  };
}

/** Whatever `error` has to say for itself, without assuming it is an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

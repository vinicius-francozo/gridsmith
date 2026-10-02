/**
 * The two ways the local interpreter fails, as siblings of the network ones.
 *
 * `../errors.ts` names the failures of a call that leaves the machine — no key,
 * a rejected key, a dead connection, a browser that refused the answer. None of
 * those exist here: this interpreter has no key and, after the first load, no
 * network. What it has instead is a 303 MB model that may never arrive and a
 * quantised classifier that may answer with something unreadable, and those are
 * two different things to be told.
 *
 * They extend `InterpreterError` rather than `Error` so that everything already
 * written against that base keeps working — `describeFailure` in
 * `src/ui/messages.ts` ends with an `instanceof InterpreterError` arm, so a
 * failure from this front reaches the screen as a sentence with the technical
 * line under it, instead of as "something went wrong while building the map". It reaches it through the *catch-all* arm, though, which is a real
 * shortfall and is reported rather than papered over: `messages.ts` belongs to
 * another front and cannot be given a phrase for these two from here.
 */

import { InterpreterError } from '../errors';

/**
 * The model could not be made ready to run.
 *
 * Every reason lands here and that is deliberate. The download is hundreds of
 * megabytes over a connection this code cannot see, the runtime may be a
 * browser without enough memory to compile the graph on the one path this
 * front asks for — `MODEL_DEVICE` is `wasm` and there is no second path to
 * fall back to — and the failure the library reports for each is a message
 * string rather than a type. Splitting them would mean matching on that prose,
 * which is exactly what `../errors.ts` exists to avoid doing.
 */
export class ModelUnavailableError extends InterpreterError {
  constructor(detail: string, options?: ErrorOptions) {
    super(
      'The local model could not be loaded. It is a large download and it needs a browser ' +
        `that can run it: ${detail}`,
      options,
    );
    this.name = 'ModelUnavailableError';
  }
}

/**
 * The model ran and answered with something this layer cannot use.
 *
 * Three shapes of that, all of them reachable: the pipeline threw part way
 * through, it answered with labels that are not the ones it was asked about, or
 * the constraints assembled from its scores did not survive the schema. The
 * last one is the reason this type exists at all — the classifier picks from a
 * closed set by construction, so a failure there means the construction is
 * wrong, and saying so beats handing the generator a `clutter` of 1.7.
 */
export class ClassificationFailedError extends InterpreterError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`The local model's answer could not be read as a set of constraints: ${detail}`, options);
    this.name = 'ClassificationFailedError';
  }
}

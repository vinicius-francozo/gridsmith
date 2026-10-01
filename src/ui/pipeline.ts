/**
 * The whole loop, in one function: text in, a drawn map out.
 *
 * Every other module in this project is one stage. This is the only place the
 * five of them are joined, and it is written as a plain function over injected
 * dependencies rather than as part of the page so that the join itself can be
 * tested — the interpreter stood in for, the library real, the canvas a
 * recorder. What is left for the browser is the rasteriser and the PNG encoder,
 * and nothing that decides anything.
 *
 * Failures are not caught here. Each stage throws something the interface can
 * tell apart — `MissingApiKeyError`, `SceneValidationError`, the `TypeError`
 * the renderer raises over a broken asset contract — and flattening them into
 * one error here would throw away exactly the distinction `errors.ts` and
 * `validate.ts` were written to preserve. `describeFailure` in `messages.ts` is
 * where they are turned into something a person reads.
 */

import { createRng } from '../core/prng';
import type { AssetLibrary, Constraints, Interpreter, Params, Scene } from '../core/types';
import { generate } from '../generator/generate';
import { resolve } from '../interpreter/resolve';
import { renderScene } from '../renderer/render';
import type { RenderTarget } from '../renderer/render';

/** What the person asked for. */
export type GenerationInput = {
  /** The description, in whatever language it was spoken. */
  description: string;
  /** The seed, already read from the field or drawn — never decided here. */
  seed: number;
};

/**
 * What the loop needs from outside itself.
 *
 * All three are supplied by the caller. The interpreter because it carries the
 * user's key and must not be built here; the library because the marking
 * library is a stand-in for one the author supplies; the target because this
 * module has no business touching the document.
 */
export type GenerationDeps = {
  interpreter: Interpreter;
  library: AssetLibrary;
  target: RenderTarget;
  /**
   * Told each time the loop moves on, so the page can say where it is.
   *
   * The two stages are not the same length and not the same kind of waiting.
   * Asking the model is a round trip over the network; drawing a 20×20 hall is
   * this machine, resolving a bitmap per cell. A page that says "interpretando"
   * for both tells the person to check their connection while the fault, if
   * there is one, is on their own screen.
   */
  onStage?: (stage: GenerationStage) => void;
  /**
   * Whether the grid rule is drawn over the map. On unless the page says
   * otherwise — the page's grid button decides it, and the exported PNG is the
   * canvas, so what is on screen is what is saved.
   */
  grid?: boolean;
};

/** Which part of the loop is running. */
export type GenerationStage = 'interpreting' | 'drawing';

/** Everything the loop produced, including what it had to give up on. */
export type Generation = {
  /** What the model understood, `unresolved` included. */
  constraints: Constraints;
  /** What was actually built, `conflicts` included. */
  params: Params;
  scene: Scene;
};

/**
 * Interprets, resolves, generates and draws.
 *
 * The seed is used twice and that is correct rather than a slip: `resolve`
 * seeds its own generator to settle the footprint and the door count, and
 * `generate` is handed a second generator from the same seed for the three
 * stages. Both are pure functions of the number, so one seed still names one
 * map — the two streams are separate by construction, not by coincidence.
 *
 * @throws {InterpreterError} when the description could not be interpreted.
 * @throws {RangeError} when the description is empty, or the seed is not an
 *                      integer, or the resolved place type is unknown.
 * @throws {SceneValidationError} when the generated scene is unplayable.
 * @throws {TypeError} when the scene or the library break the asset contract,
 *                     or the target has no 2d context.
 */
export async function generateMap(
  input: GenerationInput,
  deps: GenerationDeps,
): Promise<Generation> {
  const reached = (stage: GenerationStage): void => {
    deps.onStage?.(stage);
  };

  reached('interpreting');
  const constraints = await deps.interpreter.interpret(input.description);

  // Everything from here on is this machine: settling the parameters, laying
  // the place out, and painting it. Drawing is the part of that the person
  // watches, so it is the part the stage is named for.
  reached('drawing');
  const params = resolve(constraints, input.seed);
  const scene = generate(params, createRng(input.seed), deps.library);
  await renderScene(scene, deps.library, deps.target, { grid: deps.grid !== false });
  return { constraints, params, scene };
}

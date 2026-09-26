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
};

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
  const constraints = await deps.interpreter.interpret(input.description);
  const params = resolve(constraints, input.seed);
  const scene = generate(params, createRng(input.seed));
  await renderScene(scene, deps.library, deps.target);
  return { constraints, params, scene };
}

/**
 * The generator's entry point: `Params` in, `Scene` out.
 *
 * The three stages run in order, each a pure function of its input and the
 * injected `Rng`. Nothing here reads the clock, the environment or
 * `Math.random`, so the same `Params` and the same seed give back the same
 * `Scene`, cell for cell — which is the invariant the whole project rests on
 * and the precondition for ever editing a map by conversation.
 */

import type { AssetLibrary, Params, Rng, Scene } from '../core/types';
import { buildFloorplan } from './floorplan';
import { deriveLights } from './lights';
import { paintMaterials } from './materials';
import { profileFor, resolveAssets } from './profiles';
import { placeProps } from './props';
import { SceneValidationError, validateScene } from './validate';

/**
 * Generates a scene.
 *
 * The library is injected rather than reached for. `resolveAssets` draws a
 * variant for each concept the profile names, so the stages below it are still
 * pure functions of a profile that already knows what it holds — and it is why
 * a map generated before concepts existed does not reproduce prop for prop.
 * The plan and the paint do: it runs after them.
 *
 * @throws {Error} if the plan admits no door, or if the library has nothing
 *         carrying a concept the profile names.
 * @throws {SceneValidationError} if the finished scene breaks a rule the
 *         stages uphold by construction. It should never fire; it fires
 *         loudly rather than handing the renderer a map that cannot be
 *         played.
 */
export function generate(params: Params, rng: Rng, library: AssetLibrary): Scene {
  const profile = profileFor(params.place);

  const { floorplan, regions } = buildFloorplan(params, profile, rng);
  const { zones, tiles } = paintMaterials(floorplan, regions, profile, rng);
  // The library is consulted here and not at the top, and the placing matters:
  // it draws from `rng`, so every draw after it moves. Between stage two and
  // stage three the plan and the paint are already settled, which keeps the
  // change to the layer it is about — the furniture — instead of moving the
  // walls of every map in the project as well.
  const furnished = resolveAssets(profile, library, rng);
  const props = placeProps(floorplan, params, furnished, rng);
  const lights = deriveLights(floorplan, props, params.light, furnished);

  const scene: Scene = { floorplan, zones, tiles, props, lights };

  const issues = validateScene(scene);
  if (issues.length > 0) {
    throw new SceneValidationError(issues);
  }
  return scene;
}

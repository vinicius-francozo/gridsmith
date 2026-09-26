/**
 * The generator's entry point: `Params` in, `Scene` out.
 *
 * The three stages run in order, each a pure function of its input and the
 * injected `Rng`. Nothing here reads the clock, the environment or
 * `Math.random`, so the same `Params` and the same seed give back the same
 * `Scene`, cell for cell — which is the invariant the whole project rests on
 * and the precondition for ever editing a map by conversation.
 */

import type { Params, Rng, Scene } from '../core/types';
import { buildFloorplan } from './floorplan';
import { deriveLights } from './lights';
import { paintMaterials } from './materials';
import { profileFor } from './profiles';
import { placeProps } from './props';
import { SceneValidationError, validateScene } from './validate';

/**
 * Generates a scene.
 *
 * @throws {Error} if the plan admits no door.
 * @throws {SceneValidationError} if the finished scene breaks a rule the
 *         stages uphold by construction. It should never fire; it fires
 *         loudly rather than handing the renderer a map that cannot be
 *         played.
 */
export function generate(params: Params, rng: Rng): Scene {
  const profile = profileFor(params.placeType);

  const { floorplan, regions } = buildFloorplan(params, profile, rng);
  const { zones, tiles } = paintMaterials(floorplan, regions, profile, rng);
  const props = placeProps(floorplan, params, profile, rng);
  const lights = deriveLights(floorplan, props, params.light, profile);

  const scene: Scene = { floorplan, zones, tiles, props, lights };

  const issues = validateScene(scene);
  if (issues.length > 0) {
    throw new SceneValidationError(issues);
  }
  return scene;
}

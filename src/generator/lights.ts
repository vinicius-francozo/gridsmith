/**
 * Light sources for the scene.
 *
 * `Scene.lights` is what the renderer casts prop shadows from, so it has to
 * be filled even though the v1 does not compute line of sight. Lights are
 * *derived*, not drawn: an anchor that burns — a hearth — lights the room
 * from where it stands, and the ambient level adds a regular lattice of
 * lamps over the floor. Nothing here consumes the rng, so the lighting of a
 * map is a function of its plan alone.
 */

import { cellAt } from '../core/grid';
import type { Floorplan, Light, LightSource, PlacedProp } from '../core/types';
import { assetIdFor } from './profiles';
import type { PlaceProfile } from './profiles';

/** Lamp spacing and reach per ambient level. `dark` gets no lamps at all. */
const AMBIENT: Record<Light, { spacing: number; radiusCells: number } | null> = {
  dark: null,
  dim: { spacing: 7, radiusCells: 4 },
  bright: { spacing: 5, radiusCells: 7 },
};

/**
 * The lamp rule for `light`, or `null` where the level hangs no lamps.
 *
 * @throws {Error} if `light` is outside the closed vocabulary, for the same
 *                 reason `profileFor` guards `placeType`: `Params` may have
 *                 come through a language model and a JSON boundary, and the
 *                 API does not enforce the schema.
 *
 * The guard has to be its own test rather than `!== null` at the call site.
 * `dark` is recorded as a deliberate `null`, so an unknown level comes back
 * `undefined`, passes `!== null`, and the next line reads `.spacing` off it:
 * a raw `TypeError` out of the middle of the generator. The sentinel that
 * makes `dark` explicit is exactly what makes `!== null` the wrong test.
 *
 * And the test is `Object.hasOwn`, not a comparison against `undefined`:
 * `AMBIENT` is an object literal, so `light = 'toString'` finds a function
 * inherited from `Object.prototype`, is not `undefined`, and sails through.
 * It does not even crash — a function is not `null`, `.spacing` is
 * `undefined`, the lattice loop starts at `NaN` and never runs, and the room
 * comes back lit by its hearth alone with nothing raised anywhere. A level
 * that arrived as `JSON.parse('{"light":"toString"}')` would be silently
 * demoted to dark. Closing the vocabulary means asking whether the table
 * declared the key, not whether the answer happened to be absent.
 */
function ambientFor(light: Light): { spacing: number; radiusCells: number } | null {
  if (!Object.hasOwn(AMBIENT, light)) {
    throw new Error(`unknown light level '${light}'`);
  }
  return AMBIENT[light];
}

/** The colour of a hanging lamp; a hearth carries its own, from its spec. */
const LAMP_COLOR = '#ffe9c4';

/** The middle cell of a prop's footprint, biased to the top-left on even sides. */
function centerOf(prop: PlacedProp): { x: number; y: number } {
  return {
    x: prop.cell.x + Math.floor((prop.footprint.w - 1) / 2),
    y: prop.cell.y + Math.floor((prop.footprint.h - 1) / 2),
  };
}

/**
 * The lights of a finished room: one per burning anchor, plus a lattice of
 * lamps if the room is lit at all.
 */
export function deriveLights(
  floorplan: Floorplan,
  props: PlacedProp[],
  light: Light,
  profile: PlaceProfile,
): LightSource[] {
  const lights: LightSource[] = [];

  for (const prop of props) {
    // Defensive, and known to be: only anchors have specs, so the `spec?.light`
    // test below already drops every group and scatter prop and this line
    // changes no output. Kept because "light comes from an anchor" is this
    // module's rule and belongs where the rule is, rather than falling out
    // of a lookup that happens to miss. No test covers it on its own.
    if (prop.layer !== 'anchor') {
      continue;
    }
    const spec = profile.anchors.find(
      (anchor) => assetIdFor('anchor', anchor.assetId) === prop.assetId,
    );
    if (spec?.light === undefined) {
      continue;
    }
    lights.push({
      cell: centerOf(prop),
      radiusCells: spec.light.radiusCells,
      colorHex: spec.light.colorHex,
    });
  }

  const ambient = ambientFor(light);
  if (ambient !== null) {
    const { size, cells } = floorplan;
    const half = Math.floor(ambient.spacing / 2);
    for (let y = half; y < size.h; y += ambient.spacing) {
      for (let x = half; x < size.w; x += ambient.spacing) {
        const cell = { x, y };
        if (cellAt(cells, cell) === 'floor') {
          lights.push({ cell, radiusCells: ambient.radiusCells, colorHex: LAMP_COLOR });
        }
      }
    }
  }

  return lights;
}

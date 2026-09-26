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
import type { PlaceProfile } from './profiles';

/** Lamp spacing and reach per ambient level. `dark` gets no lamps at all. */
const AMBIENT: Record<Light, { spacing: number; radiusCells: number } | null> = {
  dark: null,
  dim: { spacing: 7, radiusCells: 4 },
  bright: { spacing: 5, radiusCells: 7 },
};

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
    if (prop.layer !== 'anchor') {
      continue;
    }
    const spec = profile.anchors.find((anchor) => anchor.assetId === prop.assetId);
    if (spec?.light === undefined) {
      continue;
    }
    lights.push({
      cell: centerOf(prop),
      radiusCells: spec.light.radiusCells,
      colorHex: spec.light.colorHex,
    });
  }

  const ambient = AMBIENT[light];
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

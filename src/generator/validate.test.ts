import { describe, expect, it } from 'vitest';

import type { PlacedProp } from '../core/types';
import { SceneValidationError, validateScene } from './validate';
import { planFrom, sceneFrom } from './test-fixtures';

/** A one-cell prop, since most of these tests only care where it stands. */
function prop(
  assetId: string,
  x: number,
  y: number,
  layer: PlacedProp['layer'] = 'group',
  footprint = { w: 1, h: 1 },
): PlacedProp {
  return { assetId, cell: { x, y }, footprint, rotation: 0, layer };
}

describe('validateScene', () => {
  it('passes an empty room with a door', () => {
    const scene = sceneFrom(
      planFrom([
        '#####',
        '#...#',
        '#...D',
        '#...#',
        '#####',
      ]),
    );
    expect(validateScene(scene)).toEqual([]);
  });

  it('passes a furnished room that still walks', () => {
    const scene = sceneFrom(
      planFrom([
        '######',
        '#....#',
        '#....D',
        '#....#',
        '######',
      ]),
      [prop('crate', 1, 1), prop('crate', 1, 3), prop('mug', 2, 2, 'scatter')],
    );
    expect(validateScene(scene)).toEqual([]);
  });
});

describe('the door rule', () => {
  it('reports a plan with no door at all', () => {
    const scene = sceneFrom(
      planFrom([
        '#####',
        '#...#',
        '#####',
      ]),
    );
    expect(validateScene(scene).map((issue) => issue.kind)).toEqual(['no_door']);
  });

  it('reports a prop standing in the doorway itself', () => {
    const plan = planFrom([
      '#####',
      '#...#',
      '#...D',
      '#####',
    ]);
    const scene = sceneFrom(plan, [prop('barrel', 4, 2)]);
    expect(validateScene(scene).map((issue) => issue.kind)).toContain('door_blocked');
  });

  it('reports a prop on the ground a creature comes through the door onto', () => {
    const plan = planFrom([
      '#####',
      '#...#',
      '#...D',
      '#####',
    ]);
    const scene = sceneFrom(plan, [prop('barrel', 3, 2)]);
    const issues = validateScene(scene);
    expect(issues.map((issue) => issue.kind)).toContain('door_blocked');
    expect(issues[0].cell).toEqual({ x: 3, y: 2 });
  });

  it('reports loose debris in the doorway too, not only furniture', () => {
    // "No door may be blocked by a prop" is the rule, and a mug underfoot in
    // a doorway is a prop. Only the *walking* rules let scatter through.
    const plan = planFrom([
      '#####',
      '#...#',
      '#...D',
      '#####',
    ]);
    const scene = sceneFrom(plan, [prop('mug', 3, 2, 'scatter')]);
    expect(validateScene(scene).map((issue) => issue.kind)).toContain('door_blocked');
  });

  it('says nothing about a prop one cell further in than the approach', () => {
    const plan = planFrom([
      '#####',
      '#...#',
      '#...D',
      '#####',
    ]);
    const scene = sceneFrom(plan, [prop('barrel', 2, 2)]);
    expect(validateScene(scene).map((issue) => issue.kind)).not.toContain('door_blocked');
  });
});

describe('the reachability rule', () => {
  it('reports floor sealed off behind a row of furniture', () => {
    // The right-hand column is walled in by crates. It looks like floor on
    // the finished map and nobody can ever stand on it.
    const plan = planFrom([
      '######',
      'D....#',
      '#....#',
      '#....#',
      '######',
    ]);
    const scene = sceneFrom(plan, [prop('crate', 3, 1), prop('crate', 3, 2), prop('crate', 3, 3)]);
    const issues = validateScene(scene).filter((issue) => issue.kind === 'isolated_floor');
    expect(issues.map((issue) => issue.cell)).toEqual([
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
    ]);
  });

  it('says nothing about the cells the furniture itself stands on', () => {
    // A crate's own cell is not walkable and is not meant to be. Counting it
    // as cut off would make every furnished room fail.
    const plan = planFrom([
      '######',
      'D....#',
      '#....#',
      '######',
    ]);
    const scene = sceneFrom(plan, [prop('crate', 2, 1)]);
    expect(validateScene(scene)).toEqual([]);
  });

  it('walks past loose debris, which is stepped over rather than climbed', () => {
    const plan = planFrom([
      '######',
      'D....#',
      '######',
    ]);
    const scene = sceneFrom(plan, [
      prop('mug', 2, 1, 'scatter'),
      prop('straw', 3, 1, 'scatter'),
    ]);
    expect(validateScene(scene)).toEqual([]);
  });

  it('reports a room with a second chamber the door does not reach', () => {
    const plan = planFrom([
      '#####',
      'D.#.#',
      '#.#.#',
      '#####',
    ]);
    const kinds = validateScene(sceneFrom(plan)).map((issue) => issue.kind);
    expect(kinds).toEqual(['isolated_floor', 'isolated_floor']);
  });
});

describe('the circulation rule', () => {
  const room = planFrom([
    '###D###',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ]);

  it('reports two pieces of furniture that touch only at a corner', () => {
    // Diagonally touching furniture leaves a gap nobody can walk down.
    const scene = sceneFrom(room, [prop('crate', 1, 1), prop('barrel', 2, 2)]);
    expect(validateScene(scene).map((issue) => issue.kind)).toEqual(['circulation_pinch']);
  });

  it('reports a pinch once, not once from each side of it', () => {
    const scene = sceneFrom(room, [prop('crate', 1, 1), prop('barrel', 2, 2)]);
    expect(validateScene(scene)).toHaveLength(1);
  });

  it('reports a pinch once for a pair that touches at more than one corner', () => {
    // A two-cell shelf and a two-cell stack cornering on each other are one
    // problem, however many cells of theirs happen to be diagonal neighbours.
    const scene = sceneFrom(room, [
      prop('shelf', 1, 1, 'anchor', { w: 1, h: 2 }),
      prop('crate', 2, 3, 'group', { w: 2, h: 1 }),
    ]);
    const pinches = validateScene(scene).filter((issue) => issue.kind === 'circulation_pinch');
    expect(pinches).toHaveLength(1);
  });

  it('says nothing about pieces of one arrangement that touch edge to edge', () => {
    // A chair pulled up to its table is one clump, not two things too close.
    const scene = sceneFrom(room, [prop('table_round', 1, 1), prop('chair', 2, 1)]);
    expect(validateScene(scene)).toEqual([]);
  });

  it('says nothing about pieces with a cell of floor between them', () => {
    const scene = sceneFrom(room, [prop('crate', 1, 1), prop('barrel', 1, 3)]);
    expect(validateScene(scene)).toEqual([]);
  });

  it('ignores debris, which is walked over rather than squeezed between', () => {
    const scene = sceneFrom(room, [prop('crate', 1, 1), prop('mug', 2, 2, 'scatter')]);
    expect(validateScene(scene)).toEqual([]);
  });
});

describe('SceneValidationError', () => {
  it('carries every issue and names them all in its message', () => {
    const issues = validateScene(
      sceneFrom(
        planFrom([
          '#####',
          '#...#',
          '#####',
        ]),
      ),
    );
    const error = new SceneValidationError(issues);
    expect(error.issues).toEqual(issues);
    expect(error.name).toBe('SceneValidationError');
    expect(error.message).toContain('the plan has no door');
    expect(error).toBeInstanceOf(Error);
  });
});

import { describe, expect, it } from 'vitest';

import type { Condition, Light, PlaceType } from '../../core/types';
import { FEATURES } from '../vocabulary';

import {
  CLUTTER_BY_CONDITION,
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LABEL_PLACEHOLDER,
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
  STOREROOM_WORD,
} from './templates';
import type { ChoiceTemplate } from './templates';

/**
 * The vocabularies, written out by hand.
 *
 * The `Record` types in `templates.ts` already make the compiler refuse a
 * missing key, so these lists are not a second copy of that check — they are
 * the independent one. `PlaceType` could gain a fourth kind and both the type
 * and the template would move together without anybody noticing; these lines
 * are what makes that a failing test instead.
 */
const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];
const LIGHTS: Light[] = ['dark', 'dim', 'bright'];
const CONDITIONS: Condition[] = ['tidy', 'lived_in', 'disordered', 'ruined'];
const SIZE_HINTS = ['small', 'medium', 'large'];

const ALL_TEMPLATES: Array<{ name: string; template: ChoiceTemplate<string> }> = [
  { name: 'place type', template: PLACE_TYPE_TEMPLATE },
  { name: 'light', template: LIGHT_TEMPLATE },
  { name: 'condition', template: CONDITION_TEMPLATE },
  { name: 'size hint', template: SIZE_HINT_TEMPLATE },
  { name: 'feature', template: FEATURE_TEMPLATE },
];

describe('every template is askable', () => {
  it('leaves exactly one hole for the label in each hypothesis', () => {
    for (const { name, template } of ALL_TEMPLATES) {
      const holes = template.hypothesis.split(LABEL_PLACEHOLDER).length - 1;
      expect(`${name}: ${String(holes)}`).toBe(`${name}: 1`);
    }
  });

  it('gives every value a label with something in it', () => {
    for (const { name, template } of ALL_TEMPLATES) {
      for (const [value, label] of Object.entries(template.labels)) {
        expect(`${name}.${value}: ${label.trim()}`).not.toBe(`${name}.${value}: `);
      }
    }
  });

  it('never gives two values the same label', () => {
    // Two values sharing a phrase would make the classifier's score for it
    // ambiguous, and `scoresByValue` would see the same label twice and refuse
    // the whole answer.
    for (const { name, template } of ALL_TEMPLATES) {
      const labels = Object.values(template.labels);
      expect(`${name}: ${String(new Set(labels).size)}`).toBe(`${name}: ${String(labels.length)}`);
    }
  });
});

describe('every template covers its closed vocabulary', () => {
  it('asks about all three kinds of place', () => {
    expect(Object.keys(PLACE_TYPE_TEMPLATE.labels).sort()).toEqual([...PLACE_TYPES].sort());
  });

  it('asks about all three lights', () => {
    expect(Object.keys(LIGHT_TEMPLATE.labels).sort()).toEqual([...LIGHTS].sort());
  });

  it('asks about all four conditions', () => {
    expect(Object.keys(CONDITION_TEMPLATE.labels).sort()).toEqual([...CONDITIONS].sort());
  });

  it('asks about all three size hints', () => {
    expect(Object.keys(SIZE_HINT_TEMPLATE.labels).sort()).toEqual([...SIZE_HINTS].sort());
  });

  it('asks about every feature in the vocabulary, and nothing else', () => {
    expect(Object.keys(FEATURE_TEMPLATE.labels).sort()).toEqual([...FEATURES].sort());
  });
});

describe('what the bench measured about the wording', () => {
  it('asks each of the five questions in the words they were measured in', () => {
    // The frame every label is judged inside. Changing one of these changes all
    // of that question's answers at once and leaves no other trace, so the five
    // are written out here by hand — a measured sentence that somebody reworded
    // on the way past should be a red test, not a quieter map.
    expect(PLACE_TYPE_TEMPLATE.hypothesis).toBe('Este texto é sobre {}.');
    expect(LIGHT_TEMPLATE.hypothesis).toBe('A iluminação do lugar é assim: {}.');
    expect(CONDITION_TEMPLATE.hypothesis).toBe('O lugar está {}.');
    expect(SIZE_HINT_TEMPLATE.hypothesis).toBe('O lugar é {}.');
    expect(FEATURE_TEMPLATE.hypothesis).toBe('O lugar tem {}.');
  });

  it('never offers the model a choice inside one label', () => {
    // Measured: `'pilares ou colunas'` took the feature F1 from 0.94 to 0.79
    // and invented false positives. The alternatives belong in `synonyms.ts`,
    // where they are resolved before the model is asked anything.
    for (const { name, template } of ALL_TEMPLATES) {
      for (const [value, label] of Object.entries(template.labels)) {
        expect(`${name}.${value}: ${String(/\bou\b/.test(label))}`).toBe(`${name}.${value}: false`);
      }
    }
  });

  it('keeps every feature label a bare noun', () => {
    // Measured: enriching these labels took the feature F1 from 0.94 to 0.57.
    for (const [feature, label] of Object.entries(FEATURE_TEMPLATE.labels)) {
      expect(`${feature}: ${String(label.split(/\s+/).length)}`).toBe(`${feature}: 1`);
    }
  });

  it('keeps every kind of place to a short label', () => {
    // Measured: phrasing these as descriptive sentences — the worst of them
    // eleven words long — scored 45% against 90% for the short ones.
    for (const [place, label] of Object.entries(PLACE_TYPE_TEMPLATE.labels)) {
      expect(`${place}: ${String(label.split(/\s+/).length <= 4)}`).toBe(`${place}: true`);
    }
  });

  it('builds the storeroom label on the word the synonym layer rewrites towards', () => {
    // `synonyms.ts` reads `STOREROOM_WORD`, not this label. If the two ever
    // stopped being the same word, every "porão" would be rewritten into a word
    // no hypothesis mentions.
    expect(PLACE_TYPE_TEMPLATE.labels.tavern_storeroom.split(' ')[0]).toBe(STOREROOM_WORD);
  });
});

describe('the thresholds and the clutter table', () => {
  it('keeps every threshold inside a probability', () => {
    for (const template of [PLACE_TYPE_TEMPLATE, SIZE_HINT_TEMPLATE, FEATURE_TEMPLATE]) {
      expect(template.minConfidence).toBeGreaterThan(0);
      expect(template.minConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('puts the place-type gate above an even split of the three', () => {
    // Below a third the gate would accept everything, including the answers the
    // bench measured it holding back.
    expect(PLACE_TYPE_TEMPLATE.minConfidence).toBeGreaterThan(1 / 3);
  });

  it('holds each threshold to the figure it was measured at', () => {
    // Written out rather than read back, so that moving one of these is a
    // decision somebody makes twice rather than a number that drifts. Each is
    // a measurement, and the measurement is named beside it.

    // AUC 0.922 of confidence against correctness; at 0.55 the bench accepted
    // 13 of 20 descriptions and all 13 were right.
    expect(PLACE_TYPE_TEMPLATE.minConfidence).toBe(0.55);
    // The point above which a winning size is a size the description asked for
    // rather than the top of a three-way tie.
    expect(SIZE_HINT_TEMPLATE.minConfidence).toBe(0.55);
    // Independent yes/no questions, so the half-way mark is the answer itself.
    expect(FEATURE_TEMPLATE.minConfidence).toBe(0.5);
  });

  it('puts the size threshold above an even split of the three', () => {
    // Below a third, a description that never mentioned a size would come back
    // with one anyway, and `sizeHint` would stop meaning "they asked for this".
    expect(SIZE_HINT_TEMPLATE.minConfidence).toBeGreaterThan(1 / 3);
  });

  it('gives every condition a clutter figure inside 0..1', () => {
    for (const condition of CONDITIONS) {
      expect(CLUTTER_BY_CONDITION[condition]).toBeGreaterThanOrEqual(0);
      expect(CLUTTER_BY_CONDITION[condition]).toBeLessThanOrEqual(1);
    }
  });

  it('orders the clutter figures the way the conditions are ordered', () => {
    // A tidier place is not messier than a more ruined one. Without this the
    // weighted average in `deriveClutter` would still produce a number, and it
    // would be the wrong way round.
    const figures = CONDITIONS.map((condition) => CLUTTER_BY_CONDITION[condition]);

    expect(figures).toEqual([...figures].sort((left, right) => left - right));
  });
});

import { describe, expect, it } from 'vitest';

import type { Building, Condition, Light, RoomKind } from '../../core/types';
import { FEATURES } from '../vocabulary';

import {
  CLUTTER_BY_CONDITION,
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LABEL_PLACEHOLDER,
  LIGHT_TEMPLATE,
  BUILDING_TEMPLATE,
  ROOM_TEMPLATES,
  FURNISHING_BY_LEVEL,
  FURNISHING_TEMPLATE,
  SIZE_HINT_TEMPLATE,
  STOREROOM_WORD,
} from './templates';
import type { ChoiceTemplate } from './templates';

/**
 * The vocabularies, written out by hand.
 *
 * The `Record` types in `templates.ts` already make the compiler refuse a
 * missing key, so these lists are not a second copy of that check — they are
 * the independent one. `Place` could gain a fourth kind and both the type
 * and the template would move together without anybody noticing; these lines
 * are what makes that a failing test instead.
 */
const BUILDINGS: Building[] = ['tavern', 'dungeon'];
// Two lists, because the matrix is sparse: a dungeon has a crypt and a tavern
// does not. One list over every `RoomKind` would have asked the tavern for a
// label it must not have.
const TAVERN_ROOMS: RoomKind[] = ['hall', 'room', 'storeroom'];
const DUNGEON_ROOMS: RoomKind[] = ['hall', 'room', 'storeroom', 'crypt'];
const LIGHTS: Light[] = ['dark', 'dim', 'bright'];
const CONDITIONS: Condition[] = ['tidy', 'lived_in', 'disordered', 'ruined'];
const SIZE_HINTS = ['small', 'medium', 'large'];

const ALL_TEMPLATES: Array<{ name: string; template: ChoiceTemplate<string> }> = [
  { name: 'building', template: BUILDING_TEMPLATE },
  { name: 'tavern room', template: ROOM_TEMPLATES.tavern },
  { name: 'dungeon room', template: ROOM_TEMPLATES.dungeon },
  { name: 'light', template: LIGHT_TEMPLATE },
  { name: 'condition', template: CONDITION_TEMPLATE },
  { name: 'size hint', template: SIZE_HINT_TEMPLATE },
  { name: 'furnishing', template: FURNISHING_TEMPLATE },
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
  it('asks about each building and the rooms that building has', () => {
    expect(Object.keys(BUILDING_TEMPLATE.labels).sort()).toEqual([...BUILDINGS].sort());
    expect(Object.keys(ROOM_TEMPLATES.tavern.labels).sort()).toEqual([...TAVERN_ROOMS].sort());
    expect(Object.keys(ROOM_TEMPLATES.dungeon.labels).sort()).toEqual([...DUNGEON_ROOMS].sort());
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

describe('the wording handed to the classifier', () => {
  it('pins the seven hypotheses, including the two new place questions', () => {
    expect(BUILDING_TEMPLATE.hypothesis).toBe('A construção é {}.');
    expect(ROOM_TEMPLATES.tavern.hypothesis).toBe('O cômodo é {}.');
    expect(LIGHT_TEMPLATE.hypothesis).toBe('A iluminação do lugar é assim: {}.');
    expect(CONDITION_TEMPLATE.hypothesis).toBe('O lugar está {}.');
    expect(SIZE_HINT_TEMPLATE.hypothesis).toBe('O lugar é {}.');
    expect(FEATURE_TEMPLATE.hypothesis).toBe('O lugar tem {}.');
    expect(FURNISHING_TEMPLATE.hypothesis).toBe('A mobília do lugar é assim: {}.');
  });

  it('gives every question asked in one pass a hypothesis of its own', () => {
    // Every stand-in classifier in this front dispatches on the hypothesis, so
    // two questions sharing one string is a silently wrong answer rather than a
    // failure. `furnishing` would have read naturally as `'O lugar está {}.'`,
    // which is `condition`'s.
    //
    // The two room templates are left out and are the exception that proves the
    // rule: they share a hypothesis, and `classify` asks exactly one of them,
    // chosen by the building it already settled on.
    const asked = ALL_TEMPLATES.filter(({ name }) => name !== 'dungeon room');
    const hypotheses = asked.map(({ template }) => template.hypothesis);
    expect(new Set(hypotheses).size).toBe(hypotheses.length);
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
    for (const [place, label] of Object.entries(ROOM_TEMPLATES.tavern.labels)) {
      expect(`${place}: ${String(label.split(/\s+/).length <= 4)}`).toBe(`${place}: true`);
    }
  });

  it('pins the existing measured labels and the new unmeasured place labels', () => {
    // ## Why the wording is written out here, and what it costs to change
    //
    // The old bench measured the light, condition, size and feature labels,
    // plus one three-way tavern place choice. Building and room are new
    // questions and do not inherit its place accuracy or confidence figures.
    //
    // So this test does not claim the labels below are the *right* words. It
    // claims they are the *measured* words. Without it, somebody tidies
    // `'usado, mas em ordem'` down to `'usado'` in passing, every number in
    // `templates.ts` quietly stops describing the code that is running, and
    // nothing anywhere says so. The shape checks above would not notice: a
    // one-word condition label is still non-empty, still unique, still free of
    // "ou".
    //
    // The cost is deliberate. A later bench is expected to replace these, and
    // it has to replace them *here and in `templates.ts` together*, in one
    // change, on purpose. If you are editing this list, you are invalidating a
    // measurement — re-run the bench, or the comments in `templates.ts` are
    // now false.
    expect(ROOM_TEMPLATES.tavern.labels).toEqual({
      hall: 'salão de taverna',
      room: 'quarto de taverna',
      storeroom: 'depósito de taverna',
    });
    expect(ROOM_TEMPLATES.dungeon.labels).toEqual({
      hall: 'salão da masmorra',
      room: 'cela da masmorra',
      storeroom: 'arsenal da masmorra',
      crypt: 'cripta da masmorra',
    });
    expect(LIGHT_TEMPLATE.labels).toEqual({
      dark: 'escuridão total, não há luz nenhuma',
      dim: 'luz fraca, penumbra, meia-luz',
      bright: 'muita luz, o lugar é claro e bem iluminado',
    });
    expect(CONDITION_TEMPLATE.labels).toEqual({
      tidy: 'limpo e arrumado',
      lived_in: 'usado, mas em ordem',
      disordered: 'bagunçado e desarrumado',
      ruined: 'destruído e em ruínas',
    });
    expect(SIZE_HINT_TEMPLATE.labels).toEqual({
      small: 'pequeno',
      medium: 'de tamanho médio',
      large: 'grande',
    });
    // These seven are also the words `synonyms.ts` rewrites descriptions
    // *towards*, which it reads from here rather than restating. Changing one
    // silently re-points that whole layer.
    expect(FEATURE_TEMPLATE.labels).toEqual({
      bar: 'balcão',
      hearth: 'lareira',
      stairs: 'escada',
      pillars: 'pilares',
      alcove: 'alcova',
      shelving: 'prateleiras',
      bunks: 'beliches',
    });
  });

  it('pins the furnishing labels, and keeps them about furniture alone', () => {
    // Furniture on the floor and nothing about how clean it is: the separation
    // from `condition` is the whole point of the question, and a label that
    // said "sujo" or "arrumado" would put it back.
    expect(FURNISHING_TEMPLATE.labels).toEqual({
      bare: 'sem móveis, o chão está vazio',
      sparse: 'com pouca mobília, umas poucas peças',
      furnished: 'mobiliado, com mesas, bancos e caixotes',
      crowded: 'abarrotado de móveis, quase sem espaço livre',
    });
    for (const label of Object.values(FURNISHING_TEMPLATE.labels)) {
      for (const word of Object.values(CONDITION_TEMPLATE.labels)) {
        expect(label).not.toContain(word);
      }
    }
  });

  it('builds the storeroom label on the word the synonym layer rewrites towards', () => {
    // `synonyms.ts` reads `STOREROOM_WORD`, not this label. If the two ever
    // stopped being the same word, every "porão" would be rewritten into a word
    // no hypothesis mentions.
    expect(ROOM_TEMPLATES.tavern.labels.storeroom?.split(' ')[0]).toBe(STOREROOM_WORD);
  });
});

describe('the thresholds and the clutter table', () => {
  it('keeps every threshold inside a probability', () => {
    for (const template of [SIZE_HINT_TEMPLATE, FEATURE_TEMPLATE]) {
      expect(template.minConfidence).toBeGreaterThan(0);
      expect(template.minConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('holds each threshold to the figure it was measured at', () => {
    // Written out rather than read back, so that moving one of these is a
    // decision somebody makes twice rather than a number that drifts. Each of
    // the three is a measurement and each names its own, because the reason a
    // threshold sits where it does is the only thing that says what a later
    // bench would have to beat to move it.

    // Swept from 0.40 to 0.70 against these labels: 40%, 70%, 80%, then 95% at
    // 0.55 and 95% at every step above it. 0.55 is the bottom of that plateau,
    // 19 of 20, the single error a `small` the gate read as no size at all.
    // Lower is measurably worse; higher buys nothing and only refuses more.
    expect(SIZE_HINT_TEMPLATE.minConfidence).toBe(0.55);
    // Swept from 0.2 to 0.999 against these seven labels: F1 tops out at 0.94
    // across 0.5 and 0.6, with no false positive at either and two features
    // missed. At 0.4 it is 0.92 and a feature is invented. So 0.5 is the bottom
    // of that plateau too — and it happens to be the half-way mark, which is
    // what independent yes/no questions would suggest anyway.
    expect(FEATURE_TEMPLATE.minConfidence).toBe(0.5);
  });

  it('puts the size threshold above an even split of the three', () => {
    // Below a third, a description that never mentioned a size would come back
    // with one anyway, and `sizeHint` would stop meaning "they asked for this".
    expect(SIZE_HINT_TEMPLATE.minConfidence).toBeGreaterThan(1 / 3);
  });

  it('spans the whole of 0..1 with the furnishing figures, in the order of the labels', () => {
    // 0 rather than `CLUTTER_BY_CONDITION`'s 0.1 floor: a tidy room still has
    // dust in it, and a bare room has no furniture.
    const figures = Object.keys(FURNISHING_TEMPLATE.labels).map(
      (level) => FURNISHING_BY_LEVEL[level as keyof typeof FURNISHING_BY_LEVEL],
    );
    expect(figures[0]).toBe(0);
    expect(figures[figures.length - 1]).toBe(1);
    for (let i = 1; i < figures.length; i += 1) {
      expect(figures[i]).toBeGreaterThan(figures[i - 1]);
    }
  });

  it('gives a furnishing figure to every label and nothing else', () => {
    expect(Object.keys(FURNISHING_BY_LEVEL).sort()).toEqual(
      Object.keys(FURNISHING_TEMPLATE.labels).sort(),
    );
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

import { describe, expect, it } from 'vitest';

import type { Building, Condition, Light, RoomKind } from '../../core/types';
import { BUILDINGS } from '../../generator/profiles';
import { FEATURES } from '../vocabulary';
import type { Feature } from '../vocabulary';

import { ClassificationFailedError } from './errors';
import {
  bestOf,
  classify,
  constraintsFrom,
  deriveClutter,
  deriveFurnishing,
  labelsOf,
  readFeatures,
  readLight,
  readBuilding,
  readRoom,
  roomTemplateFor,
  readSizeHint,
  scoresByValue,
} from './interpret';
import type { ZeroShotOptions, ZeroShotOutput, ZeroShotPipeline } from './pipeline';
import {
  CLUTTER_BY_CONDITION,
  CONDITION_TEMPLATE,
  FURNISHING_TEMPLATE,
  FEATURE_TEMPLATE,
  LIGHT_TEMPLATE,
  BUILDING_TEMPLATE,
  ROOM_TEMPLATES,
  SIZE_HINT_TEMPLATE,
} from './templates';
import type { ChoiceTemplate, FurnishingLevel } from './templates';

/**
 * Nothing here downloads a model. The classifier is stood in for in every test,
 * which is what makes this file the one that has to exercise the translation
 * itself — the classifier is the only thing a stand-in removes, and everything
 * below it is what this front actually decides.
 */

/**
 * An answer, in the shape the real pipeline gives one.
 *
 * Sorted by score, descending, because that is what `transformers.js` returns
 * and reading by position instead of by label is precisely the bug this shape
 * exists to catch.
 */
function outputFor<T extends string>(
  template: ChoiceTemplate<T>,
  scores: Readonly<Record<T, number>>,
): ZeroShotOutput {
  const rows = (Object.keys(template.labels) as T[])
    .map((value) => ({ label: template.labels[value], score: scores[value] }))
    .sort((left, right) => right.score - left.score);
  return { labels: rows.map((row) => row.label), scores: rows.map((row) => row.score) };
}

/**
 * The room choice each building really offers, narrowed the way the engine
 * narrows it.
 *
 * `ROOM_TEMPLATES` is the declaration and is sparse — a dungeon has a crypt and
 * a tavern does not — so it is not a `ChoiceTemplate<RoomKind>` and was never
 * what the classifier is asked. `roomTemplateFor` is, and asking it here is
 * also what keeps these tests measuring the four labels a dungeon now has
 * rather than the three the table used to guarantee.
 */
const TAVERN_ROOMS = roomTemplateFor('tavern');
const DUNGEON_ROOMS = roomTemplateFor('dungeon');

const CERTAIN_BUILDING: Record<Building, number> = {
  tavern: 0.9, dungeon: 0.1, forge: 0, temple: 0,
};
// Scored over every room there is; `outputFor` only reads the ones the template
// it is given declares, so this one answer serves both buildings.
const CERTAIN_HALL: Record<RoomKind, number> = {
  hall: 0.9, room: 0.07, storeroom: 0.03, crypt: 0.01, smithy: 0,
};
const CERTAIN_DIM: Record<Light, number> = { dark: 0.2, dim: 0.7, bright: 0.1 };
const CERTAIN_DISORDER: Record<Condition, number> = {
  tidy: 0.02,
  lived_in: 0.08,
  disordered: 0.8,
  ruined: 0.1,
};
const NO_SIZE_MENTIONED = { small: 0.34, medium: 0.33, large: 0.33 };
const HALF_FURNISHED: Record<FurnishingLevel, number> = {
  bare: 0.1,
  sparse: 0.4,
  furnished: 0.4,
  crowded: 0.1,
};
const NO_FEATURES: Record<Feature, number> = {
  bar: 0.1,
  hearth: 0.1,
  stairs: 0.1,
  pillars: 0.1,
  alcove: 0.1,
  shelving: 0.1,
  bunks: 0.1,
  bed: 0.1,
  weapons: 0.1,
  tomb: 0.1,
};

describe('reading scores back by label', () => {
  it('finds each value however the pipeline ordered its answer', () => {
    // The answer comes back sorted by score, so `tavern_hall` is first in the
    // arrays and third in the template. Reading by position would swap them.
    expect(scoresByValue(TAVERN_ROOMS, outputFor(TAVERN_ROOMS, CERTAIN_HALL))).toEqual({
      hall: 0.9, room: 0.07, storeroom: 0.03,
    });
  });

  it('refuses a label nobody asked about', () => {
    const output: ZeroShotOutput = { labels: ['um trono de obsidiana'], scores: [0.99] };

    expect(() => scoresByValue(TAVERN_ROOMS, output)).toThrow(ClassificationFailedError);
  });

  it('refuses the same label scored twice', () => {
    const label = TAVERN_ROOMS.labels.hall;
    const output: ZeroShotOutput = { labels: [label, label], scores: [0.9, 0.1] };

    expect(() => scoresByValue(TAVERN_ROOMS, output)).toThrow(/twice/);
  });

  it('refuses an answer that left one of the values unscored', () => {
    const output: ZeroShotOutput = {
      labels: [TAVERN_ROOMS.labels.hall, TAVERN_ROOMS.labels.room],
      scores: [0.6, 0.4],
    };

    expect(() => scoresByValue(TAVERN_ROOMS, output)).toThrow(/storeroom/);
  });
});

describe('choosing the best-scoring value', () => {
  it('picks the highest score rather than the first label returned', () => {
    const output: ZeroShotOutput = {
      labels: [LIGHT_TEMPLATE.labels.dark, LIGHT_TEMPLATE.labels.bright, LIGHT_TEMPLATE.labels.dim],
      scores: [0.1, 0.2, 0.7],
    };

    expect(bestOf(LIGHT_TEMPLATE, output)).toEqual({ value: 'dim', confidence: 0.7 });
  });

  it('settles a tie in declaration order, so the same scores give the same map', () => {
    const output = outputFor(LIGHT_TEMPLATE, { dark: 0.4, dim: 0.4, bright: 0.2 });

    // `dark` is declared before `dim`. Nothing here draws a number.
    expect(bestOf(LIGHT_TEMPLATE, output).value).toBe('dark');
  });
});

describe('reading the closed fields', () => {
  it('reads the kind of place', () => {
    expect(readBuilding(outputFor(BUILDING_TEMPLATE, CERTAIN_BUILDING))).toBe('tavern');
    expect(readRoom('tavern', outputFor(TAVERN_ROOMS, CERTAIN_HALL))).toBe('hall');
  });

  it('reads the light', () => {
    expect(readLight(outputFor(LIGHT_TEMPLATE, CERTAIN_DIM))).toBe('dim');
  });
});

describe('the two place choices', () => {
  it('uses the chosen building when reading its room', () => {
    expect(readRoom('dungeon', outputFor(DUNGEON_ROOMS, CERTAIN_HALL))).toBe('hall');
  });

  it('limits local room labels to the selected building matrix', () => {
    // The whole table is swapped and put back, rather than one key deleted and
    // written again. Deleting and reassigning restores the *contents* but not
    // the *order* — `storeroom` would come back after `crypt` — and the labels
    // this front hands the classifier are `Object.values` of that order, so the
    // next test in the file would compare two correct lists that disagree.
    const rooms = BUILDINGS.dungeon.rooms;
    BUILDINGS.dungeon.rooms = { hall: rooms.hall, room: rooms.room, crypt: rooms.crypt };
    try {
      expect(Object.keys(roomTemplateFor('dungeon').labels)).toEqual(['hall', 'room', 'crypt']);
    } finally {
      BUILDINGS.dungeon.rooms = rooms;
    }
  });

  it('refuses to ask about a room it has no label for', () => {
    // The labels are sparse now — a dungeon has a crypt and a tavern does not —
    // so the pairing is a throw rather than a type. Left unchecked, the missing
    // room's hypothesis is built by substituting `undefined` into the template,
    // the classifier scores `"O cômodo é undefined."` like any other premise,
    // and it can win: `bestOf` always returns a room and never a refusal.
    //
    // **The room that used to reach this guard cannot any more.** The labels
    // used to be a table of their own in `templates.ts`; a room added to
    // `BUILDINGS` and forgotten there compiled, and this test used to be
    // written as exactly that — a stray room with a real filling behind it. The
    // label now lives on the filling, so the only room without one is a filling
    // carrying no `words` at all, which the type forbids and the cast below is
    // the measure of.
    const rooms = BUILDINGS.dungeon.rooms;
    const stray = 'bunkhouse' as RoomKind;
    const wordless = { ...rooms.hall!, words: undefined } as unknown as typeof rooms.hall;
    BUILDINGS.dungeon.rooms = { ...rooms, [stray]: wordless };
    try {
      expect(() => roomTemplateFor('dungeon')).toThrow("no room label for 'dungeon_bunkhouse'");
    } finally {
      BUILDINGS.dungeon.rooms = rooms;
    }
  });
});

describe('reading a size hint, or none', () => {
  it('gives no hint when the three sizes come back near a tie', () => {
    // What a description that never mentioned a size looks like.
    expect(readSizeHint(outputFor(SIZE_HINT_TEMPLATE, NO_SIZE_MENTIONED))).toBeUndefined();
  });

  it('gives the hint when the classifier is confident', () => {
    expect(readSizeHint(outputFor(SIZE_HINT_TEMPLATE, { small: 0.82, medium: 0.12, large: 0.06 }))).toBe(
      'small',
    );
  });

  it('takes a score exactly on the threshold as confident enough', () => {
    const at = SIZE_HINT_TEMPLATE.minConfidence;
    const rest = (1 - at) / 2;

    expect(readSizeHint(outputFor(SIZE_HINT_TEMPLATE, { small: rest, medium: rest, large: at }))).toBe(
      'large',
    );
  });

  it('gives no hint a hair below the threshold', () => {
    const just = SIZE_HINT_TEMPLATE.minConfidence - 0.001;

    expect(
      readSizeHint(outputFor(SIZE_HINT_TEMPLATE, { small: just, medium: 0.3, large: 0.2 })),
    ).toBeUndefined();
  });
});

describe('reading which features are there', () => {
  it('keeps every feature at or above the threshold', () => {
    const scores: Record<Feature, number> = {
      ...NO_FEATURES,
      bar: 0.9,
      hearth: FEATURE_TEMPLATE.minConfidence,
      stairs: 0.88,
    };

    expect(readFeatures(outputFor(FEATURE_TEMPLATE, scores))).toEqual(['bar', 'hearth', 'stairs']);
  });

  it('returns them in vocabulary order, not in score order', () => {
    // `bunks` is last in the vocabulary and highest here. Score order would put
    // it first, and `resolve` drops features past the floor's budget from the
    // end — so score order would make which feature survives depend on a
    // hundredth of a point.
    const scores: Record<Feature, number> = { ...NO_FEATURES, bunks: 0.99, bar: 0.6 };
    const kept = readFeatures(outputFor(FEATURE_TEMPLATE, scores));

    expect(kept).toEqual(['bar', 'bunks']);
    expect(kept.map((feature) => FEATURES.indexOf(feature))).toEqual([0, 6]);
  });

  it('keeps none when nothing clears the threshold', () => {
    expect(readFeatures(outputFor(FEATURE_TEMPLATE, NO_FEATURES))).toEqual([]);
  });

  it('drops a feature a hair below the threshold', () => {
    const scores: Record<Feature, number> = {
      ...NO_FEATURES,
      bar: FEATURE_TEMPLATE.minConfidence - 0.001,
    };

    expect(readFeatures(outputFor(FEATURE_TEMPLATE, scores))).toEqual([]);
  });
});

describe('deriving clutter from the condition distribution', () => {
  it('lands on the figure for a condition the classifier is certain of', () => {
    expect(deriveClutter({ tidy: 1, lived_in: 0, disordered: 0, ruined: 0 })).toBe(
      CLUTTER_BY_CONDITION.tidy,
    );
    expect(deriveClutter({ tidy: 0, lived_in: 0, disordered: 0, ruined: 1 })).toBe(
      CLUTTER_BY_CONDITION.ruined,
    );
  });

  it('gives each certain condition the figure the bench measured', () => {
    // The four written out, rather than read back from the table they came
    // from: asking the classifier about `clutter` directly topped out at 63%
    // agreement, and these four numbers are what matches that for free. A
    // reading back from `CLUTTER_BY_CONDITION` would agree with any four.
    expect(deriveClutter({ tidy: 1, lived_in: 0, disordered: 0, ruined: 0 })).toBe(0.1);
    expect(deriveClutter({ tidy: 0, lived_in: 1, disordered: 0, ruined: 0 })).toBe(0.35);
    expect(deriveClutter({ tidy: 0, lived_in: 0, disordered: 1, ruined: 0 })).toBe(0.6);
    expect(deriveClutter({ tidy: 0, lived_in: 0, disordered: 0, ruined: 1 })).toBe(0.85);
  });

  it('lands between two figures when the classifier is split between them', () => {
    const between = deriveClutter({ tidy: 0, lived_in: 0, disordered: 0.5, ruined: 0.5 });

    expect(between).toBeGreaterThan(CLUTTER_BY_CONDITION.disordered);
    expect(between).toBeLessThan(CLUTTER_BY_CONDITION.ruined);
  });

  it('uses the whole distribution, not only the winner', () => {
    // Same winner, different runners-up. A lookup on the winning condition
    // alone would give these two the same number.
    const leaningTidy = deriveClutter({ tidy: 0.4, lived_in: 0.1, disordered: 0.5, ruined: 0 });
    const leaningRuined = deriveClutter({ tidy: 0, lived_in: 0.1, disordered: 0.5, ruined: 0.4 });

    expect(leaningTidy).toBeLessThan(leaningRuined);
  });

  it('keeps three decimal places, so the same scores give the same number', () => {
    // The unrounded average here is 0.35050000000000003, and it is the tail
    // that decides: scaled up it is 350.50000000000006, strictly above 350.5,
    // so `Math.round` sends it to 351 with no tie for half-up to break. Which
    // is the whole reason this is worth a test — a third decimal place chosen
    // by the last bits of a sum of four products is a `clutter` nobody could
    // predict from the scores, so it gets written down rather than reasoned
    // about. (An earlier version of this comment credited half-up. There is no
    // tie here; on the exact decimal 0.3505 there would be, and that is a case
    // this sum cannot produce.)
    expect(deriveClutter({ tidy: 0.333, lived_in: 0.333, disordered: 0.333, ruined: 0.001 })).toBe(
      0.351,
    );
  });
});

describe('assembling the constraints', () => {
  const parts = {
    place: { building: 'tavern', room: 'hall' },
    sizeHint: undefined,
    light: 'dim',
    condition: 'disordered',
    clutter: 0.6,
    furnishing: 0.4,
    features: ['bar'],
  } as const;

  it('leaves the size hint off the object entirely when there is none', () => {
    const constraints = constraintsFrom(parts);

    expect('sizeHint' in constraints).toBe(false);
  });

  it('carries the size hint when there is one', () => {
    expect(constraintsFrom({ ...parts, sizeHint: 'large' }).sizeHint).toBe('large');
  });

  it('reports nothing as unresolved, because a classifier cannot notice one', () => {
    expect(constraintsFrom(parts).unresolved).toEqual([]);
  });

  it('reports nothing as excluded, whatever the parts say', () => {
    // Measured, not a stance: on this model a feature the description denies
    // and one it never mentions score the same (see this front's `interpret.ts`
    // header). `ClassifiedParts` has no `excluded` to carry, and the empty list
    // has to survive every shape of parts rather than only the furnished one —
    // an engine that guessed a refusal whenever it found no features would be
    // wrong most often on exactly the descriptions that name nothing.
    for (const features of [[], ['bar'], ['bar', 'hearth', 'stairs']] as const) {
      expect(constraintsFrom({ ...parts, features }).excluded).toEqual([]);
    }
  });

  it('refuses a clutter above one instead of handing it to the generator', () => {
    // Only reachable from a classifier whose scores are not a distribution, and
    // the schema is the only thing between that and a map generated from it.
    expect(() => constraintsFrom({ ...parts, clutter: 1.4 })).toThrow(ClassificationFailedError);
  });

  it('refuses a clutter below zero', () => {
    expect(() => constraintsFrom({ ...parts, clutter: -0.2 })).toThrow(/clutter/);
  });

  it('refuses a kind of place outside the vocabulary', () => {
    const broken = { ...parts, place: { building: 'tavern' as Building, room: 'throne_room' as RoomKind } };

    expect(() => constraintsFrom(broken)).toThrow(/place/);
  });
});

// --- The seven questions -----------------------------------------------------

type Ask = { text: string; labels: readonly string[]; options: ZeroShotOptions };

type Answers = {
  building?: Record<Building, number>;
  room?: Record<RoomKind, number>;
  light?: Record<Light, number>;
  condition?: Record<Condition, number>;
  size?: Record<'small' | 'medium' | 'large', number>;
  furnishing?: Record<FurnishingLevel, number>;
  features?: Record<Feature, number>;
};

/** A classifier that answers by hypothesis, and remembers what it was asked. */
function stubPipeline(answers: Answers = {}): { pipeline: ZeroShotPipeline; asks: Ask[] } {
  const asks: Ask[] = [];
  const pipeline: ZeroShotPipeline = (text, labels, options) => {
    asks.push({ text, labels, options });
    switch (options.hypothesisTemplate) {
      case BUILDING_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(BUILDING_TEMPLATE, answers.building ?? CERTAIN_BUILDING));
      case ROOM_TEMPLATES.tavern.hypothesis:
        return Promise.resolve(outputFor(
          labels.includes('cela da masmorra') ? DUNGEON_ROOMS : TAVERN_ROOMS,
          answers.room ?? CERTAIN_HALL,
        ));
      case LIGHT_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(LIGHT_TEMPLATE, answers.light ?? CERTAIN_DIM));
      case CONDITION_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(CONDITION_TEMPLATE, answers.condition ?? CERTAIN_DISORDER));
      case FURNISHING_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(FURNISHING_TEMPLATE, answers.furnishing ?? HALF_FURNISHED));
      case SIZE_HINT_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(SIZE_HINT_TEMPLATE, answers.size ?? NO_SIZE_MENTIONED));
      case FEATURE_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(FEATURE_TEMPLATE, answers.features ?? NO_FEATURES));
      default:
        throw new Error(`nothing answers "${options.hypothesisTemplate}"`);
    }
  };
  return { pipeline, asks };
}

describe('classifying a whole description', () => {
  it('chooses dungeon before asking for a room and validates the pair', async () => {
    const { pipeline, asks } = stubPipeline({
      building: { tavern: 0.1, dungeon: 0.9, forge: 0, temple: 0 },
      room: { hall: 0.1, room: 0.8, storeroom: 0.1, crypt: 0, smithy: 0 },
    });
    const result = await classify('uma cela de pedra com um catre', pipeline);
    expect(result.place).toEqual({ building: 'dungeon', room: 'room' });
    expect(asks[1].labels).toEqual(Object.values(DUNGEON_ROOMS.labels));
    expect(result.unresolved).toEqual([]);
  });
  it('produces the constraints the scores describe', async () => {
    const { pipeline } = stubPipeline({
      features: { ...NO_FEATURES, bar: 0.91, hearth: 0.77 },
    });

    await expect(classify('um salão de taverna, luz baixa, móveis derrubados', pipeline)).resolves.toEqual({
      place: { building: 'tavern', room: 'hall' },
      light: 'dim',
      condition: 'disordered',
      clutter: deriveClutter(CERTAIN_DISORDER),
      furnishing: deriveFurnishing(HALF_FURNISHED),
      features: ['bar', 'hearth'],
      excluded: [],
      unresolved: [],
    });
  });

  it('asks one question per field, and only the feature one independently', async () => {
    const { pipeline, asks } = stubPipeline();

    await classify('um depósito de taverna', pipeline);

    expect(asks.map((ask) => ask.options.hypothesisTemplate)).toEqual([
      BUILDING_TEMPLATE.hypothesis,
      ROOM_TEMPLATES.tavern.hypothesis,
      LIGHT_TEMPLATE.hypothesis,
      CONDITION_TEMPLATE.hypothesis,
      FURNISHING_TEMPLATE.hypothesis,
      SIZE_HINT_TEMPLATE.hypothesis,
      FEATURE_TEMPLATE.hypothesis,
    ]);
    expect(asks.map((ask) => ask.options.multiLabel)).toEqual([
      false, false, false, false, false, false, true,
    ]);
  });

  it('asks about every label of the template it is asking for', async () => {
    const { pipeline, asks } = stubPipeline();

    await classify('um quarto de taverna', pipeline);

    expect(asks[0].labels).toEqual(labelsOf(BUILDING_TEMPLATE));
    expect(asks[1].labels).toEqual(labelsOf(TAVERN_ROOMS));
    expect(asks[4].labels).toEqual(labelsOf(FURNISHING_TEMPLATE));
    expect(asks[6].labels).toEqual(labelsOf(FEATURE_TEMPLATE));
    expect(asks[6].labels).toHaveLength(FEATURES.length);
  });

  it('passes a description with no synonym in it through exactly as typed', async () => {
    const { pipeline, asks } = stubPipeline();
    // Capitals, an accent and the spacing the person left: the premise of an
    // entailment pair is the sentence, not a cleaned-up version of it, and
    // anything this layer did to it would be a difference from the LLM path
    // that nobody asked for. An all-lowercase description would not notice.
    const description = 'Um Quarto de Taverna  PEQUENO e bagunçado!';

    await classify(description, pipeline);

    expect(new Set(asks.map((ask) => ask.text))).toEqual(new Set([description]));
  });

  it('asks about the rewritten premise when the description uses a synonym', async () => {
    const { pipeline, asks } = stubPipeline();

    await classify('Um porão de taverna com dois balcões', pipeline);

    // Written out rather than computed from `normalizeForClassifier`, so that a
    // rewrite that stopped happening cannot make this test agree with it. This
    // sentence has now been rewritten twice for that reason: it carried "fogo"
    // and then "fogueira", and both were measured out of `SYNONYM_RULES`. Two
    // rules from two different families, so it still shows a whole premise
    // being rebuilt rather than one word being swapped.
    expect(new Set(asks.map((ask) => ask.text))).toEqual(
      new Set(['Um depósito de taverna com dois balcão']),
    );
  });

  it('gives all seven questions one premise, so the answers are about one sentence', async () => {
    const { pipeline, asks } = stubPipeline();

    await classify('adega com prateleira e escadas', pipeline);

    expect(asks).toHaveLength(7);
    expect(new Set(asks.map((ask) => ask.text)).size).toBe(1);
    expect(asks[0].text).toBe('depósito com prateleiras e escada');
  });

  it('takes the size hint from the size question and no other', async () => {
    const { pipeline } = stubPipeline({ size: { small: 0.9, medium: 0.07, large: 0.03 } });

    await expect(classify('um quarto pequeno', pipeline)).resolves.toMatchObject({ sizeHint: 'small' });
  });

  it('derives clutter from the condition spread rather than from the winner', async () => {
    const spread: Record<Condition, number> = {
      tidy: 0,
      lived_in: 0.1,
      disordered: 0.45,
      ruined: 0.45,
    };
    const { pipeline } = stubPipeline({ condition: spread });

    const constraints = await classify('uma taverna em ruínas', pipeline);

    expect(constraints.condition).toBe('disordered');
    expect(constraints.clutter).toBe(deriveClutter(spread));
    expect(constraints.clutter).toBeGreaterThan(CLUTTER_BY_CONDITION.disordered);
  });

  it('refuses scores that are not a distribution instead of clamping them', async () => {
    // Every condition at one: not a softmax, so the model or the build is
    // broken. The weighted average comes out at 1.9 and the schema refuses it.
    const { pipeline } = stubPipeline({
      condition: { tidy: 1, lived_in: 1, disordered: 1, ruined: 1 },
    });

    await expect(classify('um salão', pipeline)).rejects.toThrow(ClassificationFailedError);
  });

  it('reports a classifier that answered about something else', async () => {
    const pipeline: ZeroShotPipeline = () =>
      Promise.resolve({ labels: ['uma catedral'], scores: [1] });

    await expect(classify('um salão', pipeline)).rejects.toThrow(/nobody asked about/);
  });
});

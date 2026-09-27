import { describe, expect, it } from 'vitest';

import type { Condition, Light, PlaceType } from '../../core/types';
import { FEATURES } from '../vocabulary';
import type { Feature } from '../vocabulary';

import { ClassificationFailedError } from './errors';
import {
  bestOf,
  classify,
  constraintsFrom,
  deriveClutter,
  labelsOf,
  readFeatures,
  readLight,
  readPlaceType,
  readSizeHint,
  scoresByValue,
} from './interpret';
import type { ZeroShotOptions, ZeroShotOutput, ZeroShotPipeline } from './pipeline';
import {
  CLUTTER_BY_CONDITION,
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
} from './templates';
import type { ChoiceTemplate } from './templates';

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

const CERTAIN_HALL: Record<PlaceType, number> = {
  tavern_hall: 0.9,
  tavern_room: 0.07,
  tavern_storeroom: 0.03,
};
const CERTAIN_DIM: Record<Light, number> = { dark: 0.2, dim: 0.7, bright: 0.1 };
const CERTAIN_DISORDER: Record<Condition, number> = {
  tidy: 0.02,
  lived_in: 0.08,
  disordered: 0.8,
  ruined: 0.1,
};
const NO_SIZE_MENTIONED = { small: 0.34, medium: 0.33, large: 0.33 };
const NO_FEATURES: Record<Feature, number> = {
  bar: 0.1,
  hearth: 0.1,
  stairs: 0.1,
  pillars: 0.1,
  alcove: 0.1,
  shelving: 0.1,
  bunks: 0.1,
};

describe('reading scores back by label', () => {
  it('finds each value however the pipeline ordered its answer', () => {
    // The answer comes back sorted by score, so `tavern_hall` is first in the
    // arrays and third in the template. Reading by position would swap them.
    expect(scoresByValue(PLACE_TYPE_TEMPLATE, outputFor(PLACE_TYPE_TEMPLATE, CERTAIN_HALL))).toEqual(
      CERTAIN_HALL,
    );
  });

  it('refuses a label nobody asked about', () => {
    const output: ZeroShotOutput = { labels: ['um trono de obsidiana'], scores: [0.99] };

    expect(() => scoresByValue(PLACE_TYPE_TEMPLATE, output)).toThrow(ClassificationFailedError);
  });

  it('refuses the same label scored twice', () => {
    const label = PLACE_TYPE_TEMPLATE.labels.tavern_hall;
    const output: ZeroShotOutput = { labels: [label, label], scores: [0.9, 0.1] };

    expect(() => scoresByValue(PLACE_TYPE_TEMPLATE, output)).toThrow(/twice/);
  });

  it('refuses an answer that left one of the values unscored', () => {
    const output: ZeroShotOutput = {
      labels: [PLACE_TYPE_TEMPLATE.labels.tavern_hall, PLACE_TYPE_TEMPLATE.labels.tavern_room],
      scores: [0.6, 0.4],
    };

    expect(() => scoresByValue(PLACE_TYPE_TEMPLATE, output)).toThrow(/tavern_storeroom/);
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
    expect(readPlaceType(outputFor(PLACE_TYPE_TEMPLATE, CERTAIN_HALL))).toBe('tavern_hall');
  });

  it('reads the light', () => {
    expect(readLight(outputFor(LIGHT_TEMPLATE, CERTAIN_DIM))).toBe('dim');
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
    // The unrounded average here is 0.35050000000000003 — a tail that would
    // make the same description give a different `clutter` on a machine that
    // adds the four products in another order.
    expect(deriveClutter({ tidy: 0.333, lived_in: 0.333, disordered: 0.333, ruined: 0.001 })).toBe(
      0.351,
    );
  });
});

describe('assembling the constraints', () => {
  const parts = {
    placeType: 'tavern_hall',
    sizeHint: undefined,
    light: 'dim',
    condition: 'disordered',
    clutter: 0.6,
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

  it('refuses a clutter above one instead of handing it to the generator', () => {
    // Only reachable from a classifier whose scores are not a distribution, and
    // the schema is the only thing between that and a map generated from it.
    expect(() => constraintsFrom({ ...parts, clutter: 1.4 })).toThrow(ClassificationFailedError);
  });

  it('refuses a clutter below zero', () => {
    expect(() => constraintsFrom({ ...parts, clutter: -0.2 })).toThrow(/clutter/);
  });

  it('refuses a kind of place outside the vocabulary', () => {
    const broken = { ...parts, placeType: 'throne_room' as PlaceType };

    expect(() => constraintsFrom(broken)).toThrow(/placeType/);
  });
});

// --- The five questions ------------------------------------------------------

type Ask = { text: string; labels: readonly string[]; options: ZeroShotOptions };

type Answers = {
  placeType?: Record<PlaceType, number>;
  light?: Record<Light, number>;
  condition?: Record<Condition, number>;
  size?: Record<'small' | 'medium' | 'large', number>;
  features?: Record<Feature, number>;
};

/** A classifier that answers by hypothesis, and remembers what it was asked. */
function stubPipeline(answers: Answers = {}): { pipeline: ZeroShotPipeline; asks: Ask[] } {
  const asks: Ask[] = [];
  const pipeline: ZeroShotPipeline = (text, labels, options) => {
    asks.push({ text, labels, options });
    switch (options.hypothesisTemplate) {
      case PLACE_TYPE_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(PLACE_TYPE_TEMPLATE, answers.placeType ?? CERTAIN_HALL));
      case LIGHT_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(LIGHT_TEMPLATE, answers.light ?? CERTAIN_DIM));
      case CONDITION_TEMPLATE.hypothesis:
        return Promise.resolve(outputFor(CONDITION_TEMPLATE, answers.condition ?? CERTAIN_DISORDER));
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
  it('produces the constraints the scores describe', async () => {
    const { pipeline } = stubPipeline({
      features: { ...NO_FEATURES, bar: 0.91, hearth: 0.77 },
    });

    await expect(classify('um salão de taverna, luz baixa, móveis derrubados', pipeline)).resolves.toEqual({
      placeType: 'tavern_hall',
      light: 'dim',
      condition: 'disordered',
      clutter: deriveClutter(CERTAIN_DISORDER),
      features: ['bar', 'hearth'],
      unresolved: [],
    });
  });

  it('asks one question per field, and only the feature one independently', async () => {
    const { pipeline, asks } = stubPipeline();

    await classify('um depósito de taverna', pipeline);

    expect(asks.map((ask) => ask.options.hypothesisTemplate)).toEqual([
      PLACE_TYPE_TEMPLATE.hypothesis,
      LIGHT_TEMPLATE.hypothesis,
      CONDITION_TEMPLATE.hypothesis,
      SIZE_HINT_TEMPLATE.hypothesis,
      FEATURE_TEMPLATE.hypothesis,
    ]);
    expect(asks.map((ask) => ask.options.multiLabel)).toEqual([false, false, false, false, true]);
  });

  it('asks about every label of the template it is asking for', async () => {
    const { pipeline, asks } = stubPipeline();

    await classify('um quarto de taverna', pipeline);

    expect(asks[0].labels).toEqual(labelsOf(PLACE_TYPE_TEMPLATE));
    expect(asks[4].labels).toEqual(labelsOf(FEATURE_TEMPLATE));
    expect(asks[4].labels).toHaveLength(FEATURES.length);
  });

  it('passes the description through exactly as it was typed', async () => {
    const { pipeline, asks } = stubPipeline();
    // Capitals, an accent and the spacing the person left: the premise of an
    // entailment pair is the sentence, not a cleaned-up version of it, and
    // anything this layer did to it would be a difference from the LLM path
    // that nobody asked for. An all-lowercase description would not notice.
    const description = 'Um Quarto de Taverna  PEQUENO e bagunçado!';

    await classify(description, pipeline);

    expect(new Set(asks.map((ask) => ask.text))).toEqual(new Set([description]));
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

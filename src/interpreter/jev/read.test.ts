import { describe, expect, it } from 'vitest';
import type { Place } from '../../core/types';

import { CLUTTER_BY_CONDITION } from '../local/templates';

import { JevUnusableAnswerError } from './errors';
import {
  CONDITION_LEVELS,
  EXCLUSION_THRESHOLD,
  FEATURE_THRESHOLD,
  FURNISHING_TOP,
  OUT_OF_VOCABULARY_THRESHOLD,
  QUESTIONS,
  SIZE_MIN_CONFIDENCE,
} from './questions';
import { clutterFromScore, furnishingFromScore, readBuildingAnswers, readRoomAnswers } from './read';

/**
 * Every response in this file is JSON **text**, typed out by hand and parsed
 * with `JSON.parse`. None of it is assembled from `QUESTIONS`, from the answer
 * schemas, or from anything else the reader uses.
 *
 * That rule is the whole point. A fake built out of the code under test makes
 * these tests assert that the reader agrees with itself: the twelve question
 * names, the `type` tags and the field names would all come from one side, and
 * renaming a question would stay green because both sides moved together. The
 * names below are the wire format, written once, and they are the thing being
 * pinned.
 *
 * The figures are `p01` of the canonical ruler — `O salão principal da taverna,
 * com mesas compridas e um balcão de carvalho.` — as the bench recorded them in
 * `raw.json`: the old place choice at confidence 1.000, `out_of_vocabulary` 0.02, a
 * `condition` score of 0.71, and the seven feature nouls it had. **The bench did not
 * store the `light` and `size` scores or any of the score confidences**, so
 * those four numbers are written here to exercise the reader and are not
 * measurements. The building and room replies below are adapted to the new
 * two-call protocol and were not measured in that bench.
 */

type Figures = {
  place: Place;
  placeConfidence: number;
  oov: number;
  /** Not measured: the bench kept the level, not the score. `dim` is index 1. */
  lightScore: number;
  /** Not measured. */
  lightConfidence: number;
  conditionScore: number;
  /** Not measured. */
  conditionConfidence: number;
  /** Not measured. */
  sizeScore: number;
  /** Not measured: `p01` came back without a `sizeHint`, so it was under the gate. */
  sizeConfidence: number;
  /** Not measured: the question did not exist when this bench ran. */
  furnishingScore: number;
  /** Not measured. */
  furnishingConfidence: number;
  bar: number;
  hearth: number;
  stairs: number;
  pillars: number;
  alcove: number;
  shelving: number;
  bunks: number;
  /**
   * The three admitted later, and measured on the **same sentence** in a
   * later session rather than by the bench that wrote the seven above. The
   * sweep is `arnes/registro-noul.csv` in the vocabulary front's directory,
   * outside this repository beside the rulers. Its readings of the seven agree
   * with the bench's to within 0.02 — 0.99 against 0.98 for `bar`, 0.29 against
   * 0.31 for `shelving` — which is the repeatability the exclusion corpus
   * documents, so these three are of a piece with them and not with the
   * unmeasured scores above.
   */
  bed: number;
  weapons: number;
  tomb: number;
};

const P01: Figures = {
  place: { building: 'tavern', room: 'hall' },
  placeConfidence: 1,
  oov: 0.02,
  lightScore: 1.1,
  lightConfidence: 0.78,
  conditionScore: 0.71,
  conditionConfidence: 0.64,
  sizeScore: 1.4,
  sizeConfidence: 0.41,
  furnishingScore: 2,
  furnishingConfidence: 0.7,
  bar: 0.98,
  hearth: 0.26,
  stairs: 0.15,
  pillars: 0.28,
  alcove: 0.13,
  shelving: 0.31,
  bunks: 0.06,
  bed: 0.06,
  weapons: 0.15,
  tomb: 0.04,
};

/** A whole response body, in the shape the proxy relays it. */
function responseText(figures: Partial<Figures> = {}): string {
  const f = { ...P01, ...figures };
  return `{
  "model": "jev-1.13.0",
  "test_room": "${f.place.room}",
  "answers": {
    "building": {
      "type": "choice",
      "choice": "${f.place.building}",
      "probabilities": { "tavern": 1, "dungeon": 0 },
      "confidence": ${String(f.placeConfidence)}
    },
    "out_of_vocabulary": { "type": "noul", "noul": ${String(f.oov)} },
    "light": {
      "type": "score",
      "score": ${String(f.lightScore)},
      "legend": { "0": "Escuridão total", "1": "Luz fraca", "2": "Muita luz" },
      "probabilities": { "0": 0.05, "1": 0.85, "2": 0.1 },
      "confidence": ${String(f.lightConfidence)}
    },
    "condition": {
      "type": "score",
      "score": ${String(f.conditionScore)},
      "legend": { "0": "Limpo", "1": "Usado", "2": "Bagunçado", "3": "Em ruínas" },
      "probabilities": { "0": 0.3, "1": 0.68, "2": 0.02, "3": 0 },
      "confidence": ${String(f.conditionConfidence)}
    },
    "size": {
      "type": "score",
      "score": ${String(f.sizeScore)},
      "legend": { "0": "Pequeno", "1": "Médio", "2": "Grande" },
      "probabilities": { "0": 0.2, "1": 0.4, "2": 0.4 },
      "confidence": ${String(f.sizeConfidence)}
    },
    "furnishing": {
      "type": "score",
      "score": ${String(f.furnishingScore)},
      "legend": { "0": "Nenhuma", "1": "Pouca", "2": "Mobiliado", "3": "Abarrotado" },
      "probabilities": { "0": 0.05, "1": 0.15, "2": 0.6, "3": 0.2 },
      "confidence": ${String(f.furnishingConfidence)}
    },
    "feature_bar": { "type": "noul", "noul": ${String(f.bar)} },
    "feature_hearth": { "type": "noul", "noul": ${String(f.hearth)} },
    "feature_stairs": { "type": "noul", "noul": ${String(f.stairs)} },
    "feature_pillars": { "type": "noul", "noul": ${String(f.pillars)} },
    "feature_alcove": { "type": "noul", "noul": ${String(f.alcove)} },
    "feature_shelving": { "type": "noul", "noul": ${String(f.shelving)} },
    "feature_bunks": { "type": "noul", "noul": ${String(f.bunks)} },
    "feature_bed": { "type": "noul", "noul": ${String(f.bed)} },
    "feature_weapons": { "type": "noul", "noul": ${String(f.weapons)} },
    "feature_tomb": { "type": "noul", "noul": ${String(f.tomb)} }
  },
  "usage": { "input_tokens": 307, "output_tokens": 72 }
}`;
}

/** The body of `responseText`, parsed the way the interpreter parses it. */
function response(figures: Partial<Figures> = {}): unknown {
  return JSON.parse(responseText(figures));
}

function readAnswers(body: unknown) {
  const first = readBuildingAnswers(body);
  const room = (body as { test_room: string }).test_room;
  return readRoomAnswers({ answers: { room: { type: 'choice', choice: room, confidence: 0.9 } } }, first);
}

describe('a measured answer, read', () => {
  it('reads p01 of the ruler the way the bench read it', () => {
    // Written out rather than compared field by field: the absent `sizeHint`
    // is part of the claim, and `toEqual` against a literal is what asserts
    // that nothing else appeared either.
    const constraints = readAnswers(response());

    expect(constraints.place).toEqual({ building: 'tavern', room: 'hall' });
    expect(constraints.light).toBe('dim');
    expect(constraints.condition).toBe('lived_in');
    expect(constraints.features).toEqual(['bar']);
    expect(constraints.unresolved).toEqual([]);
    expect(constraints.clutter).toBeCloseTo(0.2775, 12);
    expect(Object.hasOwn(constraints, 'sizeHint')).toBe(false);
  });

  it('carries the raw JSON of the wire format, not an object this file built', () => {
    // Half of the fixture's honesty is that it is text. If this ever stops
    // being a string, the rule at the top of the file has been broken.
    expect(typeof responseText()).toBe('string');
    expect(responseText()).toContain('"type": "noul"');
    expect(responseText()).toContain('"feature_shelving"');
  });
});

describe('clutter, out of the continuous condition score', () => {
  it('reproduces CLUTTER_BY_CONDITION exactly at the four integers', () => {
    // Against the table itself, not against a copy of its four numbers: a
    // copy would go on agreeing after the table changed.
    CONDITION_LEVELS.forEach((level, index) => {
      expect(clutterFromScore(index)).toBe(CLUTTER_BY_CONDITION[level]);
    });
  });

  it('fills in between them, which is what the old table could not', () => {
    expect(clutterFromScore(0.5)).toBeCloseTo(0.225, 12);
    expect(clutterFromScore(1.5)).toBeCloseTo(0.475, 12);
    expect(clutterFromScore(2.5)).toBeCloseTo(0.725, 12);
    // Strictly between the two table entries it sits between — the property
    // the weighted average was faking.
    expect(clutterFromScore(1.5)).toBeGreaterThan(CLUTTER_BY_CONDITION.lived_in);
    expect(clutterFromScore(1.5)).toBeLessThan(CLUTTER_BY_CONDITION.disordered);
  });

  it('reaches Constraints.clutter, not the figure of the winning level', () => {
    const constraints = readAnswers(response({ conditionScore: 2.4 }));

    expect(constraints.condition).toBe('disordered');
    expect(constraints.clutter).toBeCloseTo(0.7, 12);
    expect(constraints.clutter).not.toBe(CLUTTER_BY_CONDITION.disordered);
  });
});

describe('which level a score lands on', () => {
  it('rounds to the nearest, at every boundary of every scale', () => {
    expect(readAnswers(response({ lightScore: 0.49 })).light).toBe('dark');
    expect(readAnswers(response({ lightScore: 0.5 })).light).toBe('dim');
    expect(readAnswers(response({ lightScore: 1.49 })).light).toBe('dim');
    expect(readAnswers(response({ lightScore: 1.5 })).light).toBe('bright');
    expect(readAnswers(response({ conditionScore: 2.5 })).condition).toBe('ruined');
    expect(readAnswers(response({ conditionScore: 2.49 })).condition).toBe('disordered');
  });

  it('refuses a score outside the levels it was asked about, rather than clamping', () => {
    // Clamping is what would turn a broken response into a plausible map.
    expect(() => readAnswers(response({ conditionScore: 3.2 }))).toThrow(JevUnusableAnswerError);
    expect(() => readAnswers(response({ lightScore: -0.1 }))).toThrow(JevUnusableAnswerError);
    expect(() => readAnswers(response({ conditionScore: 3.2 }))).toThrow(/condition/);
    expect(() => readAnswers(response({ conditionScore: 3 }))).not.toThrow();
    expect(() => readAnswers(response({ lightScore: 2 }))).not.toThrow();
  });
});

describe('the size hint, and the gate it falls through', () => {
  it('is dropped below the gate and kept at it', () => {
    expect(SIZE_MIN_CONFIDENCE).toBe(0.55);

    const under = readAnswers(response({ sizeScore: 2, sizeConfidence: 0.54 }));
    const at = readAnswers(response({ sizeScore: 2, sizeConfidence: 0.55 }));

    expect(Object.hasOwn(under, 'sizeHint')).toBe(false);
    expect(at.sizeHint).toBe('large');
  });

  it('reads the level off the score once it is through', () => {
    expect(readAnswers(response({ sizeScore: 0.2, sizeConfidence: 0.9 })).sizeHint).toBe('small');
    expect(readAnswers(response({ sizeScore: 1, sizeConfidence: 0.9 })).sizeHint).toBe('medium');
  });
});

describe('which features are built', () => {
  it('takes them at the threshold and leaves them below it', () => {
    expect(FEATURE_THRESHOLD).toBe(0.62);

    const under = readAnswers(response({ hearth: 0.61, stairs: 0.61 }));
    const at = readAnswers(response({ hearth: 0.62, stairs: 0.62 }));

    expect(under.features).toEqual(['bar']);
    expect(at.features).toEqual(['bar', 'hearth', 'stairs']);
  });

  it('leaves out what the old threshold of 0.5 would have built', () => {
    // The measured change, pinned: 0.5 is `FEATURE_TEMPLATE.minConfidence` and
    // scored F1 0.952 on the 28; 0.62 scored 0.984. A reader who moves the
    // number back has to move this line too.
    const constraints = readAnswers(response({ alcove: 0.55, bunks: 0.58 }));

    expect(constraints.features).toEqual(['bar']);
  });

  it('lists them in vocabulary order, not in the order they scored', () => {
    // `resolve` drops features past the floor's budget from the end, so the
    // order decides which one survives.
    const constraints = readAnswers(response({ bar: 0.7, bunks: 0.99, hearth: 0.8 }));

    expect(constraints.features).toEqual(['bar', 'hearth', 'bunks']);
  });
});

describe('a place the vocabulary has no word for', () => {
  it('says nothing below the threshold', () => {
    expect(OUT_OF_VOCABULARY_THRESHOLD).toBe(0.75);

    expect(readAnswers(response({ oov: 0.74 })).unresolved).toEqual([]);
  });

  it('emits the code at the threshold, with the place that was built as the detail', () => {
    const constraints = readAnswers(response({ oov: 0.75, place: { building: 'tavern', room: 'room' } }));

    expect(constraints.unresolved).toEqual(['place_not_in_vocabulary:tavern_room']);
    // And the map is still of the nearest place, which is the precedent in
    // `resolve.ts:221-237`: leave it out, say so, do not refuse.
    expect(constraints.place).toEqual({ building: 'tavern', room: 'room' });
  });

  it('carries a code and never a sentence', () => {
    const [only] = readAnswers(response({ oov: 0.9 })).unresolved;

    expect(only.slice(0, only.indexOf(':'))).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(only).not.toMatch(/\s/);
  });
});

describe('an answer this layer cannot use', () => {
  it('refuses a body that is not a set of answers at all', () => {
    expect(() => readAnswers(null)).toThrow(JevUnusableAnswerError);
    expect(() => readAnswers('{}')).toThrow(JevUnusableAnswerError);
    expect(() => readAnswers({ model: 'jev-1.13.0' })).toThrow(JevUnusableAnswerError);
  });

  it('refuses an answer to a question nobody asked', () => {
    const body = JSON.parse(responseText()) as { answers: Record<string, unknown> };
    body.answers.feature_well = { type: 'noul', noul: 0.9 };

    expect(() => readAnswers(body)).toThrow(/feature_well/);
  });

  it('refuses a missing answer, naming what was expected', () => {
    const body = JSON.parse(responseText()) as { answers: Record<string, unknown> };
    delete body.answers.out_of_vocabulary;

    expect(() => readAnswers(body)).toThrow(JevUnusableAnswerError);
    expect(() => readAnswers(body)).toThrow(/out_of_vocabulary/);
  });

  it('refuses an answer of the wrong primitive, naming the question', () => {
    const body = JSON.parse(responseText()) as { answers: Record<string, unknown> };
    body.answers.building = { type: 'noul', noul: 0.9 };

    expect(() => readAnswers(body)).toThrow(/building/);
  });

  it('refuses a probability that is not one', () => {
    const body = JSON.parse(responseText()) as { answers: Record<string, unknown> };
    body.answers.feature_bar = { type: 'noul', noul: 1.4 };

    expect(() => readAnswers(body)).toThrow(/feature_bar/);
  });

  it('refuses a choice that is not in the closed vocabulary', () => {
    // Jev answers a choice with one of the keys it was handed, so this is not
    // the `throne_room` a prompted model invents — it is the proxy relaying
    // something else. `constraintsSchema` is what catches it either way, and
    // `schema.ts:10-15` is why that gate is not optional.
    expect(() => readAnswers(response({ place: { building: 'tavern', room: 'throne_room' } as unknown as Place }))).toThrow(JevUnusableAnswerError);
    expect(() => readAnswers(response({ place: { building: 'tavern', room: 'throne_room' } as unknown as Place }))).toThrow(/room/);
  });
});

describe('furnishing, off a scale of its own', () => {
  it('spans nought to one across the scale the question actually asks about', () => {
    // Against the question's own criteria rather than against a 3 written here:
    // a criterion added there without this divisor moving would silently rescale
    // every answer.
    expect(furnishingFromScore(0)).toBe(0);
    expect(furnishingFromScore(FURNISHING_TOP)).toBe(1);
    expect(FURNISHING_TOP).toBe(QUESTIONS.furnishing.criteria.length - 1);
  });

  it('fills in between the levels instead of rounding to one of four', () => {
    expect(furnishingFromScore(1.5)).toBeCloseTo(0.5, 12);
  });

  it('reaches Constraints.furnishing, and does not follow the condition', () => {
    // Defect D3, at this layer: the same answer carries a ruined condition and
    // a nearly bare floor, and both survive the reading.
    const constraints = readAnswers(response({ conditionScore: 3, furnishingScore: 0.3 }));

    expect(constraints.condition).toBe('ruined');
    expect(constraints.clutter).toBeCloseTo(0.85, 12);
    expect(constraints.furnishing).toBeCloseTo(0.1, 12);
  });

  it('refuses a furnishing score outside the scale rather than clamping it', () => {
    // The same trade the other scores make: a score out of band is an answer to
    // a different question, and clamping turns that into a plausible map.
    //
    // Asserted on the sentence `scoreOn` writes, not on the type and not on the
    // word "furnishing". `constraintsSchema` would refuse these two anyway —
    // the reading is `score / 3`, so out of band in means out of 0..1 out — and
    // both paths throw a `JevUnusableAnswerError` that names the field. A test
    // that watched either of those would go on passing with this guard deleted,
    // which is what it did until it was asked to prove otherwise. Only this
    // wording tells the reader which of the two refused, and that matters: the
    // schema is the last net, and a field that reaches it is a field this layer
    // let through.
    // Not `NaN`: the fixture is JSON text by the rule at the top of this file,
    // and `NaN` is not JSON. `scoreSchema` is what refuses a score that is not
    // a number, one step earlier.
    for (const furnishingScore of [FURNISHING_TOP + 0.1, -0.1, 99]) {
      expect(() => readAnswers(response({ furnishingScore }))).toThrow(
        /furnishing: a score of .+ is outside the 4 levels it was asked about/,
      );
    }
  });
});

describe('which features the description refused', () => {
  it('takes them at the threshold and leaves them above it', () => {
    // `<=`, not `<`: three of the twenty negations in the corpus sit exactly on
    // 0.050, and the answers are quantised to a hundredth.
    const constraints = readAnswers(
      response({ hearth: EXCLUSION_THRESHOLD, stairs: EXCLUSION_THRESHOLD + 0.01 }),
    );

    expect(constraints.excluded).toContain('hearth');
    expect(constraints.excluded).not.toContain('stairs');
  });

  it('leaves the band between the two thresholds in neither list', () => {
    // The ordinary case, and the whole reason there are two numbers: a feature
    // the description never mentioned is not asked for and not refused.
    const middling = (FEATURE_THRESHOLD + EXCLUSION_THRESHOLD) / 2;
    const constraints = readAnswers(response({ pillars: middling }));

    expect(constraints.features).not.toContain('pillars');
    expect(constraints.excluded).not.toContain('pillars');
  });

  it('lists them in vocabulary order, not in the order they scored', () => {
    // `tomb` is last in `FEATURES` and second-lowest here, so a list built in
    // score order would put it second. It is the one that makes this test
    // discriminate past the seven it was written for.
    const constraints = readAnswers(
      response({ bunks: 0.01, bar: 0.04, shelving: 0.02, hearth: 0.03, tomb: 0.02 }),
    );

    expect(constraints.excluded).toEqual(['bar', 'hearth', 'shelving', 'bunks', 'tomb']);
  });

  it('never puts the same feature in both lists', () => {
    // Impossible by construction while the two thresholds do not cross, and
    // `resolve` settles the contradiction if a hand-built `Constraints` ever
    // produces one. Asserted here so that crossing them is a red test.
    for (const noul of [0, 0.03, 0.05, 0.3, 0.62, 0.9, 1]) {
      const constraints = readAnswers(response({ stairs: noul }));
      expect(constraints.features.filter((f) => constraints.excluded.includes(f))).toEqual([]);
    }
  });
});

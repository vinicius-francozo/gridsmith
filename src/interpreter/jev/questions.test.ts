import { describe, expect, it } from 'vitest';

import type { RoomKind } from '../../core/types';
import { FEATURES } from '../vocabulary';
import { BUILDINGS } from '../../generator/profiles';

import {
  CONDITION_LEVELS,
  EXCLUSION_THRESHOLD,
  FEATURE_QUESTIONS,
  FEATURE_THRESHOLD,
  FURNISHING_TOP,
  LIGHT_LEVELS,
  OUT_OF_VOCABULARY_THRESHOLD,
  QUESTIONS,
  roomQuestionFor,
  SIZE_LEVELS,
  SIZE_MIN_CONFIDENCE,
} from './questions';

const BUILDING_KEYS = ['tavern', 'dungeon', 'forge'];
// Sorted, because the assertions below sort. One list per building, because the
// matrix of buildings against rooms is sparse: the crypt is the dungeon's, the
// forge floor is the smith's, and the shop front is a guest room's geometry
// under another name.
const TAVERN_ROOMS = ['hall', 'room', 'storeroom'];
const DUNGEON_ROOMS = ['crypt', 'hall', 'room', 'storeroom'];
const FORGE_ROOMS = ['room', 'smithy'];

describe('a score question and its levels', () => {
  it('has one level for each criterion, on all three scales', () => {
    // The index a score rounds to is an index into the level table, so a table
    // shorter than its criteria answers a question with the wrong word and a
    // longer one makes a level unreachable. Neither fails on its own.
    expect(QUESTIONS.light.criteria).toHaveLength(LIGHT_LEVELS.length);
    expect(QUESTIONS.condition.criteria).toHaveLength(CONDITION_LEVELS.length);
    expect(QUESTIONS.size.criteria).toHaveLength(SIZE_LEVELS.length);
    // `furnishing` has no level array — it is divided into a 0..1 field — so
    // what has to agree with its criteria is the divisor.
    expect(QUESTIONS.furnishing.criteria).toHaveLength(FURNISHING_TOP + 1);
  });

  it('describes each level in the order the table names them', () => {
    // Order cannot be checked mechanically — the criteria are Portuguese prose
    // — so what is pinned is the pair of ends, which is where an inverted
    // table shows up: darkest first, most ruined last.
    expect(LIGHT_LEVELS[0]).toBe('dark');
    expect(LIGHT_LEVELS[LIGHT_LEVELS.length - 1]).toBe('bright');
    expect(CONDITION_LEVELS[0]).toBe('tidy');
    expect(CONDITION_LEVELS[CONDITION_LEVELS.length - 1]).toBe('ruined');
    expect(SIZE_LEVELS[0]).toBe('small');
    expect(SIZE_LEVELS[SIZE_LEVELS.length - 1]).toBe('large');
  });
});

describe('the choice question', () => {
  it('offers the buildings first and only their rooms second', () => {
    // Jev answers a choice with one of these keys, so this is what keeps the
    // answer inside `constraintsSchema` before the schema is even reached.
    expect(Object.keys(QUESTIONS.building.criteria).sort()).toEqual([...BUILDING_KEYS].sort());
    expect(Object.keys(roomQuestionFor('tavern').room.criteria).sort()).toEqual(TAVERN_ROOMS);
    expect(Object.keys(roomQuestionFor('dungeon').room.criteria).sort()).toEqual(DUNGEON_ROOMS);
    expect(Object.keys(roomQuestionFor('forge').room.criteria).sort()).toEqual(FORGE_ROOMS);
  });

  it('removes an unavailable room from the second question', () => {
    const rooms = BUILDINGS.dungeon.rooms;
    BUILDINGS.dungeon.rooms = { hall: rooms.hall, storeroom: rooms.storeroom, crypt: rooms.crypt };
    try {
      expect(Object.keys(roomQuestionFor('dungeon').room.criteria)).toEqual(['hall', 'storeroom', 'crypt']);
    } finally {
      BUILDINGS.dungeon.rooms = rooms;
    }
  });

  it('refuses to ask about a room it has no criterion for', () => {
    // The hole this closes is quiet rather than loud. An `undefined` criterion
    // is dropped by `JSON.stringify` on the way into the request, so Jev would
    // be asked to choose between the rooms that happen to have wording and
    // would answer one of those, confidently — and `read.ts` checks the answer
    // against `roomsFor`, where the unasked room still is. The map would come
    // back a different kind of place with nothing anywhere saying so.
    //
    // **The room that used to reach this guard cannot any more, and the cast
    // below is the measure of that.** The criteria used to be a table of their
    // own in `questions.ts`; a room added to `BUILDINGS` and forgotten there
    // compiled, and this test used to be written as exactly that — a stray room
    // with a real filling behind it. The wording now lives on the filling, so
    // the only room without a criterion is one whose filling has no `words` at
    // all, which the type forbids and a hand-edited object can still be.
    const rooms = BUILDINGS.dungeon.rooms;
    const stray = 'bunkhouse' as RoomKind;
    const wordless = { ...rooms.hall!, words: undefined } as unknown as typeof rooms.hall;
    BUILDINGS.dungeon.rooms = { ...rooms, [stray]: wordless };
    try {
      expect(() => roomQuestionFor('dungeon')).toThrow("no room criterion for 'dungeon_bunkhouse'");
    } finally {
      BUILDINGS.dungeon.rooms = rooms;
    }
  });
});

describe('the feature questions', () => {
  it('has one for every word in the vocabulary, and no spare', () => {
    expect(Object.keys(FEATURE_QUESTIONS).sort()).toEqual([...FEATURES].sort());
  });

  it('points each word at a question of its own, asked as a proposition', () => {
    const names = FEATURES.map((feature) => FEATURE_QUESTIONS[feature]);

    expect(new Set(names).size).toBe(FEATURES.length);
    for (const name of names) {
      expect(QUESTIONS[name].type).toBe('noul');
    }
  });

  it('keeps the bunk named on the far side of the bed question', () => {
    // **A measurement lives in this one clause and nothing else can hold it.**
    // Asked with `'Não há cama nenhuma'` on the `false` side, `feature_bed`
    // scored the four sentences of the corpora that describe bunks at
    // 0.970–0.980 — over the presence gate, beside `feature_bunks` itself at
    // 0.980–0.990. Naming the bunk here takes those four to 0.420–0.490 and
    // leaves presence alone: the lowest of the eight sentences that do ask for
    // a bed moved 0.930 to 0.920.
    //
    // It matters because of what the generator does downstream, not because of
    // tidiness. A guest room declares `bed` and `bunks` as separate slots, and
    // `anchorOrder` puts *every* requested anchor at the front of the draw
    // without trimming to `anchorRange`, so "dois beliches" scoring both words
    // draws the guest bed as well as the bunks — the word promising one thing
    // and the catalogue handing over another.
    //
    // Seventeen requests bought this clause, and re-measuring is what it costs
    // to change it. Written out rather than tested against a live model: there
    // is no model in this suite, and a shape check ("mentions a bunk") would go
    // green on any sentence containing the word.
    expect(QUESTIONS.feature_bed.criteria.false).toBe(
      'Não há cama nenhuma, ou o que há para dormir é um beliche',
    );
    // The other side did **not** move between the two wordings, and that is
    // half of why the second one is usable: the instruction still names the
    // thing on its own, which is the rule `feature_pillars` was measured into.
    expect(QUESTIONS.feature_bed.instructions).toBe('O lugar tem uma cama?');
  });
});

describe('every question, whatever its primitive', () => {
  it('asks something, and says what each answer would mean', () => {
    for (const [name, question] of Object.entries(QUESTIONS)) {
      expect(question.instructions.trim(), name).not.toBe('');
      const criteria =
        question.type === 'score' ? question.criteria : Object.values(question.criteria);
      expect(criteria.length, name).toBeGreaterThan(1);
      for (const criterion of criteria) {
        expect(criterion.trim(), name).not.toBe('');
      }
    }
  });

  it('gives every noul both sides of the proposition', () => {
    // A noul with only the `true` side described is a leading question, and it
    // is what the bench measured ruins the feature answers.
    for (const question of Object.values(QUESTIONS)) {
      if (question.type === 'noul') {
        expect(Object.keys(question.criteria).sort()).toEqual(['false', 'true']);
      }
    }
  });
});

describe('the four thresholds', () => {
  it('are probabilities, and are the measured figures', () => {
    // Pinned here as well as where they bite, because these are the numbers a
    // future measurement moves, and the comment beside each one is the record
    // of how it was chosen.
    expect(FEATURE_THRESHOLD).toBe(0.62);
    expect(OUT_OF_VOCABULARY_THRESHOLD).toBe(0.75);
    expect(SIZE_MIN_CONFIDENCE).toBe(0.55);
    expect(EXCLUSION_THRESHOLD).toBe(0.05);
    for (const threshold of [
      FEATURE_THRESHOLD,
      OUT_OF_VOCABULARY_THRESHOLD,
      SIZE_MIN_CONFIDENCE,
      EXCLUSION_THRESHOLD,
    ]) {
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThan(1);
    }
  });

  it('keeps the two feature thresholds apart, so a noul cannot be both', () => {
    // The band between them is "the description never mentioned it", and it is
    // the reason there are two numbers rather than one split. If they ever met,
    // every feature would be either built or refused and the ordinary case
    // would have nowhere to go.
    expect(EXCLUSION_THRESHOLD).toBeLessThan(FEATURE_THRESHOLD);
  });
});

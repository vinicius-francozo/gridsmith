import { describe, expect, it } from 'vitest';

import { FEATURES } from '../vocabulary';
import { BUILDINGS } from '../../generator/profiles';

import {
  CONDITION_LEVELS,
  FEATURE_QUESTIONS,
  FEATURE_THRESHOLD,
  LIGHT_LEVELS,
  OUT_OF_VOCABULARY_THRESHOLD,
  QUESTIONS,
  roomQuestionFor,
  SIZE_LEVELS,
  SIZE_MIN_CONFIDENCE,
} from './questions';

const BUILDING_KEYS = ['tavern', 'dungeon'];
const ROOMS = ['hall', 'room', 'storeroom'];

describe('a score question and its levels', () => {
  it('has one level for each criterion, on all three scales', () => {
    // The index a score rounds to is an index into the level table, so a table
    // shorter than its criteria answers a question with the wrong word and a
    // longer one makes a level unreachable. Neither fails on its own.
    expect(QUESTIONS.light.criteria).toHaveLength(LIGHT_LEVELS.length);
    expect(QUESTIONS.condition.criteria).toHaveLength(CONDITION_LEVELS.length);
    expect(QUESTIONS.size.criteria).toHaveLength(SIZE_LEVELS.length);
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
    expect(Object.keys(roomQuestionFor('tavern').room.criteria).sort()).toEqual(ROOMS);
    expect(Object.keys(roomQuestionFor('dungeon').room.criteria).sort()).toEqual(ROOMS);
  });

  it('removes an unavailable room from the second question', () => {
    const filling = BUILDINGS.dungeon.rooms.room;
    delete BUILDINGS.dungeon.rooms.room;
    try {
      expect(Object.keys(roomQuestionFor('dungeon').room.criteria)).toEqual(['hall', 'storeroom']);
    } finally {
      BUILDINGS.dungeon.rooms.room = filling;
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

describe('the three thresholds', () => {
  it('are probabilities, and are the measured figures', () => {
    // Pinned here as well as where they bite, because these are the numbers a
    // future measurement moves, and the comment beside each one is the record
    // of how it was chosen.
    expect(FEATURE_THRESHOLD).toBe(0.62);
    expect(OUT_OF_VOCABULARY_THRESHOLD).toBe(0.75);
    expect(SIZE_MIN_CONFIDENCE).toBe(0.55);
    for (const threshold of [FEATURE_THRESHOLD, OUT_OF_VOCABULARY_THRESHOLD, SIZE_MIN_CONFIDENCE]) {
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThan(1);
    }
  });
});

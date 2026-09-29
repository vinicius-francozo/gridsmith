import { describe, expect, it } from 'vitest';

import type { Constraints, Place } from '../core/types';

import {
  CONFLICT_CODES,
  codeOf,
  entry,
  normalizeUnresolved,
  PLACE_NOT_IN_VOCABULARY,
  UNRESOLVED_CODES,
  UNSUPPORTED_REQUEST,
} from './codes';
import { readBuildingAnswers, readRoomAnswers } from './jev/read';
import { resolve } from './resolve';

const PLACE_TYPES: Place[] = [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'tavern', room: 'storeroom' }];
const SIZE_HINTS = [undefined, 'small', 'medium', 'large'] as const;
const CLUTTERS = [-1, 0, 0.5, 1, 2, Number.NaN];
/** Real words, a word for another place, and a word from nowhere. */
const FEATURES = ['bar', 'hearth', 'stairs', 'pillars', 'alcove', 'shelving', 'bunks', 'Marble Fountain', ''];

/**
 * Every conflict `resolve` produces across a sweep of the input space.
 *
 * The sweep is what makes the exhaustiveness claim below mean something: a
 * code that only one shape of input can reach is still reached here, and a
 * code that nothing can reach shows up as a declared code that never appears.
 */
function everyConflict(): string[] {
  const conflicts: string[] = [];
  for (const place of PLACE_TYPES) {
    for (const sizeHint of SIZE_HINTS) {
      for (const clutter of CLUTTERS) {
        for (let seed = 0; seed < 12; seed += 1) {
          const constraints: Constraints = {
            place,
            sizeHint,
            light: 'dim',
            condition: 'lived_in',
            clutter,
            features: FEATURES,
            unresolved: [],
          };
          conflicts.push(...resolve(constraints, seed).conflicts);
        }
      }
    }
  }
  return conflicts;
}

/**
 * A System One response for a place outside the vocabulary, as JSON text.
 *
 * Typed out by hand, not built from the Jev reader's own constants — the rule
 * `jev/read.test.ts` states and the reason it states it. `out_of_vocabulary`
 * here is 0.98, well over the threshold, and the place Jev fell back to is the
 * hall.
 */
const OUT_OF_VOCABULARY_ANSWER = `{
  "model": "jev-1.13.0",
  "answers": {
    "building": {
      "type": "choice",
      "choice": "tavern",
      "probabilities": { "tavern": 0.71, "dungeon": 0.29 },
      "confidence": 0.71
    },
    "out_of_vocabulary": { "type": "noul", "noul": 0.98 },
    "light": { "type": "score", "score": 1.8, "legend": {}, "probabilities": {}, "confidence": 0.8 },
    "condition": { "type": "score", "score": 1.2, "legend": {}, "probabilities": {}, "confidence": 0.7 },
    "size": { "type": "score", "score": 1, "legend": {}, "probabilities": {}, "confidence": 0.3 },
    "feature_bar": { "type": "noul", "noul": 0.03 },
    "feature_hearth": { "type": "noul", "noul": 0.96 },
    "feature_stairs": { "type": "noul", "noul": 0.05 },
    "feature_pillars": { "type": "noul", "noul": 0.04 },
    "feature_alcove": { "type": "noul", "noul": 0.02 },
    "feature_shelving": { "type": "noul", "noul": 0.08 },
    "feature_bunks": { "type": "noul", "noul": 0.01 }
  },
  "usage": { "input_tokens": 311, "output_tokens": 70 }
}`;

function readAnswers(body: unknown) {
  return readRoomAnswers(
    { answers: { room: { type: 'choice', choice: 'hall', confidence: 0.9 } } },
    readBuildingAnswers(body),
  );
}

/**
 * Every entry the interpreter can put in `unresolved`, from both producers.
 *
 * Two engines write this field now. `normalizeUnresolved` is the Claude path,
 * where the model writes prose and it is coded here; `readAnswers` is the Jev
 * path, which is asked whether the place is one of the three at all. Running
 * both is what makes the claim below mean something — a code declared with no
 * producer behind it shows up as an entry nothing emits, and a producer with no
 * declaration shows up as an entry nothing declared.
 */
function everyUnresolved(): string[] {
  return [
    ...normalizeUnresolved(['a cellar below', 'unsupported_request:a trapdoor', 'chuva lá fora']),
    ...readAnswers(JSON.parse(OUT_OF_VOCABULARY_ANSWER)).unresolved,
  ];
}

describe('the list of codes is the whole list', () => {
  it('declares every code resolve can emit, and nothing resolve cannot', () => {
    // Both directions on purpose. Left out, a new code reaches the interface
    // with no wording behind it; kept after its last caller goes, the list
    // grows entries nothing will ever send.
    const emitted = new Set(everyConflict().map(codeOf));

    expect([...emitted].sort()).toEqual([...CONFLICT_CODES].sort());
  });

  it('declares every code the interpreter can put in unresolved', () => {
    const emitted = new Set(everyUnresolved().map(codeOf));

    expect([...emitted].sort()).toEqual([...UNRESOLVED_CODES].sort());
  });
});

describe('what an entry may look like', () => {
  it('is a code, or a code and a detail after the first colon', () => {
    expect(entry(UNSUPPORTED_REQUEST)).toBe('unsupported_request');
    expect(entry(UNSUPPORTED_REQUEST, 'a cellar below')).toBe('unsupported_request:a cellar below');
    expect(codeOf('unsupported_request:a cellar below')).toBe('unsupported_request');
    expect(codeOf('unsupported_request')).toBe('unsupported_request');
  });

  it('keeps a colon inside the detail, because a request can contain one', () => {
    expect(codeOf(entry(UNSUPPORTED_REQUEST, 'the sign reads: no dogs'))).toBe('unsupported_request');
    expect(entry(UNSUPPORTED_REQUEST, 'the sign reads: no dogs')).toBe(
      'unsupported_request:the sign reads: no dogs',
    );
  });

  it('is a bare code when the detail carries nothing', () => {
    expect(entry(UNSUPPORTED_REQUEST, '')).toBe('unsupported_request');
    expect(entry(UNSUPPORTED_REQUEST, '   ')).toBe('unsupported_request');
  });

  it('carries no sentence for a person to read, in either field', () => {
    // The whole point of the change: the interface writes the wording, in the
    // language the person is reading in. A code is lowercase words joined by
    // underscores, and nothing else.
    for (const conflict of everyConflict()) {
      expect(codeOf(conflict)).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
    for (const unresolved of everyUnresolved()) {
      expect(codeOf(unresolved)).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe('normalising what the model wrote in unresolved', () => {
  it('codes a sentence, keeping the sentence as the detail', () => {
    expect(normalizeUnresolved(['a second floor'])).toEqual(['unsupported_request:a second floor']);
  });

  it('keeps the words the description used, whatever language they are in', () => {
    expect(normalizeUnresolved(['um alçapão para o porão'])).toEqual([
      'unsupported_request:um alçapão para o porão',
    ]);
  });

  it('leaves an entry that already names a known code alone', () => {
    expect(normalizeUnresolved(['unsupported_request:a trapdoor'])).toEqual(['unsupported_request:a trapdoor']);
  });

  it('codes a name the model invented rather than trusting it', () => {
    // A model answering in codes of its own is the case this exists for: the
    // contract has to hold whether or not the model plays along.
    expect(normalizeUnresolved(['second_floor:two storeys'])).toEqual([
      'unsupported_request:second_floor:two storeys',
    ]);
  });

  it('changes nothing on a second pass', () => {
    const once = normalizeUnresolved(['a second floor', 'unsupported_request:a trapdoor']);

    expect(normalizeUnresolved(once)).toEqual(once);
  });

  it('writes a kept entry the way entry() would have written it', () => {
    // A kept entry is kept because the model named a real code, but the model
    // wrote the punctuation and the spacing too. Left as it stands it reaches
    // the interface in shapes nothing on our side of the boundary emits: a
    // colon with nothing after it, and a detail still padded.
    expect(normalizeUnresolved(['unsupported_request:'])).toEqual([entry(UNSUPPORTED_REQUEST)]);
    expect(normalizeUnresolved(['   unsupported_request:  a well  '])).toEqual([
      entry(UNSUPPORTED_REQUEST, 'a well'),
    ]);
    expect(normalizeUnresolved(['unsupported_request'])).toEqual([entry(UNSUPPORTED_REQUEST)]);
    expect(normalizeUnresolved(['unsupported_request:the sign reads: no dogs'])).toEqual([
      entry(UNSUPPORTED_REQUEST, 'the sign reads: no dogs'),
    ]);
  });

  it('drops an entry with nothing in it, and trims the rest', () => {
    expect(normalizeUnresolved(['', '   ', '  a well  '])).toEqual(['unsupported_request:a well']);
  });

  it('keeps an empty list empty, which is the common answer', () => {
    expect(normalizeUnresolved([])).toEqual([]);
  });
});

describe('the place the vocabulary has no word for', () => {
  it('is an entry of the form the interface reads, with the place built as the detail', () => {
    // `describeEntry` splits on the first colon: the code is what it looks a
    // phrase up by, and the detail is what the phrase puts in front of the
    // person. The detail here is the `Place` the map was built as, so the
    // sentence can say what they got instead of only what they did not.
    const entries = readAnswers(JSON.parse(OUT_OF_VOCABULARY_ANSWER)).unresolved;

    expect(entries).toEqual([entry(PLACE_NOT_IN_VOCABULARY, 'tavern_hall')]);
    expect(codeOf(entries[0])).toBe(PLACE_NOT_IN_VOCABULARY);
    expect(entries[0].slice(codeOf(entries[0]).length + 1)).toBe('tavern_hall');
  });

  it('survives normalizing, because the code is one the list declares', () => {
    // The Claude path runs every entry through `normalizeUnresolved`. A code
    // missing from `UNRESOLVED_CODES` would be rewrapped as an
    // `unsupported_request` carrying the whole entry as prose.
    const entries = readAnswers(JSON.parse(OUT_OF_VOCABULARY_ANSWER)).unresolved;

    expect(normalizeUnresolved(entries)).toEqual(entries);
  });
});

import { describe, expect, it } from 'vitest';

import type { Constraints, PlaceType } from '../core/types';

import { CONFLICT_CODES, codeOf, entry, normalizeUnresolved, UNRESOLVED_CODES, UNSUPPORTED_REQUEST } from './codes';
import { resolve } from './resolve';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];
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
  for (const placeType of PLACE_TYPES) {
    for (const sizeHint of SIZE_HINTS) {
      for (const clutter of CLUTTERS) {
        for (let seed = 0; seed < 12; seed += 1) {
          const constraints: Constraints = {
            placeType,
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

describe('the list of codes is the whole list', () => {
  it('declares every code resolve can emit, and nothing resolve cannot', () => {
    // Both directions on purpose. Left out, a new code reaches the interface
    // with no wording behind it; kept after its last caller goes, the list
    // grows entries nothing will ever send.
    const emitted = new Set(everyConflict().map(codeOf));

    expect([...emitted].sort()).toEqual([...CONFLICT_CODES].sort());
  });

  it('declares every code the interpreter can put in unresolved', () => {
    const emitted = new Set(
      normalizeUnresolved(['a cellar below', 'unsupported_request:a trapdoor', 'chuva lá fora']).map(codeOf),
    );

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
    for (const unresolved of normalizeUnresolved(['a cellar below', 'um alçapão'])) {
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

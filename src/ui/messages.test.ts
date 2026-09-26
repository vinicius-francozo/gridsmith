import { describe, expect, it } from 'vitest';

import type { Params } from '../core/types';
import { SceneValidationError } from '../generator/validate';
import {
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  CONFLICT_CODES,
  entry,
  FEATURE_NOT_IN_PLACE,
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_OVER_BUDGET,
  UNRESOLVED_CODES,
  UNSUPPORTED_REQUEST,
} from '../interpreter/codes';
import type { Code } from '../interpreter/codes';
import {
  CorsError,
  InvalidApiKeyError,
  MissingApiKeyError,
  NetworkError,
  UnusableResponseError,
  UpstreamError,
} from '../interpreter/errors';
import { FEATURES } from '../interpreter/vocabulary';
import type { Feature } from '../interpreter/vocabulary';

import {
  CODE_PHRASES,
  describeEntries,
  describeEntry,
  describeFailure,
  describeResult,
  redactKeys,
} from './messages';

/** Every code any layer of the interpreter can put in front of a person. */
const EVERY_CODE: readonly Code[] = [...CONFLICT_CODES, ...UNRESOLVED_CODES];

describe('the table covers the codes, and only the codes', () => {
  // This is the test the whole design of `codes.ts` rests on. The interpreter
  // reports a code rather than a sentence precisely so that the wording can
  // live here; a code added upstream with nothing written for it reaches the
  // screen as a raw identifier, and nothing else in the project would notice.
  it('has a phrase for every code the interpreter can emit', () => {
    const missing = EVERY_CODE.filter((code) => !Object.hasOwn(CODE_PHRASES, code));

    expect(missing).toEqual([]);
  });

  it('has no phrase for a code no layer can emit', () => {
    // The other direction. A phrase kept after its code is gone is a sentence
    // nobody will ever read, and it makes the table look complete when a later
    // reader counts entries instead of comparing them.
    expect([...Object.keys(CODE_PHRASES)].sort()).toEqual([...EVERY_CODE].sort());
  });

  it('puts the detail into the sentence for every code that can carry one', () => {
    // A `detailed` that ignores its argument passes an exhaustiveness check and
    // still drops the only part of the entry the person cares about.
    for (const code of EVERY_CODE) {
      expect(describeEntry(entry(code, 'SENTINELA'))).toContain('SENTINELA');
    }
  });

  it('says something different when the entry has no detail', () => {
    for (const code of EVERY_CODE) {
      const bare = describeEntry(code);

      expect(bare).not.toBe('');
      expect(bare).not.toContain(code);
      expect(bare).not.toBe(describeEntry(entry(code, 'SENTINELA')));
    }
  });
});

describe('an entry becomes a sentence', () => {
  it('keeps a detail that contains colons of its own', () => {
    // The code is everything before the *first* colon; a model writing
    // `unsupported_request:um NPC: o taverneiro` must not lose half of it.
    const sentence = describeEntry(`${UNSUPPORTED_REQUEST}:um NPC: o taverneiro`);

    expect(sentence).toContain('um NPC: o taverneiro');
  });

  it('ends on the quoted request, so a fragment in another language still reads', () => {
    // `unsupported_request` carries the game master's own words, in whatever
    // language they spoke. No Portuguese sentence can be built *around* a
    // fragment nobody has seen, so the fragment goes last and agrees with
    // nothing after it.
    for (const fragment of ['um segundo andar', 'a trapdoor behind the bar', 'ein Brunnen']) {
      expect(describeEntry(entry(UNSUPPORTED_REQUEST, fragment))).toBe(
        `Pedido que este mapa não tem como representar: “${fragment}”.`,
      );
    }
  });

  it('shows a feature the place cannot hold in Portuguese', () => {
    expect(describeEntry(entry(FEATURE_NOT_IN_PLACE, 'bar'))).toContain('balcão');
    expect(describeEntry(entry(FEATURE_OVER_BUDGET, 'hearth'))).toContain('lareira');
  });

  it('says the right Portuguese word for every one of the seven features', () => {
    // The table is the entire reason this layer reports a code rather than a
    // sentence, so it is the table that has to be pinned, word by word.
    // `Record<Feature, string>` refuses a missing word and "is not the English
    // one" refuses an untranslated one, but between them `stairs: 'lareira'`
    // passes both: every feature named, nothing in English, and the person
    // told the hearth was left out when it was the stairs.
    const words: Readonly<Record<Feature, string>> = {
      bar: 'balcão',
      hearth: 'lareira',
      stairs: 'escada',
      pillars: 'pilares',
      alcove: 'alcova',
      shelving: 'prateleiras',
      bunks: 'beliches',
    };

    for (const feature of FEATURES) {
      expect(describeEntry(entry(FEATURE_NOT_IN_PLACE, feature))).toContain(
        `“${words[feature]}”`,
      );
      expect(describeEntry(entry(FEATURE_OVER_BUDGET, feature))).toContain(
        `“${words[feature]}”`,
      );
      expect(describeEntry(entry(FEATURE_NOT_IN_PLACE, feature))).not.toContain(feature);
    }
  });

  it('shows a word the generator never heard of exactly as it was written', () => {
    // The opposite rule, and the reason the two codes are separate: this
    // detail is not vocabulary, it is what the person asked for, and a
    // normalised version of it would not be recognised as their own request.
    expect(describeEntry(entry(FEATURE_NOT_IN_VOCABULARY, 'Fonte de Mármore'))).toContain(
      'Fonte de Mármore',
    );
  });

  it('shows an entry whose code it does not know rather than dropping it', () => {
    const sentence = describeEntry('pergunta_do_futuro:alguma coisa');

    expect(sentence).toContain('pergunta_do_futuro:alguma coisa');
  });

  it('keeps the order the entries arrived in', () => {
    const sentences = describeEntries([
      entry(UNSUPPORTED_REQUEST, 'primeiro'),
      entry(UNSUPPORTED_REQUEST, 'segundo'),
    ]);

    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain('primeiro');
    expect(sentences[1]).toContain('segundo');
  });

  it('reads the clutter codes as the two different things they are', () => {
    const notANumber = describeEntry(entry(CLUTTER_NOT_A_NUMBER));
    const outOfRange = describeEntry(entry(CLUTTER_OUT_OF_RANGE, '2.5'));

    expect(notANumber).not.toBe(outOfRange);
    expect(outOfRange).toContain('2.5');
  });
});

describe('a failure becomes something to do about it', () => {
  it('tells the four interpreter failures apart', () => {
    // The whole reason `errors.ts` made these separate types. Collapsed to one
    // message, "paste a key" and "check your proxy" are the same sentence and
    // the person is told to do the wrong thing.
    const titles = [
      new MissingApiKeyError(),
      new InvalidApiKeyError(),
      new NetworkError(),
      new CorsError(),
    ].map((error) => describeFailure(error).title);

    expect(new Set(titles).size).toBe(4);
  });

  it('names the missing key as missing and the rejected key as rejected', () => {
    expect(describeFailure(new MissingApiKeyError()).title).toContain('Cole a sua chave');
    expect(describeFailure(new InvalidApiKeyError()).title).toContain('recusada');
  });

  it('separates a rate limit from any other refusal', () => {
    const limited = describeFailure(new UpstreamError(429, 'rate_limit_error'));
    const refused = describeFailure(new UpstreamError(400, 'invalid_request_error'));

    expect(limited.title).not.toBe(refused.title);
    expect(limited.title).toContain('excesso de chamadas');
  });

  it('explains an unplayable scene in Portuguese, not in issue kinds', () => {
    const failure = describeFailure(
      new SceneValidationError([
        { kind: 'no_door', message: 'the plan has no door' },
        { kind: 'door_blocked', message: 'a door is blocked' },
      ]),
    );

    expect(failure.title).toContain('nenhuma porta');
    expect(failure.title).toContain('bloqueada');
    expect(failure.title).not.toContain('no_door');
  });

  it('says the same thing once when a scene breaks the same rule twice', () => {
    const failure = describeFailure(
      new SceneValidationError([
        { kind: 'door_blocked', message: 'a door is blocked' },
        { kind: 'door_blocked', message: 'another door is blocked' },
      ]),
    );

    expect(failure.title.match(/bloqueada/g)).toHaveLength(1);
  });

  it('falls back on anything at all rather than showing nothing', () => {
    expect(describeFailure('não é nem um erro').title).not.toBe('');
    expect(describeFailure('não é nem um erro').detail).toBe('não é nem um erro');
  });
});

describe('a key never reaches the screen', () => {
  // An SDK failure's `message` is built from a response this code never saw,
  // and it goes on screen, where a screenshot carries it into a chat window.
  const KEY = 'sk-ant-api03-ZZZsecretZZZ';

  it('blanks a key out of an upstream message', () => {
    const failure = describeFailure(new UpstreamError(401, `header x-api-key ${KEY} rejected`));

    expect(failure.detail).not.toContain(KEY);
    expect(failure.detail).not.toContain('secret');
    expect(failure.detail).toContain('sk-ant-***');
  });

  it('blanks a key out of an unusable answer and out of a plain error', () => {
    expect(describeFailure(new UnusableResponseError(KEY)).detail).not.toContain(KEY);
    expect(describeFailure(new Error(`falhou com ${KEY}`)).detail).not.toContain(KEY);
  });

  it('blanks a key out of an advisory, not only out of a failure', () => {
    // Reachable with nothing going wrong at all. The description field is the
    // first on the page and the key field is the second and shows dots, so a
    // key pasted into the wrong one is an ordinary slip — and then the key is
    // the request. The model puts what it cannot express into `unresolved`,
    // `normalizeUnresolved` wraps anything non-conformant as
    // `unsupported_request:<the raw text>`, and this is the sentence that would
    // otherwise print the key on the screen that gets photographed.
    const sentence = describeEntry(entry(UNSUPPORTED_REQUEST, `um andar escondido ${KEY}`));

    expect(sentence).not.toContain(KEY);
    expect(sentence).not.toContain('secret');
    expect(sentence).toContain('sk-ant-***');
  });

  it('blanks a key out of an entry whose code it cannot explain either', () => {
    // The unknown-code branch prints the entry whole, so it prints the key
    // whole unless it is redacted too.
    const sentence = describeEntry(`pergunta_do_futuro:${KEY}`);

    expect(sentence).not.toContain(KEY);
    expect(sentence).toContain('sk-ant-***');
  });

  it('blanks a key out of every advisory in a list, not the first only', () => {
    const sentences = describeEntries([
      entry(UNSUPPORTED_REQUEST, `um andar escondido ${KEY}`),
      entry(UNSUPPORTED_REQUEST, `outro andar ${KEY}`),
    ]);

    expect(sentences.join('\n')).not.toContain(KEY);
  });

  it('leaves text with no key in it alone', () => {
    expect(redactKeys('nada de chave aqui')).toBe('nada de chave aqui');
  });

  it('blanks every key in a text, not only the first', () => {
    expect(redactKeys(`${KEY} e ${KEY}`)).toBe('sk-ant-*** e sk-ant-***');
  });
});

describe('the line under a finished map', () => {
  const params: Params = {
    placeType: 'tavern_storeroom',
    size: { w: 12, h: 8 },
    light: 'dark',
    condition: 'lived_in',
    clutter: 0.5,
    features: [],
    doorCount: 1,
    seed: 4242,
    conflicts: [],
  };

  it('names the place in Portuguese and carries the seed', () => {
    const line = describeResult(params);

    expect(line).toContain('Depósito de taverna');
    expect(line).toContain('4242');
    expect(line).toContain('12×8');
    expect(line).not.toContain('tavern_storeroom');
  });

  it('has a different name for each kind of place', () => {
    const names = (['tavern_hall', 'tavern_room', 'tavern_storeroom'] as const).map((placeType) =>
      describeResult({ ...params, placeType }),
    );

    expect(new Set(names).size).toBe(3);
  });
});

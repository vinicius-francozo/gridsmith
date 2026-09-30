import { describe, expect, it } from 'vitest';

import type { Building, Params, Place } from '../core/types';
import { BUILDINGS, roomsFor } from '../generator/profiles';
import { SceneValidationError } from '../generator/validate';
import {
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  CONFLICT_CODES,
  entry,
  FEATURE_ALSO_EXCLUDED,
  FEATURE_NOT_IN_PLACE,
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_OVER_BUDGET,
  FURNISHING_NOT_A_NUMBER,
  FURNISHING_OUT_OF_RANGE,
  PLACE_NOT_IN_VOCABULARY,
  UNRESOLVED_CODES,
  UNSUPPORTED_REQUEST,
} from '../interpreter/codes';
import type { Code } from '../interpreter/codes';
import {
  CorsError,
  InterpreterError,
  InvalidApiKeyError,
  MissingApiKeyError,
  NetworkError,
  UnusableResponseError,
  UpstreamError,
} from '../interpreter/errors';
import {
  JevRejectedKeyError,
  JevUnavailableError,
  JevUnusableAnswerError,
} from '../interpreter/jev/errors';
import { ClassificationFailedError, ModelUnavailableError } from '../interpreter/local/errors';
import type { ModelProgress } from '../interpreter/local/pipeline';
import { FEATURES } from '../interpreter/vocabulary';
import type { Feature } from '../interpreter/vocabulary';

import {
  CODE_PHRASES,
  describeEntries,
  describeEntry,
  describeFailure,
  describeModelProgress,
  describeResult,
  looksLikeAnthropicKey,
  redactKeys,
  UI_TEXT,
} from './messages';

/** Every code any layer of the interpreter can put in front of a person. */
const EVERY_CODE: readonly Code[] = [...CONFLICT_CODES, ...UNRESOLVED_CODES];

/** Every kind of place the generator can build. */
const PLACE_TYPES: readonly Place[] = [
  { building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' },
  { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' },
  { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'storeroom' },
  { building: 'dungeon', room: 'crypt' },
  { building: 'forge', room: 'smithy' }, { building: 'forge', room: 'room' },
  { building: 'temple', room: 'hall' }, { building: 'temple', room: 'room' },
  { building: 'library', room: 'reading' }, { building: 'library', room: 'archive' },
  { building: 'tower', room: 'laboratory' }, { building: 'tower', room: 'observatory' },
  { building: 'mine', room: 'room' }, { building: 'mine', room: 'hoist' },
  { building: 'ship', room: 'room' }, { building: 'ship', room: 'cabin' },
  { building: 'apothecary', room: 'distillery' }, { building: 'apothecary', room: 'hall' },
  { building: 'den', room: 'fencing' }, { building: 'den', room: 'tunnel' },
];

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

  it('says the right Portuguese word for every one of the ten features', () => {
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
      bed: 'cama',
      weapons: 'armas',
      tomb: 'túmulo',
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

  it('says the right Portuguese word for every kind of place there is', () => {
    // Pinned one at a time for the same reason the seven features above are.
    // `Record<Place, string>` refuses a missing name and "is not the
    // identifier" refuses an untranslated one, but between them
    // `tavern_room: 'Depósito de taverna'` passes both: every kind named,
    // nothing in English, and the person told the generator built a storeroom
    // when it built a bedroom.
    const names: Readonly<Record<string, string>> = {
      tavern_hall: 'Salão de taverna',
      tavern_room: 'Quarto de taverna',
      tavern_storeroom: 'Depósito de taverna',
      dungeon_hall: 'Salão da masmorra',
      dungeon_room: 'Cela da masmorra',
      dungeon_storeroom: 'Arsenal da masmorra',
      dungeon_crypt: 'Cripta da masmorra',
      forge_smithy: 'Forja da ferraria',
      forge_room: 'Loja da ferraria',
      temple_hall: 'Nave do templo',
      temple_room: 'Sacristia do templo',
      library_reading: 'Sala de leitura da biblioteca',
      library_archive: 'Arquivo da biblioteca',
      tower_laboratory: 'Laboratório da torre',
      tower_observatory: 'Observatório da torre',
      mine_room: 'Galeria da mina',
      mine_hoist: 'Casa de guincho da mina',
      ship_room: 'Porão do navio',
      ship_cabin: 'Camarote do navio',
      apothecary_distillery: 'Destilaria da botica',
      apothecary_hall: 'Estufa da botica',
      den_fencing: 'Receptação do antro',
      den_tunnel: 'Túnel do antro',
    };

    for (const place of PLACE_TYPES) {
      const id = `${place.building}_${place.room}`;
      const sentence = describeEntry(entry(PLACE_NOT_IN_VOCABULARY, id));

      expect(sentence).toContain(`“${names[id]}”`);
      expect(sentence).not.toContain(id);
    }
  });

  it('shows a place detail the table has no word for exactly as it arrived', () => {
    // The same rule `feature_not_in_vocabulary` follows: the last layer shows a
    // detail it does not recognise rather than dropping it.
    expect(describeEntry(entry(PLACE_NOT_IN_VOCABULARY, 'tavern_cellar'))).toContain(
      '“tavern_cellar”',
    );
  });

  it('answers a place detail that names a prototype member with the detail itself', () => {
    // The `Object.hasOwn` guard in `placeWord`, and it is reachable from the
    // outside rather than theoretical. `place_not_in_vocabulary` is in
    // `UNRESOLVED_CODES`, so `normalizeUnresolved` keeps the entry instead of
    // repacking it as `unsupported_request` and the detail travels verbatim —
    // and `unresolved` is written by a language model, so
    // `place_not_in_vocabulary:constructor` is an entry that can actually
    // arrive. A plain lookup would answer the prototype member, and the line
    // above the map would read `Desenhei o mais próximo: “function Object() {
    // [native code] }”`.
    //
    // The two-part keys are not decoration. `PLACE_NAMES` is nested now, so a
    // bare word never reaches the lookup at all — it has no underscore and
    // `placeWord` returns it before splitting. Only a `building_room` shape
    // gets as far as the table, and each of these reaches a different one of
    // the two guards: `constructor_name` answers the string `"Object"` from
    // `Object.name` if the building axis is unguarded, and `tavern___proto__`
    // answers `Object.prototype` itself — printed as `[object Object]` — if the
    // room axis is.
    const keys = [
      'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty',
      'constructor_name', 'toString_hall', 'tavern___proto__', 'tavern_constructor',
      'valueOf_hall', 'dungeon_hasOwnProperty',
    ];
    for (const key of keys) {
      expect(describeEntry(entry(PLACE_NOT_IN_VOCABULARY, key))).toBe(
        'A descrição não parece ser nenhum dos lugares que o gerador conhece. ' +
          `Desenhei o mais próximo: “${key}”.`,
      );
    }
  });

  it('reads a place outside the vocabulary as a map that was drawn, not as a refusal', () => {
    // Both halves of the entry, whole. The detailed one says which of the three
    // the person is looking at; the bare one can arrive because `unresolved` is
    // a model's text and `place_not_in_vocabulary:` with nothing after the
    // colon normalises to the code alone.
    expect(describeEntry(entry(PLACE_NOT_IN_VOCABULARY, 'tavern_hall'))).toBe(
      'A descrição não parece ser nenhum dos lugares que o gerador conhece. ' +
        'Desenhei o mais próximo: “Salão de taverna”.',
    );
    expect(describeEntry(PLACE_NOT_IN_VOCABULARY)).toBe(
      'A descrição não parece ser nenhum dos lugares que o gerador conhece; o mapa é o mais próximo deles.',
    );
  });

  it('shows an entry whose code it does not know rather than dropping it', () => {
    const sentence = describeEntry('pergunta_do_futuro:alguma coisa');

    expect(sentence).toContain('pergunta_do_futuro:alguma coisa');
  });

  it('treats the words every object already answers to as unknown codes too', () => {
    // A word nothing declares is the easy half. The hard half is the five
    // `CODE_PHRASES` inherits from `Object.prototype`: `in` says yes to all of
    // them, and the lookup then hands back a function or the prototype instead
    // of a phrase — an object with no `bare` and no `detailed`, which is a
    // `TypeError` thrown at a person who asked for a map. The code arrives as
    // a string written by a language model and every one of these survives
    // `JSON.parse`, so it is reachable from the outside.
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(describeEntry(`${key}:alguma coisa`)).toBe(
        `Aviso que esta tela não sabe explicar: “${key}:alguma coisa”.`,
      );
    }
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

  it('never calls the furniture count tralha, which is the other number', () => {
    // The two are separate fields and the person has to be able to tell which
    // of them the map got wrong. One shared wording would leave them guessing.
    for (const code of [FURNISHING_NOT_A_NUMBER, FURNISHING_OUT_OF_RANGE] as const) {
      expect(describeEntry(entry(code, '2.5'))).toContain('mobília');
      expect(describeEntry(entry(code, '2.5'))).not.toContain('tralha');
    }
    for (const code of [CLUTTER_NOT_A_NUMBER, CLUTTER_OUT_OF_RANGE] as const) {
      expect(describeEntry(entry(code, '2.5'))).toContain('tralha');
      expect(describeEntry(entry(code, '2.5'))).not.toContain('mobília');
    }
  });

  it('says a refused feature was refused, in the vocabulary word the person used', () => {
    const sentence = describeEntry(entry(FEATURE_ALSO_EXCLUDED, 'stairs'));

    expect(sentence).toContain('escada');
    expect(sentence).not.toContain('stairs');
    // Distinct from the other three ways to lose a feature: each of the four
    // asks something different of the person reading it.
    for (const other of [FEATURE_NOT_IN_PLACE, FEATURE_OVER_BUDGET, FEATURE_NOT_IN_VOCABULARY] as const) {
      expect(sentence).not.toBe(describeEntry(entry(other, 'stairs')));
    }
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

  it('blanks a key out of the local and Jev details as well', () => {
    // Four more arms carry a `detail` through to the screen, and a detail is
    // built from something this code never saw. Whether a key can reach one of
    // them today is not the question the redaction answers — it closes the
    // class, and a new arm that forgot it would be the one that printed.
    for (const failure of [
      new ModelUnavailableError(`falhou com ${KEY}`),
      new ClassificationFailedError(`falhou com ${KEY}`),
      new JevUnavailableError(`falhou com ${KEY}`),
      new JevUnusableAnswerError(`falhou com ${KEY}`),
    ]) {
      expect(describeFailure(failure).detail).not.toContain(KEY);
      expect(describeFailure(failure).detail).toContain('sk-ant-***');
    }
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
    place: { building: 'tavern', room: 'storeroom' },
    size: { w: 12, h: 8 },
    light: 'dark',
    condition: 'lived_in',
    clutter: 0.5,
    furnishing: 0.5,
    features: [],
    excluded: [],
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
    const names = PLACE_TYPES.map((place) => describeResult({ ...params, place }));

    // Read off the sweep rather than written as a number, so that a pair added
    // to `PLACE_TYPES` with a name it shares with another is what fails here —
    // which is the whole question — instead of the count needing an edit first.
    expect(new Set(names).size).toBe(PLACE_TYPES.length);
  });

  it('has a name for every pair the generator declares', () => {
    // The check standing in for the room axis's compile-time exactness in
    // `messages.ts` — the building axis keeps its own, because `PLACE_NAMES` is
    // nested and exact there. Both ends are read out of `BUILDINGS`: a list of
    // buildings written out here would have gone stale the same way the flat
    // key did, and then this test would be approximating the matrix instead of
    // reading it.
    const declared = (Object.keys(BUILDINGS) as Building[]).flatMap((building) =>
      roomsFor(building).map((room) => ({ building, room })),
    );
    expect(declared.length).toBe(PLACE_TYPES.length);
    for (const place of declared) {
      const line = describeResult({ ...params, place });
      expect(line).not.toContain(`${place.building}_${place.room}`);
      expect(line).not.toContain('undefined');
    }
  });

  it('refuses a place it has no name for, rather than writing "undefined" under the map', () => {
    // The guard the exact `Record` used to make unnecessary. Without it the
    // line reads "undefined, 12×8 casas, semente 4242" — a place name a person
    // cannot tell from a rendering fault, under a map that is otherwise right.
    const place = { building: 'tavern', room: 'crypt' } as Place;

    expect(() => describeResult({ ...params, place })).toThrow(TypeError);
    expect(() => describeResult({ ...params, place })).toThrow("no name for the place 'tavern_crypt'");
  });
});

describe('every interpreter failure has a sentence of its own', () => {
  /**
   * All eleven, so that the count in `describeFailure`'s last comment is held
   * by something other than the comment.
   *
   * Six from `errors.ts`, two from `local/errors.ts`, three from
   * `jev/errors.ts`. Five of them reached the screen through the
   * `InterpreterError` catch-all until this front, and both error files say so
   * in a comment naming `messages.ts` as the place it could not be fixed from.
   */
  const EVERY_FAILURE: readonly InterpreterError[] = [
    new MissingApiKeyError(),
    new InvalidApiKeyError(),
    new NetworkError(),
    new CorsError(),
    new UnusableResponseError('detalhe'),
    new UpstreamError(500, 'detalhe'),
    new ModelUnavailableError('detalhe'),
    new ClassificationFailedError('detalhe'),
    new JevUnavailableError('detalhe'),
    new JevRejectedKeyError('detalhe'),
    new JevUnusableAnswerError('detalhe'),
  ];

  /** What a subclass nobody has written yet would be told. */
  const generic = describeFailure(
    new (class extends InterpreterError {
      constructor() {
        super('um tipo que ainda não existe');
      }
    })(),
  ).title;

  it('says something different for every one of the eleven', () => {
    expect(new Set(EVERY_FAILURE.map((failure) => describeFailure(failure).title)).size).toBe(11);
  });

  it('leaves none of them on the catch-all', () => {
    // The catch-all is right for a type added later and wrong for one that
    // exists: "a interpretação da descrição falhou" is true of all eleven and
    // tells nobody which of them happened, or what to do about it.
    for (const failure of EVERY_FAILURE) {
      expect(describeFailure(failure).title).not.toBe(generic);
    }
    expect(generic).toBe('A interpretação da descrição falhou.');
  });

  it('names the engine in each of the three unreadable-answer sentences', () => {
    // Three engines can answer with something the schema rejects, and the three
    // sentences are otherwise the same words. Which engine is named is the only
    // thing that separates them, so it is the part that gets pinned.
    expect(describeFailure(new UnusableResponseError('x')).title).toContain('O modelo respondeu');
    expect(describeFailure(new ClassificationFailedError('x')).title).toContain(
      'O modelo local respondeu',
    );
    expect(describeFailure(new JevUnusableAnswerError('x')).title).toContain('O Jev respondeu');
  });

  it('tells a Jev key that was refused from a Jev that never answered', () => {
    // The whole reason `jev/errors.ts` made these separate types: one is fixed
    // by pasting another key and the other by waiting, and a single sentence
    // sends half the people to do the wrong thing.
    expect(describeFailure(new JevRejectedKeyError('HTTP 401')).title).toContain(
      'recusada pelo Jev',
    );
    expect(describeFailure(new JevRejectedKeyError('HTTP 401')).title).toContain('TypeSafe');
    expect(describeFailure(new JevUnavailableError('502')).title).toContain(
      'servidor desta página',
    );
  });

  it('points the Jev key at TypeSafe and the Claude key at Anthropic', () => {
    // Two keys from two companies in one field. A sentence that names the wrong
    // one sends somebody to the wrong dashboard to check a key that is fine.
    expect(describeFailure(new JevRejectedKeyError('x')).title).not.toContain('Anthropic');
    expect(describeFailure(new InvalidApiKeyError()).title).toContain('Anthropic');
  });

  it('offers a way out of a model this browser cannot load', () => {
    // The one failure on the page whose answer is not "try again": the download
    // may simply be more than this browser can hold, and no number of retries
    // changes that. So the two engines that download nothing are named.
    const title = describeFailure(new ModelUnavailableError('out of memory')).title;

    expect(title).toContain('Claude');
    expect(title).toContain('Jev');
  });

  it('keeps the upstream wording under the four that carry one', () => {
    for (const failure of [
      new ModelUnavailableError('DETALHE'),
      new ClassificationFailedError('DETALHE'),
      new JevUnavailableError('DETALHE'),
      new JevUnusableAnswerError('DETALHE'),
    ]) {
      expect(describeFailure(failure).detail).toContain('DETALHE');
    }
  });
});

describe('what the status line says while the local model is arriving', () => {
  /** The sentence for a download of `file`, `ratio` of the way through it. */
  function downloading(file: string, ratio: number | undefined): string {
    return describeModelProgress({ kind: 'downloading', file, ratio });
  }

  it('says a different thing at each of the four stages, in Portuguese', () => {
    // Pinned as literals rather than against `UI_TEXT`, the way the feature and
    // place tables above are. The type checks that the field exists; only this
    // checks that the right one was chosen — swapping `ready` for
    // `modelPreparing` satisfies `tsc` and every other test in the project.
    expect(describeModelProgress({ kind: 'starting' })).toBe('Preparando o modelo local…');
    expect(downloading('', undefined)).toBe('Baixando o modelo local…');
    expect(describeModelProgress({ kind: 'preparing' })).toBe(
      'Carregando o modelo local na memória…',
    );
    expect(describeModelProgress({ kind: 'ready' })).toBe(
      'Modelo local pronto, rodando no processador deste navegador. Interpretando a descrição…',
    );
  });

  it('does not measure the wait against an option nobody on this page can have', () => {
    // The sentence used to end "rodando sem GPU — vai demorar mais". The WebGPU
    // path was removed with the q8 weights — `MODEL_DEVICE` is fixed to `wasm`
    // and the reasoning is written out there — so "mais" compared the only
    // thing anybody gets against something nobody can get, and left the reader
    // hunting for the setting that cost them the faster one. There is none.
    //
    // No figure either: the ~510 ms recorded against `MODEL_ID` is Node on
    // twelve cores, and nothing in this project has been timed in a browser.
    const ready = describeModelProgress({ kind: 'ready' });

    expect(ready).not.toContain('GPU');
    // A whole word: a substring test would fall over the next sentence that
    // happens to contain "demais" or "jamais".
    expect(ready).not.toMatch(/\bmais\b/);
    expect(ready).not.toMatch(/\d/);
  });

  it('names the file the percentage is a fraction of', () => {
    // The defect this replaces, with the real sizes: `ratio` is per file, and
    // four files arrive. Rendered as a fraction of the whole download it reads
    // 0 100 0 100 0 1 … 99 100 0 1 … 99 100 — the two small configs finish
    // inside the opening milliseconds, so "Baixando o modelo local… 100%" is on
    // screen twice before the wait anybody is having has begun.
    //
    // The number still falls back to zero three times, because it is still a
    // fraction of one file and the byte counts a weighted figure would need
    // never reach this layer. What the file name buys is that each fall is
    // beside a name that just changed, which is the difference between "another
    // file started" and "it has frozen" — and somebody who reads a freeze
    // reloads, which throws the download away.
    const written = [
      downloading('config.json', 1),
      downloading('tokenizer_config.json', 1),
      downloading('tokenizer.json', 0.5),
      downloading('tokenizer.json', 1),
      downloading('onnx/model_quantized.onnx', 0.5),
      downloading('onnx/model_quantized.onnx', 1),
    ];

    expect(written).toEqual([
      'Baixando o modelo local… config.json, 100%',
      'Baixando o modelo local… tokenizer_config.json, 100%',
      'Baixando o modelo local… tokenizer.json, 50%',
      'Baixando o modelo local… tokenizer.json, 100%',
      'Baixando o modelo local… model_quantized.onnx, 50%',
      'Baixando o modelo local… model_quantized.onnx, 100%',
    ]);
  });

  it('keeps the file name and drops the directory it sat in', () => {
    // Every file the library reports shares the same prefix, so the directory
    // separates nothing and costs width on a line that is already long.
    expect(downloading('onnx/model_quantized.onnx', 0.5)).toContain('model_quantized.onnx');
    expect(downloading('onnx/model_quantized.onnx', 0.5)).not.toContain('onnx/');
  });

  it('rounds the percentage rather than printing the fraction', () => {
    expect(downloading('a.bin', 0.426)).toBe('Baixando o modelo local… a.bin, 43%');
    expect(downloading('a.bin', 0)).toBe('Baixando o modelo local… a.bin, 0%');
    expect(downloading('a.bin', 1)).toBe('Baixando o modelo local… a.bin, 100%');
  });

  it('says it is downloading with no percentage when the server sent no length', () => {
    // `readRawProgress` gives `undefined` rather than inventing a fraction, and
    // this is the other half of that decision.
    expect(downloading('a.bin', undefined)).toBe('Baixando o modelo local… a.bin');
    expect(downloading('a.bin', undefined)).not.toContain('%');
  });

  it('falls back to the plain sentence when no file name came with the event', () => {
    // `readRawProgress` puts `''` here when the library sent no `file`, and a
    // sentence with an empty name in the middle of it reads worse than one
    // without a name at all.
    expect(downloading('', undefined)).toBe('Baixando o modelo local…');
    expect(downloading('', 0.42)).toBe('Baixando o modelo local… 42%');
  });

  it('refuses a stage it has never heard of instead of showing nothing', () => {
    expect(() => describeModelProgress({ kind: 'finished' } as unknown as ModelProgress)).toThrow(
      TypeError,
    );
  });
});

describe('telling one provider’s key from the other', () => {
  it('knows an Anthropic key by the prefix the rest of this file already assumes', () => {
    // The same fact `redactKeys` is built on. If the two ever disagree, one of
    // them is a redaction that misses or a refusal that fires on nothing.
    expect(looksLikeAnthropicKey('sk-ant-api03-qualquer')).toBe(true);
    expect(looksLikeAnthropicKey('  sk-ant-api03-qualquer\n')).toBe(true);
    expect(redactKeys('sk-ant-api03-qualquer')).toBe('sk-ant-***');
  });

  it('claims nothing about a key that is not wearing that prefix', () => {
    // Deliberately one-directional. This project has no documented shape for a
    // TypeSafe key, so "not Anthropic's" cannot be turned into "is TypeSafe's"
    // — and a page that refused everything it did not recognise would refuse
    // keys that work.
    for (const key of ['ts-chave-do-usuario', 'qualquer-coisa', '', '   ']) {
      expect(looksLikeAnthropicKey(key)).toBe(false);
    }
  });

  it('is not fooled by the prefix turning up later in the string', () => {
    expect(looksLikeAnthropicKey('ts-sk-ant-disfarcada')).toBe(false);
  });

  it('is not walked around by case, and neither is the redaction', () => {
    // A real Anthropic key is lower case, so on its own this is pedantry. But
    // the refusal exists for the paste out of the wrong password-manager entry,
    // and a manager that upper-cases, or somebody retyping by hand, is exactly
    // where odd case comes from — the accident the guard is for is the accident
    // that brings it. The two move together because they encode one fact.
    for (const key of ['SK-ANT-api03-qualquer', 'Sk-Ant-api03-qualquer']) {
      expect(looksLikeAnthropicKey(key)).toBe(true);
      expect(redactKeys(key)).toBe('sk-ant-***');
    }
  });
});

describe('what the page promises about where the key goes', () => {
  // Every sentence here is a promise about the handling of somebody's
  // credential, and a promise about a secret that no test holds is a promise
  // that can be reversed by an edit nobody notices. Two of these were already
  // found false in this front and fixed — the Anthropic note left standing over
  // a Jev run, and a storage promise for a key that is deliberately not stored.
  // These three are true, and pinned so that they stay that way or fail loudly.

  it('promises the Claude key is kept, because it is', () => {
    // The mutation that matters runs the *other* way from the two already
    // fixed: promising less persistence than there is. A person told the key is
    // not kept has no reason to clear it off a machine they share, and it is
    // sitting in `localStorage`.
    expect(UI_TEXT.apiKeyNote).toMatch(/A chave fica guardada só neste navegador/);
    expect(UI_TEXT.apiKeyNote).not.toMatch(/não fica guardada/);
  });

  it('promises the Jev key is not kept, because it is not', () => {
    expect(UI_TEXT.apiKeyNoteJev).toMatch(/não fica guardada no navegador/);
    expect(UI_TEXT.apiKeyNoteJev).not.toMatch(/fica guardada só neste navegador/);
  });

  it('says the Claude request reaches the API without a server in between', () => {
    expect(UI_TEXT.apiKeyNote).toMatch(/vai direto para a API/);
    expect(UI_TEXT.apiKeyNote).toMatch(/Não passa por servidor nenhum/);
  });

  it('says the Jev request does pass through one, and that it keeps nothing', () => {
    // The one sentence in this file that promises another file's behaviour.
    // What makes it true is `api/jev.test.ts` — "writes nothing to the console
    // at all, on any path", which spies every console method over every path,
    // and a second test asking separately whether the key rode along with any
    // log added on purpose. This pins the words; that pair pins the fact. If
    // the proxy ever gains a log line, that pair is what fails, and this
    // sentence has to come out with it.
    expect(UI_TEXT.apiKeyNoteJev).toMatch(/passa por um servidor desta página/);
    expect(UI_TEXT.apiKeyNoteJev).toMatch(/não guarda nem registra nada/);
    expect(UI_TEXT.apiKeyNoteJev).not.toMatch(/mantém um registro/);
  });

  it('promises neither key reaches the address bar', () => {
    // True by construction — no form is built and nothing writes to `location`,
    // which `mount.test.ts` holds — but the sentence is what the person acts
    // on, so the sentence is pinned too.
    // The negative needs the lookbehind: "não aparece no endereço da página"
    // contains "aparece no endereço da página", so a plain `not.toContain`
    // fails on the correct sentence — which is the same substring trap these
    // tests exist to catch, and it caught this one first.
    for (const note of [UI_TEXT.apiKeyNote, UI_TEXT.apiKeyNoteJev]) {
      expect(note).toMatch(/não aparece no endereço da página/);
      expect(note).not.toMatch(/(?<!não )aparece no endereço da página/);
    }
  });

  it('never tells somebody to do a thing that destroys what the thing needs', () => {
    // The refusal used to end "ou escolha o Claude". Following that advice
    // fires `refreshEngine`, which empties the box — throwing away the key the
    // advice was about. Safe, and self-defeating. It now says the field will be
    // cleared, which is also the only place the page explains that at all.
    expect(UI_TEXT.anthropicKeyOnJev).toMatch(/não foi enviada/);
    expect(UI_TEXT.anthropicKeyOnJev).toMatch(/trocar de motor limpa o campo/);
  });
});

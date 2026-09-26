/**
 * Everything the person reads, in Portuguese.
 *
 * This is the one module in the project whose strings are not in English, and
 * that is the whole point of it. The rest of the codebase reports its
 * shortfalls as codes — `feature_not_in_place`, `unsupported_request` — because
 * a code has no language and travels through five layers without picking one
 * up. The request that started the map was spoken in Portuguese, so the answer
 * has to come back in Portuguese, and the translation belongs in the only layer
 * that talks to a person.
 *
 * Two shapes recur and both are deliberate.
 *
 * Every phrase that carries a detail puts it last, quoted, after a colon. The
 * details come from three different places — a word the model invented, a
 * number, and a fragment of the game master's own sentence — and only the last
 * position is grammatically safe for all three. `unsupported_request` in
 * particular holds whatever the master said, in whatever language they said it,
 * and a sentence built around it would have to agree with a fragment nobody has
 * seen. Quoted at the end, it agrees with nothing.
 *
 * And every code has a phrase for the bare entry as well as the detailed one.
 * `unresolved` is written by a language model, so `unsupported_request:` with
 * nothing after the colon is an entry that can actually arrive.
 */

import type { Params, PlaceType } from '../core/types';
import type { SceneIssueKind } from '../generator/validate';
import { SceneValidationError } from '../generator/validate';
import {
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  codeOf,
  FEATURE_NOT_IN_PLACE,
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_OVER_BUDGET,
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
import type { Feature } from '../interpreter/vocabulary';
import { isFeature } from '../interpreter/vocabulary';

/** How one code reads, with a detail and without one. */
export type CodePhrase = {
  /** The sentence when the entry carries nothing after the code. */
  readonly bare: string;
  /** The sentence for a detail. */
  readonly detailed: (detail: string) => string;
};

/** A detail, quoted the way every phrase below quotes one. */
function quoted(detail: string): string {
  return `“${detail}”`;
}

/**
 * The closed feature vocabulary, in Portuguese.
 *
 * `feature_not_in_place` and `feature_over_budget` both carry a word from
 * `FEATURES`, which is English because the code is English. Shown raw it would
 * be the one English word in a Portuguese sentence, and it is the very word the
 * sentence is about. The `Record<Feature, string>` is exact on purpose: a
 * feature added to the vocabulary stops this file compiling.
 */
const FEATURE_WORDS: Readonly<Record<Feature, string>> = {
  bar: 'balcão',
  hearth: 'lareira',
  stairs: 'escada',
  pillars: 'pilares',
  alcove: 'alcova',
  shelving: 'prateleiras',
  bunks: 'beliches',
};

/**
 * A feature detail in Portuguese, or the detail untouched.
 *
 * The fallback is not decoration. `resolve` lowercases and trims before it
 * writes these two codes, so the word should always be in the table — but the
 * entry travels as a string and this layer is the last one, so a detail that
 * does not match is shown rather than dropped.
 */
function featureWord(detail: string): string {
  return isFeature(detail) ? FEATURE_WORDS[detail] : detail;
}

/**
 * Every code this interface can be handed, and how it reads.
 *
 * The `Record<Code, CodePhrase>` is exact, like `FEATURE_WORDS`, `SCENE_ISSUES`
 * and `PLACE_NAMES` below it: a code added upstream stops this file compiling
 * instead of reaching the screen as a bare identifier. `messages.test.ts` still
 * holds the table against `CONFLICT_CODES` and `UNRESOLVED_CODES` in both
 * directions, because the compiler checks the keys and the test checks that
 * none of them has gone stale.
 */
export const CODE_PHRASES: Readonly<Record<Code, CodePhrase>> = {
  [FEATURE_NOT_IN_VOCABULARY]: {
    bare: 'Um elemento pedido não existe no vocabulário do gerador e ficou de fora.',
    detailed: (detail) => `Elemento que o gerador não conhece e deixou de fora: ${quoted(detail)}.`,
  },
  [FEATURE_NOT_IN_PLACE]: {
    bare: 'Um elemento pedido não cabe neste tipo de lugar e ficou de fora.',
    detailed: (detail) =>
      `Elemento que não pertence a este tipo de lugar e ficou de fora: ${quoted(featureWord(detail))}.`,
  },
  [FEATURE_OVER_BUDGET]: {
    bare: 'Um elemento pedido ficou de fora por falta de espaço no piso.',
    detailed: (detail) =>
      `Elemento deixado de fora por falta de espaço no piso: ${quoted(featureWord(detail))}.`,
  },
  [CLUTTER_NOT_A_NUMBER]: {
    bare: 'A quantidade de tralha no chão não veio como número; o piso foi gerado sem nada solto.',
    detailed: (detail) =>
      'A quantidade de tralha no chão não veio como número; o piso foi gerado sem nada solto. ' +
      `Valor recebido: ${quoted(detail)}.`,
  },
  [CLUTTER_OUT_OF_RANGE]: {
    bare: 'A quantidade de tralha no chão estava fora da faixa de 0 a 1 e foi trazida para o limite mais próximo.',
    detailed: (detail) =>
      'A quantidade de tralha no chão estava fora da faixa de 0 a 1 e foi trazida para o limite mais próximo. ' +
      `Valor pedido: ${quoted(detail)}.`,
  },
  [UNSUPPORTED_REQUEST]: {
    bare: 'A descrição pediu algo que este mapa não tem como representar.',
    detailed: (detail) => `Pedido que este mapa não tem como representar: ${quoted(detail)}.`,
  },
};

/**
 * Whether `code` is one the table above has a phrase for.
 *
 * `Object.hasOwn` rather than `in` or a lookup: an entry arrives as a string
 * written by a language model, and `constructor` or `toString` would answer a
 * prototype member rather than a phrase.
 */
function isKnownCode(code: string): code is Code {
  return Object.hasOwn(CODE_PHRASES, code);
}

/**
 * One entry of `unresolved` or `conflicts`, as a sentence.
 *
 * An entry is `<code>` or `<code>:<detail>`; the detail may contain colons of
 * its own, so everything after the first one is the detail.
 *
 * An unknown code is shown rather than swallowed. The test above makes it
 * unreachable through the interpreter, which leaves the case for an entry that
 * came from somewhere else — and a person reading a raw identifier at least
 * knows something was left out, which a blank line does not tell them.
 *
 * The result goes through `redactKeys` for the same reason a failure does, and
 * it is reachable the same way round: the description field is the first field
 * on the page and the key field is the second and shows dots, so a key pasted
 * into the wrong one is an ordinary slip. From there the key is the request,
 * the model puts what it cannot express into `unresolved`, and
 * `normalizeUnresolved` wraps anything non-conformant as
 * `unsupported_request:<the raw text>` — which lands on screen verbatim, on the
 * screen that gets photographed into a conversation.
 */
export function describeEntry(value: string): string {
  const code = codeOf(value);
  const detail = value.slice(code.length + 1).trim();
  const phrase = isKnownCode(code) ? CODE_PHRASES[code] : undefined;

  if (phrase === undefined) {
    return redactKeys(`Aviso que esta tela não sabe explicar: ${quoted(value)}.`);
  }
  return redactKeys(detail === '' ? phrase.bare : phrase.detailed(detail));
}

/** Every entry of `entries`, as sentences, in the order they arrived. */
export function describeEntries(entries: readonly string[]): string[] {
  return entries.map(describeEntry);
}

/**
 * The rules a generated scene can break, in Portuguese.
 *
 * `SceneValidationError` should never reach a person — the generator upholds
 * these by construction and throws only when it has failed to. When it does,
 * the message is still screen text, so it is still Portuguese. The exact
 * `Record` means a new issue kind stops this file compiling.
 */
const SCENE_ISSUES: Readonly<Record<SceneIssueKind, string>> = {
  no_door: 'o lugar saiu sem nenhuma porta',
  door_blocked: 'uma porta ficou bloqueada por um móvel',
  isolated_floor: 'parte do piso ficou sem como ser alcançada',
  circulation_pinch: 'faltou espaço para circular entre os móveis',
};

/**
 * An API key, blanked out of any text that is about to be shown or stored.
 *
 * The key is the user's own secret and it never belongs anywhere but the key
 * field and the request header. Nothing in this interface writes it into a
 * message on purpose — but a failure's `message` is written by the SDK from a
 * response this code never saw, and this text goes on screen, where it can be
 * screenshotted into a chat. Blanking the tail of anything shaped like an
 * Anthropic key costs one regular expression and closes the whole class.
 */
export function redactKeys(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***');
}

/** A failure, as a headline and an optional technical line under it. */
export type Failure = {
  /** What happened and what to do about it, in Portuguese. */
  title: string;
  /**
   * The upstream wording, when there is one worth showing.
   *
   * It is the only text on screen that may not be Portuguese: it is written by
   * the API or the SDK, it names the thing that actually went wrong, and
   * translating it would mean inventing a Portuguese sentence for a fault this
   * code does not understand. It is shown as a secondary line, never as the
   * headline.
   */
  detail?: string;
};

/**
 * What to tell the person about `error`.
 *
 * Every kind of interpreter failure asks something different of them — paste a
 * key, check the key, check the connection, look at your proxy — which is why
 * `errors.ts` made them separate types rather than one message string. This is
 * the table that decision was made for.
 */
export function describeFailure(error: unknown): Failure {
  if (error instanceof MissingApiKeyError) {
    return {
      title:
        'Falta a chave da API. Cole a sua chave da Anthropic no campo de chave para que a descrição possa ser interpretada.',
    };
  }
  if (error instanceof InvalidApiKeyError) {
    return {
      title:
        'A chave foi recusada pela API. Confira se ela é uma chave da Anthropic e se ainda está ativa.',
    };
  }
  if (error instanceof NetworkError) {
    return {
      title: 'Não foi possível chegar até a API da Anthropic. Verifique a conexão e tente de novo.',
    };
  }
  if (error instanceof CorsError) {
    return {
      title:
        'O navegador bloqueou a resposta da API. Algo entre esta página e a API está removendo os cabeçalhos de origem cruzada — costuma ser um proxy da rede ou uma extensão do navegador.',
    };
  }
  if (error instanceof UnusableResponseError) {
    return {
      title:
        'O modelo respondeu algo que não dá para ler como um conjunto de restrições. Tente de novo, ou reescreva a descrição.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof UpstreamError) {
    return {
      title:
        error.status === 429
          ? 'A API recusou o pedido por excesso de chamadas. Espere alguns segundos e tente de novo.'
          : 'A API da Anthropic recusou o pedido.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof SceneValidationError) {
    const reasons = error.issues.map((issue) => SCENE_ISSUES[issue.kind]);
    return {
      title: `O mapa gerado saiu impraticável e foi descartado: ${unique(reasons).join('; ')}. Gere de novo com outra semente.`,
    };
  }
  if (error instanceof InterpreterError) {
    // Every subclass above is handled; this catches one added later, and says
    // the true thing rather than blaming the network.
    return { title: 'A interpretação da descrição falhou.', detail: redactKeys(error.message) };
  }
  return {
    title: 'Algo deu errado ao montar o mapa.',
    detail: redactKeys(error instanceof Error ? error.message : String(error)),
  };
}

/** `values` with repeats removed, order kept. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * The three kinds of place, in Portuguese.
 *
 * Exact `Record` for the same reason as the two tables above: a fourth kind of
 * place stops this file compiling rather than reaching the screen as
 * `tavern_cellar`.
 */
const PLACE_NAMES: Readonly<Record<PlaceType, string>> = {
  tavern_hall: 'Salão de taverna',
  tavern_room: 'Quarto de taverna',
  tavern_storeroom: 'Depósito de taverna',
};

/**
 * The line under a finished map.
 *
 * The seed is in it because the seed is the only way back to this map, and the
 * size is in cells because cells are the unit the map is played in — the pixel
 * dimensions are the renderer's business and mean nothing at a table.
 */
export function describeResult(params: Params): string {
  return (
    `${PLACE_NAMES[params.placeType]}, ${String(params.size.w)}×${String(params.size.h)} casas, ` +
    `semente ${String(params.seed)}.`
  );
}

/** The fixed labels and headings of the interface. */
export const UI_TEXT = {
  title: 'Gridsmith',
  tagline: 'Descreva o lugar e receba um battlemap alinhado ao grid.',
  descriptionLabel: 'Descrição do lugar',
  descriptionPlaceholder: 'um salão de taverna, luz baixa, móveis derrubados',
  apiKeyLabel: 'Chave da API da Anthropic',
  apiKeyPlaceholder: 'sk-ant-...',
  apiKeyNote:
    'A chave fica guardada só neste navegador e vai direto para a API. Não passa por servidor nenhum e não aparece no endereço da página.',
  seedLabel: 'Semente',
  seedPlaceholder: 'em branco, sorteia uma',
  seedNote: 'A mesma descrição com a mesma semente devolve o mesmo mapa.',
  generate: 'Gerar mapa',
  generating: 'Gerando…',
  download: 'Baixar PNG',
  unresolvedHeading: 'O que a descrição pediu e o mapa não tem',
  conflictsHeading: 'O que o gerador teve de ajustar',
  emptyDescription: 'Escreva uma descrição do lugar antes de gerar.',
  seedNotAnInteger: 'A semente precisa ser um número inteiro. Deixe em branco para sortear uma.',
  seedOutOfRange: 'A semente precisa estar entre 0 e 4294967295. Deixe em branco para sortear uma.',
  interpreting: 'Interpretando a descrição…',
  drawing: 'Desenhando o mapa…',
  done: 'Mapa pronto.',
} as const;

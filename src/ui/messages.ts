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
  PLACE_NOT_IN_VOCABULARY,
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
 * The kind of place `detail` names, in the wording the rest of the page uses.
 *
 * Reads `PLACE_NAMES` rather than spelling the three names again, so the notice
 * above the map and the line beneath it call the place the same thing. The
 * detail of `PLACE_NOT_IN_VOCABULARY` is the `PlaceType` the generator settled
 * on, written by this project rather than by a model — but it still arrives as
 * a string, so an unrecognised one is shown as it came instead of dropped, the
 * same way `featureWord` does.
 *
 * `Object.hasOwn` for the reason `isKnownCode` states: a plain lookup would
 * answer a prototype member for `constructor` or `toString`.
 */
function placeWord(detail: string): string {
  return Object.hasOwn(PLACE_NAMES, detail) ? PLACE_NAMES[detail as PlaceType] : detail;
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
  // Said as a map that was drawn, not as a failure: the person gets a place,
  // and what they need to know is that it is the nearest one rather than the
  // one they described. Same posture as the codes above, which leave a feature
  // out and say so instead of refusing to draw.
  [PLACE_NOT_IN_VOCABULARY]: {
    bare: 'A descrição não parece ser nenhum dos lugares que o gerador conhece; o mapa é o mais próximo deles.',
    detailed: (detail) =>
      'A descrição não parece ser nenhum dos lugares que o gerador conhece. ' +
      `Desenhei o mais próximo: ${quoted(placeWord(detail))}.`,
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
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/gi, 'sk-ant-***');
}

/**
 * Whether `key` is plainly an Anthropic key rather than anybody else's.
 *
 * Here, beside `redactKeys`, because the two encode the same fact about the
 * same prefix and a change to one without the other would be a redaction that
 * misses or a refusal that fires on nothing.
 *
 * It answers one question and not its opposite: `sk-ant-` is Anthropic's
 * documented prefix, so a key wearing it is Anthropic's. **A key without it is
 * not thereby TypeSafe's** — this project has no documented shape for that one,
 * so there is no symmetric test to write, and inventing one would refuse keys
 * that work. That asymmetry is why the field is also emptied when the engine
 * changes: the clearing covers both directions and this covers only the one
 * where a shape is actually known.
 *
 * Case-insensitive, as `redactKeys` is. A real Anthropic key is lower case, so
 * on its own that would be pedantry — but this refusal exists for the paste out
 * of the wrong password-manager entry, and a manager that upper-cases or a
 * person retyping by hand is exactly where odd case comes from. A guard that
 * the accident walks around is not a guard.
 */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-/i.test(key.trim());
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
  // --- The Jev engine ------------------------------------------------------
  //
  // Three types rather than one because each asks something different, which is
  // the same reason the four above it are separate. They are matched before the
  // `InterpreterError` catch-all at the bottom, which is where they used to
  // land: "a interpretação da descrição falhou" is true of all three and tells
  // nobody which of them happened.
  if (error instanceof JevRejectedKeyError) {
    return {
      title:
        'A chave foi recusada pelo Jev. Confira se ela é uma chave da TypeSafe e se ainda está ativa.',
    };
  }
  if (error instanceof JevUnavailableError) {
    // The proxy is named, because it is the part of this that the person may be
    // running themselves and the part that can be down on its own. Pointing
    // them at "a conexão" alone sends somebody to check a connection that is
    // fine.
    return {
      title:
        'Não foi possível falar com o Jev. O pedido passa por um servidor desta página antes de chegar à TypeSafe, e um dos dois não respondeu. Verifique a conexão e tente de novo.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof JevUnusableAnswerError) {
    return {
      title:
        'O Jev respondeu algo que não dá para ler como um conjunto de restrições. Tente de novo, ou reescreva a descrição.',
      detail: redactKeys(error.message),
    };
  }

  // --- The local engine ----------------------------------------------------
  //
  // These two reached the screen through the catch-all as well, and both
  // `local/errors.ts` and `jev/errors.ts` say so in a comment that names this
  // file as the place it could not be fixed from. It can be fixed from here
  // now, so it is.
  if (error instanceof ModelUnavailableError) {
    // The other two engines are named because this is the one failure on the
    // page with a way out that is not "try again": the model may be more than
    // this browser can load, and no number of retries changes that.
    return {
      title:
        'O modelo local não pôde ser carregado. São cerca de 310 MB e ele precisa de um navegador com memória para rodá-lo — tente de novo, ou escolha o Claude ou o Jev, que não baixam nada.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof ClassificationFailedError) {
    return {
      title:
        'O modelo local respondeu algo que não dá para ler como um conjunto de restrições. Tente de novo, ou reescreva a descrição.',
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
    // All eleven subclasses in the project are handled above — six in
    // `errors.ts`, two in `local/errors.ts`, three in `jev/errors.ts` — so this
    // catches one added later, and says the true thing rather than blaming the
    // network. `messages.test.ts` holds it to that by naming all eleven.
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
 * The last segment of `path`, which is the part that names the file.
 *
 * The library reports paths like `onnx/model_quantized.onnx`, and the directory
 * is the same for every file it is attached to, so it carries nothing and costs
 * width on a line that is already long. The name itself is left in English: it
 * is a filename rather than prose, the same way the `detail` line of a failure
 * is left in whatever language the API wrote it.
 */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * What the status line says while the local model is being made ready.
 *
 * ## Why `downloading` names the file
 *
 * `ModelProgress.ratio` is a fraction **of one file**, and there are four: two
 * small JSON configs, `tokenizer.json` at 34,363,287 B and
 * `model_quantized.onnx` at 268,409,234 B, out of the 302,821,014 B that
 * `MODEL_ID` in `local/pipeline.ts` reports for the whole load. Rendered as if
 * it were a fraction of that whole, the percentages actually written to the
 * screen for those sizes are
 *
 * ```
 * 0 100 0 100 0 1 2 … 99 100 0 1 2 … 99 100
 * ```
 *
 * — three falls back to zero, the first two of them inside the opening
 * milliseconds, so "Baixando o modelo local… 100%" appears twice before the
 * download anybody is waiting for has moved at all. A percentage that goes
 * backwards with nothing to explain it reads as a stall, and the thing a person
 * does about a stall is reload the page, which throws away the download in
 * flight. That is the worst available outcome, and the name of the file is the
 * only signal in `ModelProgress` that separates "a new file started" from
 * "it froze".
 *
 * ## Why not a weighted percentage over the whole download
 *
 * Because it cannot be computed here, and the reason is in the type rather than
 * in the arithmetic: `ModelProgress` carries `ratio` and not `loaded`/`total`,
 * so the byte counts the weights would have to come from never reach this
 * layer. Getting them would mean changing `ModelProgress` in
 * `src/interpreter/local/pipeline.ts`, which is outside this front.
 *
 * And it would still not remove the fall — in the order the files actually
 * announce themselves it barely dents it. A file's size is knowable no earlier
 * than its own first `progress` event, so the denominator only ever grows, and
 * a figure over a growing denominator drops every time a file appears. The
 * configs land first, then `tokenizer.json`, then `model_quantized.onnx`:
 *
 * ```
 * configs in, nothing else known : 48,493 / 48,493          = 100%
 * tokenizer announces its size   : 48,493 / 34,411,780      ≈ 0.14%
 * tokenizer in                   : 34,411,780 / 34,411,780  = 100%
 * model announces its size       : 34,411,780 / 302,821,014 ≈ 11.4%
 * ```
 *
 * That is the same full-bar-to-nothing fall the per-file ratio gives, bought
 * at the price of a change to `ModelProgress` in another front's file. The
 * order is a tendency rather than a guarantee — `pipelines.js` awaits the
 * tokenizer and the model in one `Promise.all` — so the figures move with it.
 * The growing denominator does not.
 *
 * So the cheap fix is the one taken, and what it fixes is stated rather than
 * the defect being called closed.
 */
export function describeModelProgress(progress: ModelProgress): string {
  switch (progress.kind) {
    case 'starting':
      return UI_TEXT.modelStarting;
    case 'downloading': {
      // `readRawProgress` puts `''` here when the library sent no filename, and
      // a sentence with an empty name in it is worse than the plain one.
      const name = fileName(progress.file);
      const percent = progress.ratio === undefined ? undefined : Math.round(progress.ratio * 100);
      if (name === '') {
        return percent === undefined ? UI_TEXT.modelDownloading : UI_TEXT.modelDownloadingAt(percent);
      }
      return percent === undefined
        ? UI_TEXT.modelDownloadingFile(name)
        : UI_TEXT.modelDownloadingFileAt(name, percent);
    }
    case 'preparing':
      return UI_TEXT.modelPreparing;
    case 'ready':
      return UI_TEXT.modelReady;
    default: {
      const unreachable: never = progress;
      throw new TypeError(`unknown model progress: ${JSON.stringify(unreachable)}`);
    }
  }
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
  // The same field, worded for the other engine that reads it. Both halves have
  // to change together: the Anthropic label would send somebody to the wrong
  // dashboard for a key, and the Anthropic note would promise something the Jev
  // route cannot keep — that request *does* pass through a server, the proxy in
  // `api/jev.ts`, because TypeSafe answers a browser without the CORS header
  // and the response is discarded. No placeholder prefix is shown, because this
  // project has no documented one to show and inventing it would be a guess on
  // screen.
  //
  // **"não guarda nem registra nada" is this file promising another file's
  // behaviour**, and the only sentence here that does. What holds it up is
  // `api/jev.test.ts`, "writes nothing to the console at all, on any path",
  // which spies every console method across every path rather than grepping the
  // source — plus a second test that asks separately whether the key went with
  // any log somebody adds deliberately. If that pair ever goes, this sentence
  // goes with it. The tests below pin the words; that pair is what makes the
  // words true.
  apiKeyLabelJev: 'Chave da API do Jev (TypeSafe)',
  apiKeyPlaceholderJev: 'a sua chave da TypeSafe',
  apiKeyNoteJev:
    'A chave vale para esta visita: não fica guardada no navegador e não aparece no endereço da página. Ela passa por um servidor desta página, que só a repassa para a TypeSafe e não guarda nem registra nada.',
  seedLabel: 'Semente',
  seedPlaceholder: 'em branco, sorteia uma',
  seedNote: 'A mesma descrição com a mesma semente devolve o mesmo mapa.',
  generate: 'Gerar mapa',
  generating: 'Gerando…',
  download: 'Baixar PNG',
  unresolvedHeading: 'O que a descrição pediu e o mapa não tem',
  conflictsHeading: 'O que o gerador teve de ajustar',
  emptyDescription: 'Escreva uma descrição do lugar antes de gerar.',
  /**
   * Said instead of making the request, and it leads with the one thing that
   * decides what the person has to do next.
   *
   * "Não foi enviada" is the headline because the alternative sentence — the
   * one this replaces — was `JevRejectedKeyError`'s "confira se ela é uma
   * chave da TypeSafe", which sends somebody to fetch another key and says
   * nothing about the key they just handed to a third party. A disclosed
   * credential has to be rotated and a refused one does not, so which of the
   * two happened is the whole message.
   */
  anthropicKeyOnJev:
    'A chave no campo é uma chave da Anthropic e o motor escolhido é o Jev, então ela não foi enviada. Cole a sua chave da TypeSafe. Para gerar com o Claude, troque o motor e cole a chave dele de novo: trocar de motor limpa o campo, de propósito.',
  seedNotAnInteger: 'A semente precisa ser um número inteiro. Deixe em branco para sortear uma.',
  seedOutOfRange: 'A semente precisa estar entre 0 e 4294967295. Deixe em branco para sortear uma.',
  interpreting: 'Interpretando a descrição…',
  drawing: 'Desenhando o mapa…',
  done: 'Mapa pronto.',

  // --- The interpreter picker, and the local model's own progress -----------
  //
  // These lived in a `LOCAL_TEXT` of their own in `mount.ts`, with a note
  // saying they belonged here and that the front which wrote them could not add
  // to this file. That is no longer true of anyone, so they are here, and
  // `mount.ts` is back to holding no wording at all.
  engineLabel: 'Interpretador',
  engineClaude: 'Claude — na nuvem, com a sua chave',
  engineJev: 'Jev — na nuvem, com a sua chave da TypeSafe',
  engineLocal: 'Modelo local — neste navegador, sem chave',
  /**
   * The figure here is the whole first visit, not the model on its own.
   *
   * The model is 302,821,014 B, which every other file in that front calls 303
   * MB. It is not all that arrives: `vite build` emits
   * `ort-wasm-simd-threaded.asyncify` at 26.9 MB (6.8 MB gzipped) and the
   * `transformers.web` chunk at 574 kB (164 kB gzipped), and both sit behind
   * the same dynamic import as the model — nothing of it is fetched until
   * somebody picks this engine, and all of it is fetched when they do. Served
   * gzipped that is about 310 MB; served uncompressed, about 330. The note
   * says 310 because that is what a host that compresses its assets sends,
   * and the weights, which are the bulk of it, are the same either way.
   *
   * Said here rather than left to the status line, which is where it would be
   * discovered by waiting.
   */
  engineLocalNote:
    'O modelo local baixa cerca de 310 MB na primeira vez e fica guardado no navegador. Depois disso funciona sem rede e sem chave, e entende menos do que os outros dois: não sabe dizer o que a descrição pediu e o mapa não tem, que é justamente o que o Jev sabe.',
  modelStarting: 'Preparando o modelo local…',
  modelDownloading: 'Baixando o modelo local…',
  /** With a percentage, when the server said how large the file is. */
  modelDownloadingAt: (percent: number) => `Baixando o modelo local… ${String(percent)}%`,
  /** With the file, when the library said which one it is. */
  modelDownloadingFile: (file: string) => `Baixando o modelo local… ${file}`,
  /**
   * Both, and the reason the percentage is worth saying twice over.
   *
   * The percentage is read as belonging to the file that is named beside it —
   * which is what it is — instead of to the download as a whole, which it never
   * was. `describeModelProgress` has the measurement.
   */
  modelDownloadingFileAt: (file: string, percent: number) =>
    `Baixando o modelo local… ${file}, ${String(percent)}%`,
  modelPreparing: 'Carregando o modelo local na memória…',
  /**
   * The only one there is, now that `local/pipeline.ts` fixes `MODEL_DEVICE` to
   * `wasm`.
   *
   * It used to end "rodando sem GPU — vai demorar mais", picked between two
   * sentences by reading `progress.backend`. The WebGPU path is gone — the q8
   * weights go through `DequantizeLinear`, whose open bug on that path returns
   * wrong numbers rather than failing — so "mais" was a comparison against an
   * option nobody on this page can have, and the reader is left to wonder which
   * setting of theirs cost them the faster one. There is no setting.
   *
   * What replaces it says where the work happens and stops there. No figure is
   * quoted for how long, because there is none to quote: the ~510 ms recorded
   * against `MODEL_ID` is Node on twelve cores with `onnxruntime-node`, and
   * nothing in this project has ever been timed in a browser.
   */
  modelReady:
    'Modelo local pronto, rodando no processador deste navegador. Interpretando a descrição…',
} as const;

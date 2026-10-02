/**
 * Everything the person reads.
 *
 * The rest of the codebase reports its shortfalls as codes —
 * `feature_not_in_place`, `unsupported_request` — because a code has no
 * language and travels through five layers without picking one up. Turning a
 * code into a sentence belongs in the only layer that talks to a person, which
 * is this one.
 *
 * The interface is in English. The interpreters are not: what they are asked —
 * the Jev criteria, the local model's labels, the synonyms that steer it — is
 * Portuguese, because that is the vocabulary they were measured against, and it
 * is not text anybody reads. A description may be written in either language;
 * the engines were tuned on Portuguese ones.
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

import type { Params } from '../core/types';
import { placeWords } from '../generator/profiles';
import type { SceneIssueKind } from '../generator/validate';
import { SceneValidationError } from '../generator/validate';
import {
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  codeOf,
  FEATURE_ALSO_EXCLUDED,
  FEATURE_NOT_IN_PLACE,
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_OVER_BUDGET,
  FURNISHING_NOT_A_NUMBER,
  FURNISHING_OUT_OF_RANGE,
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
 * The closed feature vocabulary, as a person would say it.
 *
 * `feature_not_in_place` and `feature_over_budget` both carry a word from
 * `FEATURES`, which is an identifier rather than a word somebody says — `bunks`
 * reads fine, `hearth` is a fireplace to most people. The
 * `Record<Feature, string>` is exact on purpose: a feature added to the
 * vocabulary stops this file compiling.
 */
const FEATURE_WORDS: Readonly<Record<Feature, string>> = {
  bar: 'bar counter',
  hearth: 'fireplace',
  stairs: 'stairs',
  pillars: 'pillars',
  alcove: 'alcove',
  shelving: 'shelves',
  bunks: 'bunk beds',
  bed: 'bed',
  weapons: 'weapons',
  tomb: 'tomb',
};

/**
 * A feature detail as a person would say it, or the detail untouched.
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
 * Reads the registry rather than spelling the three names again, so the notice
 * above the map and the line beneath it call the place the same thing. The
 * detail of `PLACE_NOT_IN_VOCABULARY` is the `building_room` identifier the generator settled
 * on, written by this project rather than by a model — but it still arrives as
 * a string, so an unrecognised one is shown as it came instead of dropped, the
 * same way `featureWord` does.
 *
 * The detail is one string and the registry is nested, so it has to be cut in
 * two. It is cut at the **first** underscore because the building is the axis
 * that is closed and exact, so it is the half worth reading first — **not**
 * because the last would be wrong today: no building and no room contains an
 * underscore, and the mutation to `lastIndexOf` survives the whole suite. A
 * detail with no underscore at all is not a pair and is shown as it came,
 * which is why a bare `toString` never reaches `placeName` — though
 * `constructor_name` does, and `placeName` is what stops it.
 */
function placeWord(detail: string): string {
  const cut = detail.indexOf('_');
  const name = cut === -1 ? undefined : placeName(detail.slice(0, cut), detail.slice(cut + 1));
  return name ?? detail;
}

/**
 * Every code this interface can be handed, and how it reads.
 *
 * The `Record<Code, CodePhrase>` is exact, like `FEATURE_WORDS` and
 * `SCENE_ISSUES`: a code added upstream stops this file compiling
 * instead of reaching the screen as a bare identifier. `messages.test.ts` still
 * holds the table against `CONFLICT_CODES` and `UNRESOLVED_CODES` in both
 * directions, because the compiler checks the keys and the test checks that
 * none of them has gone stale.
 */
export const CODE_PHRASES: Readonly<Record<Code, CodePhrase>> = {
  [FEATURE_NOT_IN_VOCABULARY]: {
    bare: 'Something the description asked for is not in the generator’s vocabulary, so it was left out.',
    detailed: (detail) => `Left out, because the generator does not know it: ${quoted(detail)}.`,
  },
  [FEATURE_NOT_IN_PLACE]: {
    bare: 'Something the description asked for does not belong in this kind of place, so it was left out.',
    detailed: (detail) =>
      `Left out, because it does not belong in this kind of place: ${quoted(featureWord(detail))}.`,
  },
  [FEATURE_OVER_BUDGET]: {
    bare: 'Something the description asked for was left out: there was no floor space for it.',
    detailed: (detail) =>
      `Left out, for lack of floor space: ${quoted(featureWord(detail))}.`,
  },
  // The description asked for the thing and, in the same breath, asked for it
  // not to be there. The sentence says which of the two was obeyed, because
  // that is the part the person cannot see from the map: an absent staircase
  // looks the same whether it was refused or never fitted.
  [FEATURE_ALSO_EXCLUDED]: {
    bare: 'The description asked for something and also asked for it not to be there, so it was left out.',
    detailed: (detail) =>
      'The description asked for this and also asked for it not to be there. ' +
      `Left out: ${quoted(featureWord(detail))}.`,
  },
  [CLUTTER_NOT_A_NUMBER]: {
    bare: 'The amount of clutter on the floor did not come back as a number, so the floor was left bare.',
    detailed: (detail) =>
      'The amount of clutter on the floor did not come back as a number, so the floor was left bare. ' +
      `Value received: ${quoted(detail)}.`,
  },
  [CLUTTER_OUT_OF_RANGE]: {
    bare: 'The amount of clutter on the floor was outside the range 0 to 1 and was brought to the nearest end of it.',
    detailed: (detail) =>
      'The amount of clutter on the floor was outside the range 0 to 1 and was brought to the nearest end of it. ' +
      `Value asked for: ${quoted(detail)}.`,
  },
  // Named as furniture, never as "clutter": the two are separate fields now, and
  // a person who reads the same words for both has no way to tell which of the
  // two numbers the map got wrong.
  [FURNISHING_NOT_A_NUMBER]: {
    bare: 'The amount of furniture did not come back as a number, so the place was generated unfurnished.',
    detailed: (detail) =>
      'The amount of furniture did not come back as a number, so the place was generated unfurnished. ' +
      `Value received: ${quoted(detail)}.`,
  },
  [FURNISHING_OUT_OF_RANGE]: {
    bare: 'The amount of furniture was outside the range 0 to 1 and was brought to the nearest end of it.',
    detailed: (detail) =>
      'The amount of furniture was outside the range 0 to 1 and was brought to the nearest end of it. ' +
      `Value asked for: ${quoted(detail)}.`,
  },
  [UNSUPPORTED_REQUEST]: {
    bare: 'The description asked for something this map has no way to show.',
    detailed: (detail) => `Asked for, but this map has no way to show it: ${quoted(detail)}.`,
  },
  // Said as a map that was drawn, not as a failure: the person gets a place,
  // and what they need to know is that it is the nearest one rather than the
  // one they described. Same posture as the codes above, which leave a feature
  // out and say so instead of refusing to draw.
  [PLACE_NOT_IN_VOCABULARY]: {
    bare: 'The description does not look like any of the places the generator knows; the map is the nearest of them.',
    detailed: (detail) =>
      'The description does not look like any of the places the generator knows. ' +
      `This is the nearest one: ${quoted(placeWord(detail))}.`,
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
    return redactKeys(`A notice this page does not know how to explain: ${quoted(value)}.`);
  }
  return redactKeys(detail === '' ? phrase.bare : phrase.detailed(detail));
}

/** Every entry of `entries`, as sentences, in the order they arrived. */
export function describeEntries(entries: readonly string[]): string[] {
  return entries.map(describeEntry);
}

/**
 * The rules a generated scene can break, as a person reads them.
 *
 * `SceneValidationError` should never reach a person — the generator upholds
 * these by construction and throws only when it has failed to. When it does,
 * the message is still screen text, so it is still worded for a person. The
 * exact `Record` means a new issue kind stops this file compiling.
 */
const SCENE_ISSUES: Readonly<Record<SceneIssueKind, string>> = {
  no_door: 'the place came out with no door',
  door_blocked: 'a door was blocked by furniture',
  isolated_floor: 'part of the floor could not be reached',
  circulation_pinch: 'there was no room to walk between the furniture',
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
  /** What happened and what to do about it. */
  title: string;
  /**
   * The upstream wording, when there is one worth showing.
   *
   * It is the only text on screen this file did not write: it comes from the
   * API or the SDK, it names the thing that actually went wrong, and rewording
   * it would mean inventing a sentence for a fault this code does not
   * understand. It is shown as a secondary line, never as the headline.
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
        'The API key is missing. Paste your Anthropic key into the key field so the description can be read.',
    };
  }
  if (error instanceof InvalidApiKeyError) {
    return {
      title:
        'The API turned the key down. Check that it is an Anthropic key and that it is still active.',
    };
  }
  if (error instanceof NetworkError) {
    return {
      title: 'Could not reach the Anthropic API. Check your connection and try again.',
    };
  }
  if (error instanceof CorsError) {
    return {
      title:
        'The browser blocked the API’s answer. Something between this page and the API is stripping the cross-origin headers — usually a network proxy or a browser extension.',
    };
  }
  if (error instanceof UnusableResponseError) {
    return {
      title:
        'The model answered with something that cannot be read as a set of constraints. Try again, or reword the description.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof UpstreamError) {
    return {
      title:
        error.status === 429
          ? 'The API turned the request down: too many calls. Wait a few seconds and try again.'
          : 'The Anthropic API turned the request down.',
      detail: redactKeys(error.message),
    };
  }
  // --- The Jev engine ------------------------------------------------------
  //
  // Three types rather than one because each asks something different, which is
  // the same reason the four above it are separate. They are matched before the
  // `InterpreterError` catch-all at the bottom, which is where they used to
  // land: "reading the description failed" is true of all three and tells
  // nobody which of them happened.
  if (error instanceof JevRejectedKeyError) {
    return {
      title:
        'Jev turned the key down. Check that it is a TypeSafe key and that it is still active.',
    };
  }
  if (error instanceof JevUnavailableError) {
    // The proxy is named, because it is the part of this that the person may be
    // running themselves and the part that can be down on its own. Pointing
    // them at "the connection" alone sends somebody to check a connection that is
    // fine.
    return {
      title:
        'Could not reach Jev. The request goes through a server of this page before it gets to TypeSafe, and one of the two did not answer. Check your connection and try again.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof JevUnusableAnswerError) {
    return {
      title:
        'Jev answered with something that cannot be read as a set of constraints. Try again, or reword the description.',
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
        'The local model could not be loaded. It is about 310 MB and needs a browser with the memory to run it — try again, or pick Claude or Jev, which download nothing.',
      detail: redactKeys(error.message),
    };
  }
  if (error instanceof ClassificationFailedError) {
    return {
      title:
        'The local model answered with something that cannot be read as a set of constraints. Try again, or reword the description.',
      detail: redactKeys(error.message),
    };
  }

  if (error instanceof SceneValidationError) {
    const reasons = error.issues.map((issue) => SCENE_ISSUES[issue.kind]);
    return {
      title: `The generated map was unplayable and was thrown away: ${unique(reasons).join('; ')}. Generate again with another seed.`,
    };
  }
  if (error instanceof InterpreterError) {
    // All eleven subclasses in the project are handled above — six in
    // `errors.ts`, two in `local/errors.ts`, three in `jev/errors.ts` — so this
    // catches one added later, and says the true thing rather than blaming the
    // network. `messages.test.ts` holds it to that by naming all eleven.
    return { title: 'Reading the description failed.', detail: redactKeys(error.message) };
  }
  return {
    title: 'Something went wrong while building the map.',
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
 * is left as the API wrote it.
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
 * milliseconds, so "Downloading the local model… 100%" appears twice before the
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
 * The name a person reads for a pair, or nothing.
 *
 * **The names are not written here any more.** They live on the room's own
 * entry in the registry (`BUILDINGS` in `generator/profiles.ts`), beside the
 * Jev criterion and the entailment label, because all three used to be
 * separate tables keyed on a building and a room and all three were *sparse* on
 * the room axis — a dungeon has a crypt and a tavern does not, so a flat key of
 * every building crossed with every room would have demanded a name for
 * `tavern_crypt`, a place nothing can produce. Sparse, they compiled happily
 * with a room missing, and each answered the gap with a throw discovered by
 * whoever reached it first. Carried on the filling, a room a building declares
 * is an object with no `words`, and that does not compile.
 *
 * The throw below stays, and so does `placeWords`'s `Object.hasOwn` on both
 * axes: the pair reaching this function has come out of a conflict code as a
 * string, where no type has ever been.
 */
function placeName(building: string, room: string): string | undefined {
  return placeWords(building, room)?.name;
}

/**
 * The line under a finished map.
 *
 * The seed is in it because the seed is the only way back to this map, and the
 * size is in cells because cells are the unit the map is played in — the pixel
 * dimensions are the renderer's business and mean nothing at a table.
 *
 * @throws {TypeError} if the registry has no name for the pair. This is the
 *                     guard standing in for the type the `building_room` string
 *                     never had — see `placeName`. Without it the line reads
 *                     "undefined, 17×15 squares", which
 *                     is a place name a person cannot tell from a rendering
 *                     bug, under a map that is otherwise correct.
 */
export function describeResult(params: Params): string {
  const name = placeName(params.place.building, params.place.room);
  if (name === undefined) {
    throw new TypeError(`no name for the place '${params.place.building}_${params.place.room}'`);
  }
  return `${name}, ${String(params.size.w)}×${String(params.size.h)} squares, seed ${String(params.seed)}.`;
}

/** The fixed labels and headings of the interface. */
export const UI_TEXT = {
  title: 'Gridsmith',
  tagline: 'Describe the place and get a battlemap aligned to the grid.',
  descriptionLabel: 'Describe the place',
  /**
   * An example in Portuguese, on purpose: it is the language the interpreters
   * were tuned on, and the example is the first hint of what to write.
   */
  descriptionPlaceholder: 'e.g. um salão de taverna, luz baixa, móveis derrubados',
  apiKeyLabel: 'Anthropic API key',
  apiKeyPlaceholder: 'sk-ant-...',
  apiKeyNote:
    'The key is kept only in this browser and goes straight to the API. It passes through no server and never appears in the page’s address.',
  // The same field, worded for the other engine that reads it. Both halves have
  // to change together: the Anthropic label would send somebody to the wrong
  // dashboard for a key, and the Anthropic note would promise something the Jev
  // route cannot keep — that request *does* pass through a server, the proxy in
  // `api/jev.ts`, because TypeSafe answers a browser without the CORS header
  // and the response is discarded. No placeholder prefix is shown, because this
  // project has no documented one to show and inventing it would be a guess on
  // screen.
  //
  // **"keeps and logs nothing" is this file promising another file's
  // behaviour**, and the only sentence here that does. What holds it up is
  // `test/api/jev.test.ts`, "writes nothing to the console at all, on any path",
  // which spies every console method across every path rather than grepping the
  // source — plus a second test that asks separately whether the key went with
  // any log somebody adds deliberately. If that pair ever goes, this sentence
  // goes with it. The tests below pin the words; that pair is what makes the
  // words true.
  apiKeyLabelJev: 'Jev API key (TypeSafe)',
  apiKeyPlaceholderJev: 'your TypeSafe key',
  apiKeyNoteJev:
    'The key lasts for this visit: it is not kept in the browser and never appears in the page’s address. It passes through a server of this page, which only hands it on to TypeSafe and keeps and logs nothing.',
  seedLabel: 'Seed',
  seedPlaceholder: 'leave blank for a random one',
  seedNote: 'The same description with the same seed gives back the same map.',
  generate: 'Generate map',
  generating: 'Generating…',
  download: 'Download PNG',
  unresolvedHeading: 'What the description asked for and the map does not have',
  conflictsHeading: 'What the generator had to adjust',
  emptyDescription: 'Write a description of the place before generating.',
  /**
   * Said instead of making the request, and it leads with the one thing that
   * decides what the person has to do next.
   *
   * "It was not sent" is the headline because the alternative sentence — the
   * one this replaces — was `JevRejectedKeyError`'s "check that it is a
   * TypeSafe key", which sends somebody to fetch another key and says
   * nothing about the key they just handed to a third party. A disclosed
   * credential has to be rotated and a refused one does not, so which of the
   * two happened is the whole message.
   */
  anthropicKeyOnJev:
    'The key in the field is an Anthropic key and the engine picked is Jev, so it was not sent. Paste your TypeSafe key. To generate with Claude, switch the engine and paste its key again: switching engines empties the field, on purpose.',
  seedNotAnInteger: 'The seed has to be a whole number. Leave it blank for a random one.',
  seedOutOfRange: 'The seed has to be between 0 and 4294967295. Leave it blank for a random one.',
  interpreting: 'Reading the description…',
  drawing: 'Drawing the map…',
  done: 'Map ready.',

  // --- The two boards, and the tools over the map ----------------------------
  createTitle: 'Create a map',
  previewTitle: 'Map preview',
  previewEmpty: 'The map shows up here once it is generated.',
  /** The button that rules the grid over the map, or takes it off. The PNG follows it. */
  gridToggle: 'Grid',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',

  // --- The interpreter picker, and the local model's own progress -----------
  //
  // These lived in a `LOCAL_TEXT` of their own in `mount.ts`, with a note
  // saying they belonged here and that the front which wrote them could not add
  // to this file. That is no longer true of anyone, so they are here, and
  // `mount.ts` is back to holding no wording at all.
  engineLabel: 'Interpreter',
  engineClaude: 'Claude — in the cloud, with your key',
  engineJev: 'Jev — in the cloud, with your TypeSafe key',
  engineLocal: 'Local model — in this browser, no key',
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
   *
   * The comparison at the end is exact on purpose. It used to say that telling
   * what the map lacks "is exactly what Jev can", and Jev cannot, not in that
   * sense: its one `out_of_vocabulary` question asks whether the *building* is
   * outside the catalogue (`jev/read.ts`), so an organ asked for in a tavern
   * goes unreported. Only the Claude engine is asked to list everything the
   * vocabulary cannot carry (`schema.ts`, `unresolved`).
   */
  engineLocalNote:
    'The local model downloads about 310 MB the first time and is kept in the browser. After that it works with no network and no key, and it understands less than the other two: it never says what the description asked for that the map does not have. Claude does; Jev only says so when the place itself is not one it knows.',
  modelStarting: 'Getting the local model ready…',
  modelDownloading: 'Downloading the local model…',
  /** With a percentage, when the server said how large the file is. */
  modelDownloadingAt: (percent: number) => `Downloading the local model… ${String(percent)}%`,
  /** With the file, when the library said which one it is. */
  modelDownloadingFile: (file: string) => `Downloading the local model… ${file}`,
  /**
   * Both, and the reason the percentage is worth saying twice over.
   *
   * The percentage is read as belonging to the file that is named beside it —
   * which is what it is — instead of to the download as a whole, which it never
   * was. `describeModelProgress` has the measurement.
   */
  modelDownloadingFileAt: (file: string, percent: number) =>
    `Downloading the local model… ${file}, ${String(percent)}%`,
  modelPreparing: 'Loading the local model into memory…',
  /**
   * The only one there is, now that `local/pipeline.ts` fixes `MODEL_DEVICE` to
   * `wasm`.
   *
   * It used to end "running without a GPU — it will take longer", picked between two
   * sentences by reading `progress.backend`. The WebGPU path is gone — the q8
   * weights go through `DequantizeLinear`, whose open bug on that path returns
   * wrong numbers rather than failing — so "longer" was a comparison against an
   * option nobody on this page can have, and the reader is left to wonder which
   * setting of theirs cost them the faster one. There is no setting.
   *
   * What replaces it says where the work happens and stops there. No figure is
   * quoted for how long, because there is none to quote: the ~510 ms recorded
   * against `MODEL_ID` is Node on twelve cores with `onnxruntime-node`, and
   * nothing in this project has ever been timed in a browser.
   */
  modelReady:
    'Local model ready, running on this browser’s processor. Reading the description…',
} as const;

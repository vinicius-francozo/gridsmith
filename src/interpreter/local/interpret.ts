/**
 * Turning label scores into `Constraints`.
 *
 * This file is the whole of what the local front actually decides, and it is
 * written as pure functions over a pipeline's output rather than as methods on
 * the interpreter for one reason: every test in this front stands the
 * classifier in, so whatever lives *inside* the classifier is not exercised by
 * anything. What must therefore be reachable and exercised directly is exactly
 * this — the translation. Each step below is exported and tested on its own, and
 * `classify` is tested through a stand-in pipeline on top of that.
 *
 * ## `unresolved` is always empty here, and that is a decision
 *
 * The LLM path fills `Constraints.unresolved` with what the description asked
 * for that this vocabulary cannot carry — a second floor, a named innkeeper,
 * weather. This path never fills it, and never will, because a classifier
 * cannot produce that list. Asking for a building and then one of its rooms
 * returns a supported pair; there is no answer available that means "you also
 * asked for a trapdoor and I have no way to say so". Noticing an unmet request
 * requires reading the description for what is *not* in the label set, which is
 * generation, not classification.
 *
 * So the field comes back `[]` from here, every time. The type does not change
 * — it is `string[]` and an empty array is a `string[]` — and the LLM path goes
 * on filling it. What the person loses by choosing this interpreter is the
 * notice, not the map: `Params.conflicts` still reports everything the
 * *resolver* had to drop. The interface shows an empty `unresolved` as no
 * section at all, which is the correct thing for it to show, because this
 * interpreter genuinely has nothing to say there.
 *
 * ## `excluded` is always empty here too, and that one was measured
 *
 * The Jev engine reads "the description says this is NOT there" off the same
 * number it reads presence off, below a second threshold. The obvious move is
 * to do the same here, below `FEATURE_TEMPLATE.minConfidence`. It was tried and
 * it does not work, and the numbers are why rather than a judgement.
 *
 * Forty-one sentences — the canonical ruler's twenty-eight `features`
 * sentences, its standalone negation control, and twelve written with an
 * explicit negation in them — classified against this model, this device and
 * this dtype, one score per feature per sentence. The corpus and every number
 * are in `corpus-exclusao-jev.md`, kept outside this repository beside the
 * canonical ruler. Three buckets, 20 · 227 · 33 observations, and the medians are **0.033 for a feature the description
 * explicitly denies and 0.049 for one it never mentions** — the same
 * distribution twice. No threshold separates them: at 0.05 it catches 13 of the
 * 20 negations and calls 116 of the 227 unmentioned features refused as well,
 * and it also refuses a feature the gold says is *there*
 * (`"Há um fogo aceso no canto…"`, `hearth` 0.023). The one sentence it gets
 * most confidently wrong is `"a lareira foi arrancada e não há fogo nenhum"`,
 * where `hearth` comes back **0.977**.
 *
 * That is the same shape of limit as `unresolved`, reached from the other
 * direction: this model scores what a sentence is *about*, and a sentence about
 * a missing hearth is about a hearth. A threshold over that cannot mean
 * "refused", so this front does not pretend it does. A person who needs
 * "sem escadaria" honoured needs one of the other two engines, and the map they
 * get here is the map this front always gave them.
 */

import type { Building, Condition, Constraints, Light, Place, RoomKind } from '../../core/types';
import { roomsFor } from '../../generator/profiles';
import { constraintsSchema } from '../schema';
import { FEATURES } from '../vocabulary';
import type { Feature } from '../vocabulary';

import { ClassificationFailedError } from './errors';
import type { ZeroShotOutput, ZeroShotPipeline } from './pipeline';
import { normalizeForClassifier } from './synonyms';
import {
  CLUTTER_BY_CONDITION,
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  FURNISHING_BY_LEVEL,
  FURNISHING_TEMPLATE,
  LIGHT_TEMPLATE,
  BUILDING_TEMPLATE,
  ROOM_TEMPLATES,
  SIZE_HINT_TEMPLATE,
} from './templates';
import type { ChoiceTemplate, FurnishingLevel } from './templates';

/**
 * How much of `clutter` and `furnishing` is kept. Three places is finer than
 * any map notices.
 */
const CLUTTER_PLACES = 3;

/** A value the classifier settled on, and how sure it was. */
export type Scored<T extends string> = {
  readonly value: T;
  readonly confidence: number;
};

/**
 * The labels of `template`, in the order they are declared.
 *
 * The order does not change the answer — everything downstream reads scores by
 * label, never by position — but it does make a request reproducible, which is
 * what lets a test assert what was asked.
 */
export function labelsOf<T extends string>(template: ChoiceTemplate<T>): string[] {
  return Object.values(template.labels);
}

/** The values of `template`, in the order they are declared. */
function valuesOf<T extends string>(template: ChoiceTemplate<T>): T[] {
  return Object.keys(template.labels) as T[];
}

/**
 * The score the pipeline gave each value of `template`.
 *
 * The pipeline returns its labels sorted by score rather than in the order they
 * were asked about, so this reads them by name. Three things are refused rather
 * than worked around, because each of them means the answer is about a
 * different question than the one that was asked:
 *
 * - a label that is not one of `template`'s;
 * - the same label twice, which would make the score ambiguous;
 * - a value of `template` that was not scored at all.
 *
 * @throws {ClassificationFailedError} for each of those.
 */
export function scoresByValue<T extends string>(
  template: ChoiceTemplate<T>,
  output: ZeroShotOutput,
): Record<T, number> {
  const valueOfLabel = new Map<string, T>();
  for (const value of valuesOf(template)) {
    valueOfLabel.set(template.labels[value], value);
  }

  const scores = {} as Record<T, number>;
  output.labels.forEach((label, index) => {
    const value = valueOfLabel.get(label);
    if (value === undefined) {
      throw new ClassificationFailedError(`the classifier scored a label nobody asked about: "${label}"`);
    }
    if (Object.hasOwn(scores, value)) {
      throw new ClassificationFailedError(`the classifier scored "${label}" twice`);
    }
    // `forEach` gives the index, and `readZeroShotOutput` has already held the
    // two arrays to the same length, so this is never reading past the end.
    scores[value] = output.scores[index];
  });

  for (const value of valuesOf(template)) {
    if (!Object.hasOwn(scores, value)) {
      throw new ClassificationFailedError(`the classifier did not score "${value}"`);
    }
  }
  return scores;
}

/**
 * The best-scoring value of `template`, and its score.
 *
 * A strict `>` is what breaks a tie: the first value in declaration order wins,
 * every time, on every machine. Nothing in this project draws a number without
 * a seed, and a classifier that comes back with two labels on exactly the same
 * score is a coin this front is not allowed to toss.
 *
 * @throws {ClassificationFailedError} through `scoresByValue`.
 */
export function bestOf<T extends string>(
  template: ChoiceTemplate<T>,
  output: ZeroShotOutput,
): Scored<T> {
  const scores = scoresByValue(template, output);
  const values = valuesOf(template);
  let best = values[0];
  for (const value of values) {
    if (scores[value] > scores[best]) {
      best = value;
    }
  }
  return { value: best, confidence: scores[best] };
}

/** The building is chosen first; the room question depends on this answer. */
export function readBuilding(output: ZeroShotOutput): Building {
  return bestOf(BUILDING_TEMPLATE, output).value;
}

/** Room labels are limited to those declared for the selected building. */
export function readRoom(building: Building, output: ZeroShotOutput): RoomKind {
  return bestOf(roomTemplateFor(building), output).value;
}

export function roomTemplateFor(building: Building): ChoiceTemplate<RoomKind> {
  const source = ROOM_TEMPLATES[building];
  const labels = {} as Record<RoomKind, string>;
  for (const room of roomsFor(building)) {
    labels[room] = source.labels[room];
  }
  return { hypothesis: source.hypothesis, labels };
}

/** How lit it is. */
export function readLight(output: ZeroShotOutput): Light {
  return bestOf(LIGHT_TEMPLATE, output).value;
}

/**
 * The size the description asked for, or nothing.
 *
 * "Nothing" is the ordinary case and it is not a failure: most descriptions say
 * what a place is, not how big it is, and the resolver has a default for
 * exactly that. A classifier cannot answer "not mentioned", so the absence is
 * read off the confidence — see `SIZE_HINT_TEMPLATE.minConfidence`, which is
 * where the threshold lives and where the bench will change it.
 */
export function readSizeHint(output: ZeroShotOutput): Constraints['sizeHint'] {
  const best = bestOf(SIZE_HINT_TEMPLATE, output);
  return best.confidence >= SIZE_HINT_TEMPLATE.minConfidence ? best.value : undefined;
}

/**
 * Every feature the classifier is confident enough is there, in vocabulary
 * order.
 *
 * Vocabulary order rather than score order, because this list is handed to
 * `resolve`, which drops features past the floor's budget *from the end*. Score
 * order would make which feature survives depend on a hundredth of a point;
 * vocabulary order makes it the same list for the same scores, which is what
 * the rest of this project means by determinism.
 */
export function readFeatures(output: ZeroShotOutput): Feature[] {
  const scores = scoresByValue(FEATURE_TEMPLATE, output);
  return FEATURES.filter((feature) => scores[feature] >= FEATURE_TEMPLATE.minConfidence);
}

/**
 * How much loose stuff is on the floor, from the whole condition distribution.
 *
 * Not from the winning condition alone. A description the model reads as an
 * even split between `disordered` and `ruined` describes a place messier than
 * either figure on its own would suggest, and the average weighted by the
 * distribution says that, while `CLUTTER_BY_CONDITION[winner]` would round it
 * to one of four numbers and lose every description in between.
 *
 * **It deliberately does not clamp.** A single-label classification is a softmax
 * and sums to one, so a real answer lands between the smallest and the largest
 * figure in `CLUTTER_BY_CONDITION` and cannot leave the legal range. A result
 * outside it therefore means the scores were not a distribution — a broken
 * quantised build, a library that changed what it returns — and clamping would
 * turn that into a plausible map generated from
 * nonsense. Letting it through to the schema in `constraintsFrom` is what turns
 * it into a `ClassificationFailedError` the person can act on.
 */
export function deriveClutter(probabilities: Readonly<Record<Condition, number>>): number {
  let total = 0;
  for (const condition of Object.keys(CLUTTER_BY_CONDITION) as Condition[]) {
    total += probabilities[condition] * CLUTTER_BY_CONDITION[condition];
  }
  const scale = 10 ** CLUTTER_PLACES;
  return Math.round(total * scale) / scale;
}

/**
 * How furnished the place is, from the whole furnishing distribution.
 *
 * The same reading as `deriveClutter`, over its own question, and for the same
 * two reasons. A description the model splits evenly between `sparse` and
 * `furnished` describes a room between the two, and the winner alone would
 * round it to one of four numbers. And it deliberately does not clamp: a
 * single-label classification is a softmax, so a real answer lands between the
 * smallest and the largest figure in `FURNISHING_BY_LEVEL` — 0 and 1 — and a
 * result outside that means the scores were not a distribution at all.
 * `constraintsFrom` is what turns that into an error the person can act on
 * instead of into a plausible map.
 */
export function deriveFurnishing(probabilities: Readonly<Record<FurnishingLevel, number>>): number {
  let total = 0;
  for (const level of Object.keys(FURNISHING_BY_LEVEL) as FurnishingLevel[]) {
    total += probabilities[level] * FURNISHING_BY_LEVEL[level];
  }
  const scale = 10 ** CLUTTER_PLACES;
  return Math.round(total * scale) / scale;
}

/** Everything one classification pass produced, before it is checked. */
export type ClassifiedParts = {
  readonly place: Place;
  readonly sizeHint: Constraints['sizeHint'];
  readonly light: Light;
  readonly condition: Condition;
  readonly clutter: number;
  readonly furnishing: number;
  readonly features: readonly Feature[];
};

/**
 * The parts, assembled and held to the schema.
 *
 * The vocabulary is closed by construction here — every value came out of a
 * `Record` key, not out of a model's prose — so this parse should never refuse
 * anything. It is done anyway, and that is a rule about boundaries rather than
 * about this producer: `Constraints` reaches the generator from more than one
 * place now, and the day a second producer is wrong is not the day to discover
 * that only the first one was checked. `deriveClutter` is the one field that
 * can genuinely arrive out of range, and this is what catches it.
 *
 * `sizeHint` is left off the object rather than set to `undefined` when there
 * is none, so that a `Constraints` from this front and one from the LLM path
 * are the same object for the same map.
 *
 * @throws {ClassificationFailedError} if the assembled constraints do not
 *                                     satisfy `constraintsSchema`.
 */
export function constraintsFrom(parts: ClassifiedParts): Constraints {
  const candidate = {
    place: parts.place,
    ...(parts.sizeHint === undefined ? {} : { sizeHint: parts.sizeHint }),
    light: parts.light,
    condition: parts.condition,
    clutter: parts.clutter,
    furnishing: parts.furnishing,
    features: [...parts.features],
    // Always empty, and measured to be. See this file's header.
    excluded: [],
    // Always empty. See this file's header: a classifier cannot notice what it
    // was not asked about, so there is nothing honest to put here.
    unresolved: [],
  };

  const checked = constraintsSchema.safeParse(candidate);
  if (!checked.success) {
    throw new ClassificationFailedError(checked.error.issues.map(describeIssue).join('; '), {
      cause: checked.error,
    });
  }
  return checked.data;
}

/** One schema complaint, as a phrase naming the field it is about. */
function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const field = issue.path.map(String).join('.');
  return field === '' ? issue.message : `${field}: ${issue.message}`;
}

/**
 * The constraints `text` describes, in seven classifications.
 *
 * Seven and not one: each field is a different question with a different
 * hypothesis, and the pipeline judges one hypothesis at a time. They run one
 * after another rather than together because a single model session is one
 * piece of hardware — issuing seven at once on the WebAssembly path queues them
 * behind each other anyway. The second half of that reason used to be "and on
 * WebGPU it contends for the same device"; WebGPU is never asked for now, so
 * the WebAssembly half is the whole of it. See `MODEL_DEVICE`.
 *
 * It was six until `furnishing` became a field of its own. The seventh pass is
 * what that costs, and it buys the map the two axes it declares: the old six
 * answered `condition` and let the furniture count follow it, which is how a
 * ruin came back with nine war tables in it.
 *
 * ## What the model is shown
 *
 * Not `text` itself: `synonyms.ts` rewrites the handful of words this model is
 * known to miss — "porão" for the storeroom, "estante" for the shelving — into
 * the words its labels use, and the result of that is the premise of all six
 * entailment pairs. All six get the *same* premise, so the six answers are
 * about one sentence.
 *
 * `text` is not touched. `premise.original` is it, character for character, and
 * this function has no business rewriting a description in the first place —
 * what it needs is a second string to ask about, which is exactly what
 * `normalizeForClassifier` hands back beside the first.
 *
 * @throws {ClassificationFailedError} if the pipeline answers with something
 *                                     that is not about the question asked, or
 *                                     if the result fails the schema.
 */
export async function classify(text: string, pipeline: ZeroShotPipeline): Promise<Constraints> {
  const premise = normalizeForClassifier(text);

  const ask = async <T extends string>(
    template: ChoiceTemplate<T>,
    multiLabel: boolean,
  ): Promise<ZeroShotOutput> =>
    pipeline(premise.text, labelsOf(template), {
      hypothesisTemplate: template.hypothesis,
      multiLabel,
    });

  const building = readBuilding(await ask(BUILDING_TEMPLATE, false));
  const room = readRoom(building, await ask(roomTemplateFor(building), false));
  const light = readLight(await ask(LIGHT_TEMPLATE, false));

  const conditionOutput = await ask(CONDITION_TEMPLATE, false);
  const condition = bestOf(CONDITION_TEMPLATE, conditionOutput).value;
  const clutter = deriveClutter(scoresByValue(CONDITION_TEMPLATE, conditionOutput));
  const furnishing = deriveFurnishing(scoresByValue(FURNISHING_TEMPLATE, await ask(FURNISHING_TEMPLATE, false)));

  const sizeHint = readSizeHint(await ask(SIZE_HINT_TEMPLATE, false));
  // The only multi-label pass: seven independent yes/no questions, not a choice
  // between seven. A hall with a bar and a hearth and stairs has all three.
  const features = readFeatures(await ask(FEATURE_TEMPLATE, true));

  return constraintsFrom({
    place: { building, room },
    sizeHint,
    light,
    condition,
    clutter,
    furnishing,
    features,
  });
}

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
 * cannot produce that list. Asking "which of these three kinds of place is it"
 * returns one of three; there is no answer available to it that means "you also
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
 */

import type { Condition, Constraints, Light, PlaceType } from '../../core/types';
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
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
} from './templates';
import type { ChoiceTemplate } from './templates';

/** How much of `clutter` is kept. Three places is finer than any map notices. */
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

/** A kind of place, how sure the classifier was, and whether that is enough. */
export type PlaceTypeReading = Scored<PlaceType> & {
  /**
   * Whether the confidence cleared `PLACE_TYPE_TEMPLATE.minConfidence`.
   *
   * Nothing acts on this yet, and that is deliberate rather than an oversight —
   * see `readPlaceType`.
   */
  readonly trusted: boolean;
};

/**
 * Which of the three kinds of tavern space this is, and whether to believe it.
 *
 * The gate is worth computing because it was measured to mean something: with
 * the short labels in `templates.ts`, confidence separates a right answer from
 * a wrong one at an AUC of 0.922, and at the threshold there the bench's twenty
 * descriptions split into thirteen accepted — all thirteen correct — and seven
 * held back.
 *
 * **`trusted` is reported and not obeyed.** Obeying it would mean falling back
 * to something, and there is nothing to fall back to: no rule-based reader of a
 * description exists in this project, and inventing one here to have somewhere
 * to fall would be a second interpreter smuggled in under a threshold. So the
 * answer is used either way, exactly as it was before this gate existed, and
 * what the gate buys today is that the number is computed, named and reachable
 * for the day the other path is built.
 */
export function readPlaceType(output: ZeroShotOutput): PlaceTypeReading {
  const best = bestOf(PLACE_TYPE_TEMPLATE, output);
  return { ...best, trusted: best.confidence >= PLACE_TYPE_TEMPLATE.minConfidence };
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
 * figure in `CLUTTER_BY_CONDITION` and cannot leave the legal range. A result outside it therefore means the scores were
 * not a distribution — a broken quantised build, a library that changed what it
 * returns — and clamping would turn that into a plausible map generated from
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

/** Everything one classification pass produced, before it is checked. */
export type ClassifiedParts = {
  readonly placeType: PlaceType;
  readonly sizeHint: Constraints['sizeHint'];
  readonly light: Light;
  readonly condition: Condition;
  readonly clutter: number;
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
    placeType: parts.placeType,
    ...(parts.sizeHint === undefined ? {} : { sizeHint: parts.sizeHint }),
    light: parts.light,
    condition: parts.condition,
    clutter: parts.clutter,
    features: [...parts.features],
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
 * The constraints `text` describes, in five classifications.
 *
 * Five and not one: each field is a different question with a different
 * hypothesis, and the pipeline judges one hypothesis at a time. They run one
 * after another rather than together because a single model session is one
 * piece of hardware — issuing five at once on the WebAssembly path queues them
 * behind each other anyway, and on WebGPU it contends for the same device.
 *
 * ## What the model is shown
 *
 * Not `text` itself: `synonyms.ts` rewrites the handful of words this model is
 * known to miss — "porão" for the storeroom, "fogo" for the hearth — into the
 * words its labels use, and the result of that is the premise of all five
 * entailment pairs. All five get the *same* premise, so the five answers are
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

  // `trusted` is read by nobody yet; `readPlaceType` says why it is computed.
  const placeType = readPlaceType(await ask(PLACE_TYPE_TEMPLATE, false)).value;
  const light = readLight(await ask(LIGHT_TEMPLATE, false));

  const conditionOutput = await ask(CONDITION_TEMPLATE, false);
  const condition = bestOf(CONDITION_TEMPLATE, conditionOutput).value;
  const clutter = deriveClutter(scoresByValue(CONDITION_TEMPLATE, conditionOutput));

  const sizeHint = readSizeHint(await ask(SIZE_HINT_TEMPLATE, false));
  // The only multi-label pass: seven independent yes/no questions, not a choice
  // between seven. A hall with a bar and a hearth and stairs has all three.
  const features = readFeatures(await ask(FEATURE_TEMPLATE, true));

  return constraintsFrom({ placeType, sizeHint, light, condition, clutter, features });
}

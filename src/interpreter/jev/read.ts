/**
 * Turning a System One response into `Constraints`.
 *
 * Written as functions over a parsed body rather than as methods on the
 * interpreter, for the reason `local/interpret.ts` gives for the same split:
 * every test in this front stands the network in, so what has to be reachable
 * and exercised directly is exactly the translation.
 *
 * ## `unresolved` stops being empty here
 *
 * The zero-shot path fills it never, and says why in its own header: a
 * classifier cannot notice what it was not asked about. Jev is asked, as a
 * proposition of its own, and an answer above `OUT_OF_VOCABULARY_THRESHOLD`
 * becomes `PLACE_NOT_IN_VOCABULARY` with the kind of place that was built as
 * the detail.
 *
 * The map is still generated, as the nearest supported pair. That is the
 * precedent in `resolve.ts:221-237`, where a feature that does not fit the
 * place is left out and recorded rather than rejected: a person who asked for a
 * forge gets a room and a line telling them it is not a forge, which is more
 * than they get from a refusal and more than they get from silence.
 *
 * ## Confidence is not truth
 *
 * Nothing here treats a high number as a fact. With the old three-place tavern
 * question, `"Amanhã eles porão os
 * barris no lugar certo"` comes back `tavern_storeroom` at confidence **1.000**
 * — the future of *pôr* colliding with *porão*, the cellar. "Never
 * hallucinates" means Jev does not invent a value outside the schema; it does
 * not mean the confidence warns you when it is wrong. So confidence gates what
 * is *dropped* (a size hint, a feature, a notice) and never promotes anything.
 */

import { z } from 'zod';

import type { Building, Constraints } from '../../core/types';
import { entry, PLACE_NOT_IN_VOCABULARY } from '../codes';
import { constraintsSchema } from '../schema';
import { FEATURES } from '../vocabulary';
import type { Feature } from '../vocabulary';

import { JevUnusableAnswerError } from './errors';
import {
  CONDITION_LEVELS,
  EXCLUSION_THRESHOLD,
  FEATURE_QUESTIONS,
  FEATURE_THRESHOLD,
  FURNISHING_TOP,
  LIGHT_LEVELS,
  OUT_OF_VOCABULARY_THRESHOLD,
  QUESTIONS,
  roomQuestionFor,
  SIZE_LEVELS,
  SIZE_MIN_CONFIDENCE,
} from './questions';
import type { QuestionName } from './questions';

/**
 * `clutter` at the tidiest level, and what one level of `condition` adds.
 *
 * These two numbers are `CLUTTER_BY_CONDITION` in closed form. Jev answers
 * `condition` with a *continuous* score, so the four figures the local path
 * rounds to come out exactly at the integers — 0 to 0.10, 1 to 0.35, 2 to 0.60,
 * 3 to 0.85 — and everything between them is filled in instead of snapped to
 * the nearest of four. The weighted average in `deriveClutter` was an imitation
 * of exactly this, built out of a softmax because a distribution was all a
 * classifier could offer.
 *
 * The result is not rounded. It is one multiply and one add over a number that
 * came off the wire, the four integers land on the table's own figures, and
 * three decimal places of a value nothing displays is not worth a rule.
 */
const CLUTTER_AT_TIDY = 0.1;
const CLUTTER_PER_LEVEL = 0.25;

/** A probability, which every noul and every confidence is. */
const probability = z.number().min(0).max(1);

const envelopeSchema = z.object({ answers: z.record(z.string(), z.unknown()) });
const noulSchema = z.object({ type: z.literal('noul'), noul: probability });
const choiceSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: probability,
});
const scoreSchema = z.object({ type: z.literal('score'), score: z.number(), confidence: probability });

/**
 * How much loose stuff is on the floor, from `condition`'s continuous score.
 *
 * Exported so the table it reproduces can be checked against
 * `CLUTTER_BY_CONDITION` itself rather than against a copy of its four numbers.
 */
export function clutterFromScore(score: number): number {
  return CLUTTER_AT_TIDY + CLUTTER_PER_LEVEL * score;
}

/**
 * How furnished the place is, from `furnishing`'s score.
 *
 * `Constraints.furnishing` is 0..1 and the question is a position on a scale of
 * four ordered criteria, so the whole reading is that division. It is a
 * function rather than a division at the call site for the reason
 * `clutterFromScore` is one: it is the piece a test can hold against the
 * question's own criteria, and it is where the relationship between the scale
 * and the field is written down.
 *
 * It does not clamp, and nothing downstream needs it to: `scoreOn` has already
 * refused anything outside the scale, so the result cannot leave 0..1. That is
 * the same trade `deriveClutter` makes and for the same reason — a score
 * outside the band means the answer is to a different question, and clamping it
 * would turn that into a plausible map.
 */
export function furnishingFromScore(score: number): number {
  return score / FURNISHING_TOP;
}

/**
 * The constraints a response describes.
 *
 * @param body whatever the proxy relayed, already parsed out of JSON.
 * @throws {JevUnusableAnswerError} if the body is not a set of answers to the
 *                                  questions that were asked, or if what it
 *                                  assembles into does not satisfy
 *                                  `constraintsSchema`.
 */
export type BuildingReading = Omit<Constraints, 'place'> & { building: Building; outOfVocabulary: number };

export function readBuildingAnswers(body: unknown): BuildingReading {
  const answers = answersOf(body, Object.keys(QUESTIONS));

  const building = read(answers, 'building', choiceSchema);
  const parsedBuilding = z.enum(['tavern', 'dungeon']).safeParse(building.choice);
  if (!parsedBuilding.success) {
    throw new JevUnusableAnswerError(`building: ${describeIssues(parsedBuilding.error)}`, { cause: parsedBuilding.error });
  }
  const light = levelOf('light', read(answers, 'light', scoreSchema).score, LIGHT_LEVELS);
  const conditionScore = read(answers, 'condition', scoreSchema).score;
  const size = read(answers, 'size', scoreSchema);
  const outOfVocabulary = read(answers, 'out_of_vocabulary', noulSchema).noul;

  const furnishing = furnishingFromScore(
    scoreOn('furnishing', read(answers, 'furnishing', scoreSchema).score, FURNISHING_TOP),
  );

  // Read once and split two ways. The same noul answers both questions — is it
  // there, and did the description say it is not — so reading it twice would
  // let the two halves drift apart over a value that arrived once.
  //
  // Vocabulary order rather than the order the answers arrived in, for the
  // reason `readFeatures` gives: `resolve` drops features past the floor's
  // budget from the end, so the order decides which one survives, and it must
  // not depend on a hundredth of a point.
  const nouls = {} as Record<Feature, number>;
  for (const feature of FEATURES) {
    nouls[feature] = read(answers, FEATURE_QUESTIONS[feature], noulSchema).noul;
  }
  const features = FEATURES.filter((feature) => nouls[feature] >= FEATURE_THRESHOLD);
  // The band between the two thresholds is the ordinary case — a description
  // that simply never mentioned the thing — and it belongs to neither list.
  // See `EXCLUSION_THRESHOLD` for what was measured, in which sentences.
  const excluded = FEATURES.filter((feature) => nouls[feature] <= EXCLUSION_THRESHOLD);

  // The score is read only when the gate lets it through: below the gate the
  // hint is dropped whatever it says, so refusing an out-of-band score there
  // would fail a request over a number that was never going to be used.
  const sizeHint =
    size.confidence >= SIZE_MIN_CONFIDENCE ? levelOf('size', size.score, SIZE_LEVELS) : undefined;

  return {
    building: parsedBuilding.data,
    // Left off rather than set to `undefined`, so that a `Constraints` from
    // this engine and one from either of the others are the same object for
    // the same map. `constraintsFrom` in `local/interpret.ts` does the same.
    ...(sizeHint === undefined ? {} : { sizeHint }),
    light,
    condition: levelOf('condition', conditionScore, CONDITION_LEVELS),
    clutter: clutterFromScore(conditionScore),
    furnishing,
    features,
    excluded,
    // The detail is the kind of place that was built, so the interface can say
    // what the person got rather than only that they did not get what they
    // asked for. Written through `entry`, never as a sentence: `codes.ts:1-17`.
    unresolved: [],
    outOfVocabulary,
  };
}

export function readRoomAnswers(body: unknown, first: BuildingReading): Constraints {
  const answers = answersOf(body, ['room']);
  const room = read(answers, 'room', choiceSchema);
  const allowed = roomQuestionFor(first.building).room.criteria;
  if (!Object.hasOwn(allowed, room.choice)) {
    throw new JevUnusableAnswerError(`room: unknown choice '${room.choice}' for ${first.building}`);
  }
  const { building, outOfVocabulary, ...rest } = first;
  const place = { building, room: room.choice };
  const candidate = {
    ...rest,
    place,
    unresolved: outOfVocabulary >= OUT_OF_VOCABULARY_THRESHOLD
      ? [entry(PLACE_NOT_IN_VOCABULARY, `${building}_${room.choice}`)] : [],
  };

  // The same gate the other two engines pass through, for the reason
  // `schema.ts:10-15` gives. The risk is a different one here — Jev answers a
  // choice with one of the keys it was handed, so it cannot invent
  // `throne_room` the way a prompted model can — but it can pick the least
  // wrong of three, and the parse is what stops anything else the proxy might
  // relay from reaching the generator unchecked.
  const checked = constraintsSchema.safeParse(candidate);
  if (!checked.success) {
    throw new JevUnusableAnswerError(describeIssues(checked.error), { cause: checked.error });
  }
  return checked.data;
}

/**
 * The answers in `body`, once they are known to be the ones that were asked
 * for.
 *
 * Both directions, and neither is pedantry. An answer missing is a field read
 * as `undefined` and refused three lines later with a worse message; an answer
 * nobody asked for means the response is about a different request than this
 * one, which is the failure a shared proxy can produce and no later check would
 * catch. `scoresByValue` in `local/interpret.ts` refuses the same two shapes,
 * for the same reason.
 */
function answersOf(body: unknown, expected: string[]): Record<string, unknown> {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new JevUnusableAnswerError(describeIssues(envelope.error), { cause: envelope.error });
  }

  const asked = [...expected].sort().join(', ');
  const answered = Object.keys(envelope.data.answers).sort().join(', ');
  if (asked !== answered) {
    throw new JevUnusableAnswerError(
      `the answers are not the questions that were asked: expected ${asked}; got ${answered}`,
    );
  }
  return envelope.data.answers;
}

/**
 * One answer, held to the shape its question was asked in.
 *
 * @throws {JevUnusableAnswerError} naming the question, because "expected
 *                                  noul, got score" says nothing on its own
 *                                  when thirteen questions were asked at once.
 */
function read<T>(answers: Record<string, unknown>, name: QuestionName | 'room', schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(answers[name]);
  if (!parsed.success) {
    throw new JevUnusableAnswerError(`${name}: ${describeIssues(parsed.error)}`, { cause: parsed.error });
  }
  return parsed.data;
}

/**
 * A score, once it is known to be a position on the scale that was asked about.
 *
 * Anything outside `0` to `top` is an answer to a different question and is
 * refused rather than clamped. Clamping is what would turn a broken response
 * into a plausible map, which is the trade `deriveClutter` declines for the
 * same reason.
 *
 * Split out of `levelOf` when `furnishing` arrived, because that one is a
 * position on a scale that is never rounded to a level — it is divided into a
 * 0..1 field — and the check is the half the two readings share.
 */
function scoreOn(name: QuestionName, score: number, top: number): number {
  if (!(score >= 0 && score <= top)) {
    throw new JevUnusableAnswerError(
      `${name}: a score of ${String(score)} is outside the ${String(top + 1)} levels it was asked about`,
    );
  }
  return score;
}

/**
 * The level a score lands on.
 *
 * Inside the band, rounding always lands on a level that exists.
 */
function levelOf<T extends string>(name: QuestionName, score: number, levels: readonly T[]): T {
  return levels[Math.round(scoreOn(name, score, levels.length - 1))];
}

/**
 * What a schema refused, as a phrase naming the field it is about.
 *
 * The same shape as the one in `local/interpret.ts`; that one is private to its
 * own front and this front does not own the file it lives in.
 */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.map(String).join('.');
      return field === '' ? issue.message : `${field}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * The hypotheses the local classifier is asked to judge, and nothing else.
 *
 * This file is data. It holds no logic on purpose, because the wording in it is
 * the part of this front that was *measured* rather than reasoned about: a
 * bench scored two models against twenty Portuguese descriptions and the
 * phrasings below are the ones it came back with. Everything here is written so
 * that replacing it is editing strings in a map — never hunting a hypothesis
 * down inside a function.
 *
 * Three rules keep it that way, and the reviewer should hold this front to all
 * three:
 *
 * 1. **Every label map is an exact `Record` over a closed vocabulary.** A fourth
 *    kind of place, or an eighth feature, stops this file compiling rather than
 *    silently becoming a value the classifier is never asked about. That one is
 *    the compiler's, and `templates.test.ts` restates each vocabulary by hand so
 *    that a type and a template cannot drift together unnoticed.
 * 2. **No hypothesis or label string is restated anywhere that has to agree
 *    with it.** A copy is a copy that silently stops matching when these
 *    change. `synonyms.ts` is the one file that needs the model's own words,
 *    and it *derives* them from here rather than restating them — see
 *    `STOREROOM_WORD` below, which exists exactly so that it can.
 *
 *    `templates.test.ts` is the deliberate exception, and it is the opposite
 *    case rather than a breach of the rule: a test that writes a measured value
 *    out by hand does not drift quietly, it *fails*, which is the entire point
 *    of writing it down twice. It pins the five hypotheses, the three
 *    thresholds and the shape of the labels — never a label's own wording,
 *    which a later bench is expected to replace.
 * 3. **Nothing here gets "improved" without a measurement.** The three findings
 *    under the next heading are all cases where the wording a person would
 *    naturally write is the wording that scores worst.
 *
 * ## What the bench found, so that nobody undoes it
 *
 * - **A long, descriptive label collapses.** Phrasing `placeType` as a
 *   descriptive sentence scored 45%, against 90% for the bare short label below.
 *   In `features` the same change took F1 from 0.94 to 0.57. The labels here are
 *   therefore as short as they can be said, and the features are bare nouns.
 * - **A disjunction in a feature label is worse than either half.** Asking about
 *   `'pilares ou colunas'` took F1 from 0.94 to 0.79 and invented false
 *   positives. No label here contains "ou".
 * - **`tavern_storeroom` deliberately does not say "porão ou adega".** That
 *   longer label raised raw accuracy and flattened confidence, which is the one
 *   thing the gate in `PLACE_TYPE_TEMPLATE.minConfidence` cannot survive.
 *   `synonyms.ts` resolves "porão" and "adega" *before* the model is asked, so
 *   the short label and the high confidence are no longer a trade.
 *
 * ## Why the labels are in Portuguese when the code is in English
 *
 * These are not identifiers and not screen text — they are the model's input,
 * the second half of an entailment pair whose first half is the game master's
 * own sentence. The bench scored these Portuguese hypotheses against Portuguese
 * premises, and that pairing is what the numbers above describe.
 *
 * *Known limitation, stated rather than hidden:* a description in another
 * language is judged against a Portuguese hypothesis. The model is multilingual
 * so this degrades rather than fails, but it degrades — and `synonyms.ts`, which
 * only knows Portuguese words, does nothing for it at all.
 */

import type { Condition, Light, PlaceType } from '../../core/types';
import type { Feature } from '../vocabulary';

/**
 * A hypothesis with one hole in it.
 *
 * `{}` is where the label goes. The placeholder is `{}` and not something of
 * our own because it is what the pipeline substitutes into — see
 * `pipeline.ts`, which passes this string through as `hypothesis_template`.
 */
export type Hypothesis = string;

/** The placeholder a hypothesis puts its label in. */
export const LABEL_PLACEHOLDER = '{}';

/**
 * One classification: a hypothesis, and the sentence each value is phrased as.
 *
 * The `Record` is what makes the vocabulary exhaustive at compile time, and it
 * is also what makes a swap trivial — a bench replaces the values, never the
 * keys.
 */
export type ChoiceTemplate<T extends string> = {
  readonly hypothesis: Hypothesis;
  readonly labels: Readonly<Record<T, string>>;
};

/**
 * A classification with a score below which its winner is not acted on.
 *
 * What "not acted on" means is the reader's business, and it is a different
 * thing in each of the three places this is used: for `features` the label is
 * taken as absent, for `sizeHint` the field is left off entirely, and for
 * `placeType` the answer is kept but marked untrusted. What is common — and
 * what this type is for — is that the number is *data*, sitting beside the
 * labels it was measured against, rather than a constant somewhere in a
 * function.
 */
export type GatedTemplate<T extends string> = ChoiceTemplate<T> & {
  /** At or above this score, the winning label is acted on. */
  readonly minConfidence: number;
};

/**
 * The noun `tavern_storeroom`'s label is built on.
 *
 * It is a constant rather than three syllables inside the label because
 * `synonyms.ts` has to rewrite "porão" and "adega" into *this exact word* to be
 * worth anything, and a second copy of it over there would go on pointing at
 * "depósito" long after a bench had moved the label to something else. The
 * other six words that layer needs are the feature labels themselves, which it
 * reads straight out of `FEATURE_TEMPLATE`.
 */
export const STOREROOM_WORD = 'depósito';

/**
 * Which of the three tavern spaces the description is about.
 *
 * `minConfidence` is the measured one: with these short labels the bench put
 * the AUC of confidence against correctness at 0.922 — the model's own
 * certainty really does tell a right answer from a wrong one — and a gate at
 * 0.55 accepted 13 of 20 descriptions, all 13 of them correct.
 *
 * **Nothing falls back yet.** There is no rule-based interpreter to fall back
 * *to*, so `readPlaceType` computes the gate, reports it, and the answer is
 * used either way. The number lives here so that the day that path is built, it
 * is built against a figure somebody measured.
 */
export const PLACE_TYPE_TEMPLATE: GatedTemplate<PlaceType> = {
  hypothesis: 'Este texto é sobre {}.',
  labels: {
    tavern_hall: 'salão de taverna',
    tavern_room: 'quarto de taverna',
    tavern_storeroom: `${STOREROOM_WORD} de taverna`,
  },
  minConfidence: 0.55,
};

/** How lit the place is. */
export const LIGHT_TEMPLATE: ChoiceTemplate<Light> = {
  hypothesis: 'A iluminação do lugar é assim: {}.',
  labels: {
    dark: 'escuridão total, não há luz nenhuma',
    dim: 'luz fraca, penumbra, meia-luz',
    bright: 'muita luz, o lugar é claro e bem iluminado',
  },
};

/**
 * How well kept the place is.
 *
 * This one carries more weight than the other three, because `clutter` is
 * derived from its whole distribution — see `CLUTTER_BY_CONDITION`.
 */
export const CONDITION_TEMPLATE: ChoiceTemplate<Condition> = {
  hypothesis: 'O lugar está {}.',
  labels: {
    tidy: 'limpo e arrumado',
    lived_in: 'usado, mas em ordem',
    disordered: 'bagunçado e desarrumado',
    ruined: 'destruído e em ruínas',
  },
};

/**
 * How large the place is — when the description says so at all.
 *
 * A classifier always returns a winner, so "the description did not mention a
 * size" cannot come back as an answer; it has to be read off the confidence.
 * A description that says nothing about size leaves these three labels roughly
 * tied, near a third each, so a threshold above a third is what turns a tie
 * into an absent `sizeHint` — and an absent `sizeHint` is a request the
 * resolver answers with its own default, which is the honest outcome.
 */
export const SIZE_HINT_TEMPLATE: GatedTemplate<'small' | 'medium' | 'large'> = {
  hypothesis: 'O lugar é {}.',
  labels: {
    small: 'pequeno',
    medium: 'de tamanho médio',
    large: 'grande',
  },
  minConfidence: 0.55,
};

/**
 * The seven features, as seven independent presence questions.
 *
 * Independent, not a choice between seven: a hall can have a bar *and* a hearth
 * *and* stairs, and forcing one winner would throw two of them away. The
 * pipeline is asked for this one with `multiLabel`, which scores each label on
 * its own instead of spreading one unit of probability across all seven.
 *
 * Each label is a bare noun and that is the measured shape, not laziness —
 * enriching them ("uma lareira acesa no canto") and adding alternatives
 * ("pilares ou colunas") were both tried and both scored worse. The words a
 * person might use *instead* of these seven are handled a layer earlier, in
 * `synonyms.ts`, where they cost nothing and cannot blur a label.
 *
 * The `Record<Feature, string>` is tied to `FEATURES` in `../vocabulary.ts`:
 * adding a word there stops this file compiling until it has a hypothesis here.
 */
export const FEATURE_TEMPLATE: GatedTemplate<Feature> = {
  hypothesis: 'O lugar tem {}.',
  labels: {
    bar: 'balcão',
    hearth: 'lareira',
    stairs: 'escada',
    pillars: 'pilares',
    alcove: 'alcova',
    shelving: 'prateleiras',
    bunks: 'beliches',
  },
  minConfidence: 0.5,
};

/**
 * How much loose stuff a place in each condition has underfoot.
 *
 * `clutter` is the one field of `Constraints` that is a number rather than a
 * word, and a zero-shot classifier cannot produce a number — it produces a
 * distribution over labels. So this front does not ask for `clutter` at all,
 * and the bench is why that is a saving rather than a shortfall: asking about
 * it directly topped out at 63% agreement, which is exactly what this table
 * gets for free, four forward passes and about 270 ms cheaper.
 *
 * The figures themselves are the bench's. They are read as an average weighted
 * by the whole condition distribution rather than as a lookup on the winner —
 * see `deriveClutter`, which explains why, and which is also what makes the
 * schema check in `constraintsFrom` able to notice scores that are not a
 * distribution at all.
 *
 * The map's own vocabulary says these two axes are separate — a swept room can
 * be crowded — and this front cannot honour that separation, because it has
 * only one of the two signals. That is a real difference from the LLM path,
 * where the prompt asks for the two independently, and it is written down here
 * rather than left for someone to discover from a suspiciously tidy map.
 */
export const CLUTTER_BY_CONDITION: Readonly<Record<Condition, number>> = {
  tidy: 0.1,
  lived_in: 0.35,
  disordered: 0.6,
  ruined: 0.85,
};

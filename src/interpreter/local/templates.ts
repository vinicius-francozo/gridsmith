/**
 * The hypotheses the local classifier is asked to judge, and nothing else.
 *
 * This file is data. It holds no logic on purpose, because the wording in it is
 * the one part of this front that is *provisional*: a bench is measuring which
 * phrasings a multilingual NLI model actually separates in Portuguese, and the
 * numbers below will be replaced wholesale. Everything here is therefore
 * written so that replacing it is editing strings in a map — never hunting a
 * hypothesis down inside a function.
 *
 * Two rules keep it that way, and the reviewer should hold this front to both:
 *
 * 1. **Every label map is an exact `Record` over a closed vocabulary.** A fourth
 *    kind of place, or an eighth feature, stops this file compiling rather than
 *    silently becoming a value the classifier is never asked about. That one is
 *    the compiler's, and `templates.test.ts` restates each vocabulary by hand so
 *    that a type and a template cannot drift together unnoticed.
 * 2. **No hypothesis or label string appears anywhere else in
 *    `src/interpreter/local/`** — a copy is a copy that silently stops matching
 *    when the bench replaces these. That one has no automated check and is
 *    stated rather than pretended: holding it would mean reading the front's
 *    own source files from a test, and this project has no `@types/node` for a
 *    test to do that with. It is a review item, and it is in the report.
 *
 * ## Why the labels are in Portuguese when the code is in English
 *
 * These are not identifiers and not screen text — they are the model's input,
 * the second half of an entailment pair whose first half is the game master's
 * own sentence. `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7` is trained
 * on cross-lingual NLI, so an English hypothesis against a Portuguese premise is
 * a case it has seen; but it is not the case it is strongest at, and the
 * descriptions this project is written for are Portuguese. Matching the premise
 * is the provisional choice, and it is one of the things the bench is measuring.
 *
 * *Known limitation, stated rather than hidden:* a description in a language
 * that is neither is judged against a Portuguese hypothesis. The model is
 * multilingual so this degrades rather than fails, but it degrades.
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
 * is also what makes a swap trivial — the bench replaces the values, never the
 * keys.
 */
export type ChoiceTemplate<T extends string> = {
  readonly hypothesis: Hypothesis;
  readonly labels: Readonly<Record<T, string>>;
};

/**
 * A set of independent yes/no judgements, with the score above which a `yes` is
 * taken to mean the thing is there.
 */
export type PresenceTemplate<T extends string> = ChoiceTemplate<T> & {
  /** At or above this score, the label is read as present. */
  readonly minConfidence: number;
};

/** Which of the three tavern spaces the description is about. */
export const PLACE_TYPE_TEMPLATE: ChoiceTemplate<PlaceType> = {
  hypothesis: 'Este texto descreve {}.',
  labels: {
    tavern_hall: 'o salão comum de uma taverna, onde as pessoas bebem e comem',
    tavern_room: 'um quarto de hóspedes de uma taverna, com cama',
    tavern_storeroom: 'o depósito ou a adega de uma taverna, com barris e engradados',
  },
};

/** How lit the place is. */
export const LIGHT_TEMPLATE: ChoiceTemplate<Light> = {
  hypothesis: 'A iluminação do lugar é {}.',
  labels: {
    dark: 'escura, quase sem luz nenhuma',
    dim: 'fraca, de penumbra',
    bright: 'clara e bem iluminada',
  },
};

/**
 * How well kept the place is.
 *
 * This one carries more weight than the other three, because `clutter` is
 * derived from its whole distribution — see `CLUTTER_BY_CONDITION`.
 */
export const CONDITION_TEMPLATE: ChoiceTemplate<Condition> = {
  hypothesis: 'O estado do lugar é {}.',
  labels: {
    tidy: 'limpo e arrumado, tudo no lugar',
    lived_in: 'usado no dia a dia, nem arrumado nem bagunçado',
    disordered: 'bagunçado, com coisas derrubadas e espalhadas pelo chão',
    ruined: 'arruinado, caindo aos pedaços, abandonado',
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
 *
 * The number is provisional in the strongest sense of anything in this file:
 * it is the one value here that decides *whether* a field exists.
 */
export const SIZE_HINT_TEMPLATE: PresenceTemplate<'small' | 'medium' | 'large'> = {
  hypothesis: 'O tamanho do lugar é {}.',
  labels: {
    small: 'pequeno e apertado',
    medium: 'de tamanho comum',
    large: 'grande e espaçoso',
  },
  minConfidence: 0.5,
};

/**
 * The seven features, as seven independent presence questions.
 *
 * Independent, not a choice between seven: a hall can have a bar *and* a hearth
 * *and* stairs, and forcing one winner would throw two of them away. The
 * pipeline is asked for this one with `multiLabel`, which scores each label on
 * its own instead of spreading one unit of probability across all seven.
 *
 * The `Record<Feature, string>` is tied to `FEATURES` in `../vocabulary.ts`:
 * adding a word there stops this file compiling until it has a hypothesis here.
 */
export const FEATURE_TEMPLATE: PresenceTemplate<Feature> = {
  hypothesis: 'O lugar tem {}.',
  labels: {
    bar: 'um balcão de servir bebidas',
    hearth: 'uma lareira',
    stairs: 'uma escada que sobe ou desce',
    pillars: 'pilares ou colunas sustentando o teto',
    alcove: 'uma alcova, um recanto recuado do ambiente',
    shelving: 'prateleiras ou estantes encostadas na parede',
    bunks: 'beliches, camas empilhadas',
  },
  minConfidence: 0.5,
};

/**
 * How much loose stuff a place in each condition has underfoot.
 *
 * `clutter` is the one field of `Constraints` that is a number rather than a
 * word, and a zero-shot classifier cannot produce a number — it produces a
 * distribution over labels. So this front does not ask for `clutter` at all. It
 * reads the condition distribution and takes the average of these four figures
 * weighted by it, which is a genuine derivation rather than a lookup: a
 * description the model reads as half `disordered` and half `ruined` lands
 * between the two, and one it is sure is `tidy` lands on 0.05.
 *
 * The map's own vocabulary says these two axes are separate — a swept room can
 * be crowded — and this front cannot honour that separation, because it has
 * only one of the two signals. That is a real difference from the LLM path,
 * where the prompt asks for the two independently, and it is written down here
 * rather than left for someone to discover from a suspiciously tidy map.
 */
export const CLUTTER_BY_CONDITION: Readonly<Record<Condition, number>> = {
  tidy: 0.05,
  lived_in: 0.3,
  disordered: 0.65,
  ruined: 0.85,
};

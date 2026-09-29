/**
 * The hypotheses the local classifier is asked to judge, and nothing else.
 *
 * The old bench measured a single choice among three tavern places. Its place
 * accuracy and confidence figures do not describe the building-then-room
 * classifier below. The light, condition, size and feature labels remain from
 * that bench; their wording is pinned by `templates.test.ts`.
 *
 * New building and room labels are short Portuguese phrases, like the old
 * labels, but have no accuracy measurement yet. `synonyms.ts` still rewrites
 * "porão" and "adega" toward `STOREROOM_WORD` for the tavern room label.
 * Descriptions in other languages are classified against Portuguese labels.
 */

import type { Building, Condition, Light, RoomKind } from '../../core/types';
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
 * Features below their threshold are absent; a size hint below its threshold
 * is omitted. Building and room have no confidence gate.
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
 * The two choices that locate a place. The old confidence result applied to
 * a single three-way tavern choice, not to these labels, so neither choice is
 * gated by it.
 */
export const BUILDING_TEMPLATE: ChoiceTemplate<Building> = {
  hypothesis: 'A construção é {}.',
  labels: {
    tavern: 'taverna',
    dungeon: 'masmorra',
  },
};

export const ROOM_TEMPLATES: Record<Building, ChoiceTemplate<RoomKind>> = {
  tavern: {
    hypothesis: 'O cômodo é {}.',
    labels: {
      hall: 'salão de taverna',
      room: 'quarto de taverna',
      storeroom: `${STOREROOM_WORD} de taverna`,
    },
  },
  dungeon: {
    hypothesis: 'O cômodo é {}.',
    labels: {
      hall: 'salão da masmorra',
      room: 'cela da masmorra',
      storeroom: 'arsenal da masmorra',
    },
  },
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
 * ("pilares ou colunas") were both tried and both scored worse. Some of the
 * words a person might use *instead* of these seven are handled a layer
 * earlier, in `synonyms.ts`, where they cannot blur a label — but they are not
 * free there either, and that file has had to take nineteen variants back out,
 * three whole families with them. (This said "two" while the sentence directly
 * after it named three, for four rounds of review.) **Three of these seven
 * labels have no synonym rule at all** — `hearth`, `pillars` and `alcove` lost
 * theirs to measurement — and the other four, `stairs`, `shelving`, `bunks`
 * and `bar`, still have one.
 * A word only goes there if every ordinary reading of it means the label *and*
 * the swap has been measured for what else it moves; the rest are left for the
 * classifier to miss.
 *
 * One of these seven labels is known to be contaminated and is not fixed:
 * "alcova" pulls `bunks` up with it. "Duas alcovas escuras se abrem no fundo."
 * scores `beliches` at 0.554 with no rewriting anywhere, and it is the first of
 * eight such sentences in which the raw premise puts `beliches` over the gate
 * **8 of 8**. (This said "seven", from a set nobody wrote down; the eight that
 * are written down give eight.) That is a property of this pair of labels, so it is written here
 * rather than in the layer that was wrongly blamed for it.
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
 * gets for free, four forward passes and about 105 ms cheaper.
 *
 * That 105 ms is the four-label question timed on its own, out of the same run
 * `pipeline.ts` quotes the 510 ms whole-description median from, on the same
 * machine and the same runtime. The two figures were measured together on
 * purpose: they used to be a 270 ms here and a 786 ms there, and nothing about
 * four passes out of twenty could make those two numbers both true.
 *
 * The figures themselves are the bench's. They are read as an average weighted
 * by the whole condition distribution rather than as a lookup on the winner —
 * see `deriveClutter`, which explains why, and which is also what makes the
 * schema check in `constraintsFrom` able to notice scores that are not a
 * distribution at all.
 *
 * The map's own vocabulary says these two axes are separate — a swept room can
 * be crowded — and this table is only one of them. It used to be both: until
 * `Constraints.furnishing` existed, the number below drove the count of
 * furniture groups as well as the loose stuff underfoot, so a description of a
 * ruin came back with nine war tables in it. The second signal is now
 * `FURNISHING_TEMPLATE`, a question of its own, and this table is back to
 * meaning what its name says.
 */
export const CLUTTER_BY_CONDITION: Readonly<Record<Condition, number>> = {
  tidy: 0.1,
  lived_in: 0.35,
  disordered: 0.6,
  ruined: 0.85,
};

/** How furnished a place is, in four ordered steps. */
export type FurnishingLevel = 'bare' | 'sparse' | 'furnished' | 'crowded';

/**
 * How much furniture stands in the place — asked apart from `condition`.
 *
 * The seventh classification, and the one that lets this front answer the two
 * axes the map declares rather than answering one and letting the other follow
 * it. The labels describe furniture on the floor and say nothing about how
 * clean it is, so that a sentence can come back ruined and nearly bare, which
 * is what a filthy ruin usually is.
 *
 * Ungated, like `CONDITION_TEMPLATE` and for the same reason: the answer is
 * read as a distribution rather than as a winner (`deriveFurnishing`), so there
 * is no winner to withhold. A description that says nothing about furniture
 * spreads across the four and lands in the middle, which is the honest reading
 * of a place nobody described the contents of.
 *
 * **No accuracy measurement.** Neither has `light`, `condition` or `size` — this
 * project has no gold for any of the four, and `CLUTTER_BY_CONDITION`'s own
 * figures are the old bench's. The labels are written in the shape the bench
 * found worked for the other scales (a short Portuguese phrase, no enrichment),
 * and that is the whole of the claim being made for them.
 *
 * The hypothesis is its own sentence and not `CONDITION_TEMPLATE`'s
 * `'O lugar está {}.'`, which would also have read correctly. Two templates
 * sharing a hypothesis is a hazard rather than a saving: `classify` names the
 * template it is asking about, but every stand-in classifier in the tests
 * dispatches on the hypothesis, and two questions answering to one string is a
 * silent wrong answer. `LIGHT_TEMPLATE` already carries the shape used here.
 */
export const FURNISHING_TEMPLATE: ChoiceTemplate<FurnishingLevel> = {
  hypothesis: 'A mobília do lugar é assim: {}.',
  labels: {
    bare: 'sem móveis, o chão está vazio',
    // No alternative inside a label — `templates.test.ts` holds every label to
    // that, and the rule is measured rather than stylistic.
    sparse: 'com pouca mobília, umas poucas peças',
    furnished: 'mobiliado, com mesas, bancos e caixotes',
    crowded: 'abarrotado de móveis, quase sem espaço livre',
  },
};

/**
 * What `Constraints.furnishing` is at each level.
 *
 * Read as an average weighted by the whole distribution, never as a lookup on
 * the winner — `deriveFurnishing` says why, and it is the same argument
 * `deriveClutter` makes about `CLUTTER_BY_CONDITION`.
 *
 * The four figures are the scale's own quarters, not a bench's: 0 for a room
 * with nothing in it and 1 for one with no floor left, evenly spaced between.
 * `CLUTTER_BY_CONDITION` does not start at 0 because a tidy room still has dust
 * in it; a bare room has no furniture, and that is a number this scale can
 * honestly reach.
 */
export const FURNISHING_BY_LEVEL: Readonly<Record<FurnishingLevel, number>> = {
  bare: 0,
  sparse: 1 / 3,
  furnished: 2 / 3,
  crowded: 1,
};

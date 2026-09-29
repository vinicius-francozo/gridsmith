/**
 * The twelve first-pass questions the Jev engine asks, and the numbers that read the
 * answers back. Data and room criteria — the reading itself is `read.ts`, and the call is
 * `jev.ts`.
 *
 * The first twelve questions go in one request. The second request asks only
 * for a room supported by the chosen building.
 *
 * The mapping onto Jev's three primitives is not one-to-one with
 * `local/templates.ts`, and the differences are the point:
 *
 * - `building` and `room` are **choices**: closed sets with no order.
 * - `light`, `condition` and `size` are **scores**, because their levels are
 *   ordered — dark < dim < bright, tidy < lived_in < disordered < ruined. A
 *   classifier had to treat them as unordered and throw that away.
 * - Each feature is its own **noul**: a proposition with a calibrated
 *   probability, which is the shape the multi-label pass was approximating.
 * - `out_of_vocabulary` is a noul the zero-shot path cannot express at all.
 *   `local/interpret.ts` says in its header why `Constraints.unresolved` is
 *   permanently empty there: asking which of three labels fits returns one of
 *   three, and there is no answer available that means "none of them". This
 *   question is the reason this engine exists.
 *
 * The questions are in Portuguese because the description is. Nothing here
 * reaches a person — `unresolved` and `conflicts` carry codes, and the wording
 * lives in the interface (`codes.ts:1-17`).
 */

import type { Building, Condition, Constraints, Light } from '../../core/types';
import { roomsFor } from '../../generator/profiles';
import type { Feature } from '../vocabulary';

/** A proposition, answered with a calibrated probability. */
export type JevNoulQuestion = {
  readonly type: 'noul';
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
};

/** A closed set with no order. Jev answers with one of the keys. */
export type JevChoiceQuestion = {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
};

/** An ordered scale. The criteria are the levels, in order, and Jev answers between them. */
export type JevScoreQuestion = {
  readonly type: 'score';
  readonly instructions: string;
  readonly criteria: readonly string[];
};

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

/**
 * Every question, as the `questions` map of one System One request.
 *
 * Written out rather than assembled, so that this file has no logic in it and
 * so that the twelve names a response is read by are visible in one place.
 */
export const QUESTIONS = {
  building: {
    type: 'choice',
    instructions: 'Que tipo de construção o texto descreve?',
    criteria: {
      tavern: 'Uma taverna ou estalagem para hóspedes, comida e bebida',
      dungeon: 'Uma masmorra, calabouço, prisão ou fortaleza subterrânea',
    },
  },
  out_of_vocabulary: {
    type: 'noul',
    instructions:
      'O texto descreve uma construção que NÃO é taverna nem masmorra?',
    criteria: {
      true: 'É outro tipo de construção ou espaço — uma ferraria, um pátio, uma floresta, qualquer coisa fora desta lista',
      false:
        'É uma taverna ou uma masmorra',
    },
  },
  light: {
    type: 'score',
    instructions: 'Quanta luz há no lugar?',
    criteria: [
      'Escuridão total, não há luz nenhuma',
      'Luz fraca: penumbra, meia-luz, uma vela ou brasa',
      'Muita luz: o lugar é claro e bem iluminado',
    ],
  },
  condition: {
    type: 'score',
    instructions: 'Em que estado de conservação está o lugar?',
    criteria: [
      'Limpo e arrumado',
      'Usado, mas em ordem',
      'Bagunçado e desarrumado',
      'Destruído e em ruínas',
    ],
  },
  size: {
    type: 'score',
    instructions: 'Que tamanho tem o lugar?',
    criteria: ['Pequeno', 'De tamanho médio', 'Grande'],
  },
  // Asked apart from `condition`, and the separation is the point: the two used
  // to be one number and a ruin came back full of war tables. The criteria name
  // furniture that stands on the floor and say nothing about how clean it is,
  // so that "destruído e em ruínas" and "quase sem móveis" can both be true of
  // the same sentence. A score rather than a noul because the levels are
  // ordered, which is the same reason `light`, `condition` and `size` are
  // scores. Like those three, it has no gold anywhere in this project and so no
  // accuracy measurement of its own.
  furnishing: {
    type: 'score',
    instructions: 'Quanta mobília há no lugar?',
    criteria: [
      'Nenhuma mobília: o chão está vazio',
      'Pouca mobília: uma peça ou outra',
      'Mobiliado: mesas, bancos e caixotes pelo cômodo',
      'Abarrotado de móveis, quase sem espaço livre',
    ],
  },
  // The seven features, one proposition each. The bench measured that
  // enriching the *instruction* is what ruins them: a disjunction like
  // "pilares ou colunas" fixes the synonym and breaks the literal, because it
  // redistributes probability mass instead of adding coverage. So the
  // instruction names the thing and the criteria carry the synonyms, which is
  // where a noul can hold them without making them compete.
  feature_bar: {
    type: 'noul',
    instructions: 'O lugar tem um balcão?',
    criteria: { true: 'Há um balcão, um bar, uma bancada de servir bebida', false: 'Não há balcão nenhum' },
  },
  feature_hearth: {
    type: 'noul',
    instructions: 'O lugar tem uma lareira?',
    criteria: {
      true: 'Há uma lareira, um fogo aceso, uma fogueira, um braseiro fixo no lugar',
      false: 'Não há fogo nenhum no lugar',
    },
  },
  feature_stairs: {
    type: 'noul',
    instructions: 'O lugar tem uma escada?',
    criteria: {
      true: 'Há uma escada, escadaria ou degraus que ligam níveis',
      false: 'Não há escada nenhuma',
    },
  },
  feature_pillars: {
    type: 'noul',
    instructions: 'O lugar tem pilares?',
    criteria: { true: 'Há pilares, colunas ou pilastras sustentando o teto', false: 'Não há pilar nenhum' },
  },
  feature_alcove: {
    type: 'noul',
    instructions: 'O lugar tem uma alcova?',
    criteria: {
      true: 'Há uma alcova, um nicho ou um recanto recuado na parede',
      false: 'Não há alcova nem nicho',
    },
  },
  feature_shelving: {
    type: 'noul',
    instructions: 'O lugar tem prateleiras?',
    criteria: { true: 'Há prateleiras ou estantes', false: 'Não há prateleira nenhuma' },
  },
  feature_bunks: {
    type: 'noul',
    instructions: 'O lugar tem beliches?',
    criteria: { true: 'Há beliches ou camas de dormir', false: 'Não há cama nem beliche' },
  },
} as const satisfies Readonly<Record<string, JevQuestion>>;

/** The name of a question in `QUESTIONS`, and so of an answer in a response. */
export type QuestionName = keyof typeof QUESTIONS;

const ROOM_CRITERIA = {
  tavern: {
    hall: 'Salão comum da taverna, com mesas, balcão e fregueses',
    room: 'Quarto de hóspedes da taverna, com cama',
    storeroom: 'Depósito, porão ou adega da taverna, com barris e mantimentos',
  },
  dungeon: {
    hall: 'Sala comum ou da guarda da masmorra',
    room: 'Cela ou quarto da masmorra, com catre',
    storeroom: 'Arsenal ou depósito da masmorra, com armas e caixotes',
  },
} as const;

export function roomQuestionFor(building: Building): { room: JevChoiceQuestion } {
  const criteria: Record<string, string> = {};
  for (const room of roomsFor(building)) {
    criteria[room] = ROOM_CRITERIA[building][room];
  }
  return { room: { type: 'choice', instructions: 'Qual cômodo desta construção o texto descreve?', criteria } };
}

/**
 * Which question answers each feature.
 *
 * Typed against `Feature` the way `FEATURE_PLACES` in `vocabulary.ts` is: a
 * word added to `FEATURES` does not compile until it has a question here, and
 * `QuestionName` is what stops the name on this side drifting from the name on
 * the other.
 */
export const FEATURE_QUESTIONS: Readonly<Record<Feature, QuestionName>> = {
  bar: 'feature_bar',
  hearth: 'feature_hearth',
  stairs: 'feature_stairs',
  pillars: 'feature_pillars',
  alcove: 'feature_alcove',
  shelving: 'feature_shelving',
  bunks: 'feature_bunks',
};

/**
 * The levels of each score question, in the order its criteria list them.
 *
 * The index Jev's score rounds to is an index into these, so an order that
 * disagrees with the criteria above is a silently wrong answer rather than a
 * failure. `questions.test.ts` holds each pair to the same length; the order is
 * only readable side by side, which is why they are next to each other.
 */
export const LIGHT_LEVELS: readonly Light[] = ['dark', 'dim', 'bright'];
export const CONDITION_LEVELS: readonly Condition[] = ['tidy', 'lived_in', 'disordered', 'ruined'];
export const SIZE_LEVELS: readonly NonNullable<Constraints['sizeHint']>[] = ['small', 'medium', 'large'];

/**
 * The top of `furnishing`'s scale, as an index into its criteria.
 *
 * `furnishing` is a 0..1 number and the question is a score over four ordered
 * criteria, so the reading is a division and this is its divisor. It is derived
 * from the question above rather than written as a 3, so that a criterion added
 * or removed there cannot leave the reading scaling against the old length —
 * the failure mode `LIGHT_LEVELS` and friends are held to by a test and this
 * one closes by construction.
 */
export const FURNISHING_TOP = QUESTIONS.furnishing.criteria.length - 1;

/**
 * How sure Jev has to be that a feature is there for it to be built.
 *
 * **This number is inflated and the ressalva is the point of writing it here.**
 * It was chosen on the same 28 sentences it is reported on — the neutral half
 * of the canonical ruler — so it is fitted to its own test set. What was
 * measured, on those 28: the zero-shot path scores F1 0.762, Jev at the
 * existing `FEATURE_TEMPLATE.minConfidence` of 0.5 scores 0.952, and Jev at
 * 0.62 scores 0.984. The plateau runs from 0.62 to 0.80, which is wide enough
 * that the choice inside it does not matter much — but a corpus whose gold has
 * been reviewed is what would make it a measurement rather than a fit.
 */
export const FEATURE_THRESHOLD = 0.62;

/**
 * At or below this, the description is read as saying the feature is **not**
 * there — not merely as failing to mention it.
 *
 * **Measured, and the measurement says the two do not fully separate.** Forty-one
 * sentences, every one of the seven nouls on each, against `jev-latest`
 * (`jev-1.13.0`) — twelve written for this with an explicit negation in them,
 * the canonical ruler's twenty-eight `features` sentences, and its standalone
 * negation control. The corpus and every number are in
 * `corpus-exclusao-jev.md`, which lives beside the canonical ruler outside this
 * repository for the reason that one gives. Three buckets, 20 · 227 · 33
 * observations:
 *
 * | | min | p25 | median | p75 | max |
 * | --- | --- | --- | --- | --- | --- |
 * | explicitly negated | 0.030 | 0.040 | **0.040** | 0.040 | 0.360 |
 * | not mentioned | 0.030 | 0.080 | **0.120** | 0.180 | 0.860 |
 * | present | 0.820 | 0.970 | **0.980** | 0.980 | 0.990 |
 *
 * Presence stands apart from both of the others; negation and silence overlap
 * along their whole lower tail. So 0.05 is chosen as a knee and not as a
 * separation: it catches 18 of the 20 negations, and every threshold from 0.06
 * to 0.20 catches those same 18 while excluding three to seven times as many
 * features nobody mentioned. Below it, 0.04 drops to 16 — and the two it drops
 * are `hearth` and `pillars` in `"Sem fogueira, sem colunas e sem escada."`,
 * both at 0.050, which is the ruler's own purest negation.
 *
 * **What it costs is 11% of the features a description never mentions**
 * (26 of 227), read as refused. That is the reason `excluded` is acted on and
 * never narrated — see `FEATURE_ALSO_EXCLUDED` in `codes.ts`. A wrongly refused
 * anchor is one the draw does not offer; a wrongly announced one is the tool
 * telling the person they said something they did not.
 *
 * The two negations it misses are worth naming, because both are the same
 * shape: `"a lareira foi arrancada e não há fogo nenhum"` at 0.230 and the
 * ruler's `"Não há fogo aqui, só cinzas frias"` at 0.360. A sentence that names
 * the thing while denying it scores far above one that only denies it.
 *
 * The comparison is `<=`, not `<`. Three of the twenty negations sit exactly on
 * 0.050, and the answers are quantised to a hundredth and repeat to within
 * about 0.01 over three runs, so the boundary is a value the model actually
 * returns rather than a gap between values.
 */
export const EXCLUSION_THRESHOLD = 0.05;

/**
 * How sure Jev has to be that the construction is outside the vocabulary before the map
 * carries a notice saying so.
 *
 * **Provisional, and the numbers that make it provisional belong next to it.**
 * The figures below came from the old three-place tavern vocabulary. They do
 * not measure the new building question. On the 46 descriptions the bench ran,
 * this threshold did *not* separate the
 * two halves: the lowest out-of-vocabulary answer is 0.730 and the highest
 * in-scope answer is 0.870, so no single number splits them. Four of the items
 * causing that overlap are sentences where **Jev is right and the ruler is
 * wrong** — it noticed the description never mentions a tavern, and the gold
 * assumed the context. With those four excluded the two halves separate
 * cleanly, anywhere between 0.53 and 0.73.
 *
 * 0.75 is therefore chosen to sit just above the contested band and keep the
 * notice rare, not because it was measured to be right. The gold for those 15
 * sentences was written for that bench and has never been reviewed; one of them
 * contradicts the canonical ruler outright. Remeasure when it has been.
 */
export const OUT_OF_VOCABULARY_THRESHOLD = 0.75;

/**
 * How sure Jev has to be about the size before the hint is passed on.
 *
 * Below it there is no `sizeHint` and the resolver uses its own default, which
 * is the honest outcome for a description that never said how big the place is.
 * The figure is `SIZE_HINT_TEMPLATE.minConfidence`, kept the same so the two
 * engines drop the hint at the same place — and it has no measurement of its
 * own on this side, because `light`, `condition` and `size` have no gold
 * anywhere in this project.
 */
export const SIZE_MIN_CONFIDENCE = 0.55;

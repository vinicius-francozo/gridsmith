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

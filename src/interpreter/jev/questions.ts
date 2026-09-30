/**
 * The sixteen first-pass questions the Jev engine asks, and the numbers that read the
 * answers back. Data and room criteria — the reading itself is `read.ts`, and the call is
 * `jev.ts`.
 *
 * All sixteen go in one request. The second request asks only for a room
 * supported by the chosen building.
 *
 * **Adding to this list does not dilute what is already in it**, and that was
 * measured before the last three were added rather than assumed. Each feature
 * is its own noul, so there is no unit of probability being shared out: the
 * same 41 sentences asked with seven feature questions and again with the
 * thirteen of production move by 0.006 on average, and asking them with these
 * sixteen moves the original seven by 0.0050 over 84 paired observations. What
 * a new word costs is a *pair* — the chance it collides with one word already
 * here — and the cost of a pair is paid at the wording, which is where
 * `feature_bed` below pays it.
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
import { placeWords, roomsFor } from '../../generator/profiles';
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
 * so that the thirteen names a response is read by are visible in one place.
 */
export const QUESTIONS = {
  /**
   * **This question had never been exercised with more than two options and is
   * being taken to ten.** Every criterion in it is measured, including the two
   * that were here before, and the numbers below are what chose these words
   * rather than describing them afterwards.
   *
   * **The shape that wins is the shortest one that names the place.** Every
   * criterion the plan for this front proposed carried a clause naming what is
   * *inside* the building, and every one of those clauses cost sentences:
   *
   * - `forge` as `'…onde se trabalha metal no fogo e na bigorna'` scores the
   *   canonical ruler's own negation control, *"Não há fogo aqui, só cinzas
   *   frias"*, at **0.81**. Naming the fire pulls a sentence that denies one.
   * - `ship` as `'…com porão de carga'` takes the trap sentence
   *   `porao-verbo-2` to **0.51** — the future of *pôr* against *porão*, the
   *   hold, which is the collision `read.ts` names in its own header.
   * - `temple` as `'…com altar e lugar de culto'` takes three crypt sentences,
   *   `k05` at **0.93**, because the building is chosen before the room and a
   *   catacomb reads as a place of the dead whichever way it is worded.
   *
   * **`dungeon` gains the word `cripta`, and it is the only criterion here that
   * existed before and changed.** The user approved it. With it the dungeon is
   * back to 15 of 15 and the six funerary sentences close — `k02` and `k03` at
   * 1.00, `k06` 0.99, `k04` 0.96, `k05` 0.80 — and `temple` stops winning any
   * sentence of the 46 at all, its mean mass falling from 0.065 to 0.007.
   *
   * Over the 46: **36 of 46**, against 38 of 46 on today's two options and 27
   * of 46 on the twelve the plan proposed. Two buildings were cut by the user
   * rather than reworded, because there was no wording that repaired them.
   *
   * **The two sentences the project answers today and will answer wrongly**,
   * measured and named rather than left to be found: `p07`, *"A despensa da
   * cozinha, com prateleiras de sacos e potes"*, goes to `apothecary` at 0.73,
   * and `p15`, *"Um aposento privado com cama de dossel e uma escrivaninha"*,
   * goes to `tower`. Both are the manor's absence rather than a wording defect
   * — a rich bedroom and a larder have nowhere else to go once the building
   * with the writing desk and the building with the pots on shelves are the
   * nearest two — and `tower` and `apothecary` are already in the minimal
   * shape. Recovering them means moving `tavern`, which is the user's to
   * decide.
   *
   * **The ruler for reading any number in this file.** Repeatability over ten
   * sentences: the choice is identical 10 of 10 runs, mean |Δ| 0.012, worst
   * 0.05. A difference of up to 0.05 on one sentence is noise.
   */
  building: {
    type: 'choice',
    instructions: 'Que tipo de construção o texto descreve?',
    criteria: {
      tavern: 'Uma taverna ou estalagem para hóspedes, comida e bebida',
      dungeon: 'Uma masmorra, calabouço, prisão, cripta ou fortaleza subterrânea',
      forge: 'Uma ferraria, forja ou oficina de ferreiro',
      temple: 'Um templo, igreja ou santuário de culto',
      library: 'Uma biblioteca ou um arquivo de livros',
      tower: 'A torre de um mago ou feiticeiro',
    },
  },
  /**
   * **Reworded, measured, and the measurement is the reason it is not simply
   * the old sentence with ten more nouns in it.**
   *
   * Over 87 sentences, false notices fall from **31 of 87 to 0 of 87** and the
   * highest answer over all 87 falls from 0.98 to 0.72, so
   * `OUT_OF_VOCABULARY_THRESHOLD` holds at 0.75 without being re-fitted. On the
   * 46 of the building corpus the same comparison is **0 of 46 against 21 of
   * 46**, with the same 0.72 ceiling.
   *
   * The obvious alternative — keep today's instruction and scale the list —
   * was measured beside it and **failed**: 7 of 18 over the threshold against 0
   * of 18 for this. It is `feature_pillars`' lesson reproduced on the building
   * axis, and the one written above `feature_bar` below: enriching the
   * *instruction* redistributes probability mass, and the list belongs in the
   * criteria where a noul can hold it without making the words compete.
   *
   * **The list names ten buildings and four of them do not exist yet.** Mina,
   * navio, botica and antro arrive with the next front, and the sentence is not
   * trimmed to six because it was measured as this sentence — dropping the two
   * the user cut was itself remeasured rather than assumed harmless, which is
   * the reason to be careful about dropping four more. What it costs until then
   * is the notice: a description of a ship is read as in the catalogue and is
   * built as the nearest building there is, with nothing said. That is a worse
   * failure than a false notice and it is temporary, so it is written here
   * rather than traded silently for a sentence nobody has measured.
   */
  out_of_vocabulary: {
    type: 'noul',
    instructions: 'O texto descreve um tipo de construção que não está no catálogo?',
    criteria: {
      true: 'É outro tipo de construção ou espaço — um pátio, um mercado, uma floresta, um estábulo, qualquer coisa fora do catálogo',
      false:
        'É uma taverna, uma masmorra, uma ferraria, um templo, uma biblioteca, uma torre de mago, uma mina, um navio, uma botica ou um antro de ladrões',
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
  // The ten features, one proposition each. The bench measured that
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
  // **The `false` criterion names the bunk, and that is a measurement rather
  // than a flourish.** Written `'Não há cama nenhuma'`, this noul scored the
  // four sentences of the corpora that describe bunks at 0.970–0.980 — above
  // the presence gate, alongside `feature_bunks` itself at 0.980–0.990. That is
  // the `alcova`/`beliches` collision the local engine already carries, and it
  // is worse here than there: `anchorOrder` puts *every* requested anchor at
  // the front of the order without trimming to `wanted`, and a guest room
  // declares `bed` and `bunks` as separate slots, so "dois beliches" would have
  // drawn the guest bed as well. Naming the bunk on the `false` side takes
  // those four to 0.420–0.490 and leaves presence where it was — the lowest of
  // the eight sentences that do ask for a bed moved 0.930 to 0.920 — and moves
  // the other nine nouls by 0.0061 on average over 153 observations. It is the
  // same shape `feature_bunks` uses from the other side.
  //
  // **One ressalva on where the rest of this word's evidence comes from.** The
  // second wording was measured on seventeen sentences. The full sweep of the
  // corpora was run with the **first** one and carries it that way in its own
  // record, and that sweep is what every `|allowed|` figure in this project is
  // computed from. The two written down in `generator/profiles.ts` — the crypt
  // and the dungeon hall — do not read this word's column at all, because
  // neither room declares a `bed` slot. The two that do are the guest room and
  // the cell, and their figures carry the **first** wording.
  //
  // Nothing in them should move: the change takes the bunk sentences from 0.97
  // to 0.42, and an exclusion is read at 0.05 — none of the seventeen comes
  // within 0.37 of it. But the lastro is the first wording, and that is said
  // here rather than assumed.
  feature_bed: {
    type: 'noul',
    instructions: 'O lugar tem uma cama?',
    criteria: {
      true: 'Há uma cama, um catre, um leito ou um colchão de dormir',
      false: 'Não há cama nenhuma, ou o que há para dormir é um beliche',
    },
  },
  feature_weapons: {
    type: 'noul',
    instructions: 'O lugar tem armas?',
    criteria: { true: 'Há armas, um suporte de armas ou um arsenal', false: 'Não há arma nenhuma' },
  },
  feature_tomb: {
    type: 'noul',
    instructions: 'O lugar tem um túmulo?',
    criteria: {
      true: 'Há um túmulo, um sarcófago, uma lápide ou uma sepultura',
      false: 'Não há túmulo nenhum',
    },
  },
} as const satisfies Readonly<Record<string, JevQuestion>>;

/** The name of a question in `QUESTIONS`, and so of an answer in a response. */
export type QuestionName = keyof typeof QUESTIONS;

/**
 * The second request: which room of `building` the description is.
 *
 * The criteria are not a table in this file any more. Each one lives on the
 * room's own entry in the registry (`BUILDINGS` in `generator/profiles.ts`),
 * beside the name the interface prints and the label the local engine scores,
 * so a room a building declares carries its wording or does not compile. What
 * that cannot reach is a pair arriving from outside the type system, which is
 * what the throw below is still for.
 *
 * @throws {Error} if `building` declares a room the registry has no criterion
 *                 for.
 *                 The alternative is an `undefined` criterion travelling into
 *                 the request body, where `JSON.stringify` drops the key
 *                 entirely — so Jev would be asked to choose between the rooms
 *                 that happened to have wording, and answer confidently from
 *                 the wrong set. The room would still be in `roomsFor`, so
 *                 `read.ts` would accept whatever came back.
 */
export function roomQuestionFor(building: Building): { room: JevChoiceQuestion } {
  const criteria: Record<string, string> = {};
  for (const room of roomsFor(building)) {
    const criterion = placeWords(building, room)?.criterion;
    if (criterion === undefined) {
      throw new Error(`no room criterion for '${building}_${room}'`);
    }
    criteria[room] = criterion;
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
  bed: 'feature_bed',
  weapons: 'feature_weapons',
  tomb: 'feature_tomb',
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
 *
 * **Taken with the seven feature questions alone, and taken again with the
 * thirteen this engine actually sends.** A noul that moved with its neighbours
 * would have made the corpus a measurement of the harness. Across the 287
 * observations the mean move is 0.006 and the largest is 0.080, and three
 * verdicts flip — each of them a single hundredth across this very boundary,
 * and none of them anywhere near the presence bucket. Nothing above changes:
 * the same medians, the same 18 of 20 at 0.05, the same knee, and still two
 * negations sitting exactly on 0.050, so `<` would still cost two of them.
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

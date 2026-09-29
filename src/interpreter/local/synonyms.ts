/**
 * The words a person writes, rewritten into the words the model was asked
 * about — before the model is asked anything.
 *
 * The place accuracy and confidence figures below were measured with the old
 * single three-place tavern classifier. They do not measure the current
 * building-then-room classifier or its dungeon labels.
 *
 * ## Why this layer exists at all
 *
 * Every mistake the winning model made on the bench was a synonym, and nothing
 * else. All three `placeType` errors in twenty descriptions were the same word
 * in three disguises — "porão onde guardam os barris", "adega", "porão de
 * taverna" — every one of them read as `tavern_hall`. A model that is wrong
 * only about vocabulary does not need a bigger model. It needs a dictionary,
 * and a dictionary costs no milliseconds and no megabytes.
 *
 * **Neither `features` error the bench found is repaired here any more, and
 * there is no longer a rule for either label.** They were "fogo aceso" not
 * reaching `hearth` and "colunas de madeira" not reaching `pillars`. Rules for
 * "fogo" and "coluna" did repair both. Measured on `f06`, the corpus row that
 * carries both words — "Há um fogo aceso no canto e colunas de madeira
 * sustentando o teto.", gold `hearth` and `pillars` — the rewrite took `hearth`
 * from 0.023 to 0.991 and `pillars` from 0.296 to 0.968, turning the one
 * description in the set that scored *nothing* into an exact match. The same
 * two rules then fired on seven sentences with no hearth and no pillars in
 * them, every one past the gate.
 *
 * (Those two figures used to be quoted as 0.018 → 0.973 and 0.181 → 0.972, with
 * no sentence beside them, and a later harness could not reproduce them on any
 * candidate. They are replaced by numbers that name the row they were taken on.
 * Nothing in this file should quote a score it cannot say the sentence for.) The gains
 * went. What was left of those two families then failed for its own reasons,
 * one variant at a time, until both families were empty; the four ways that
 * happened are written out under `SYNONYM_RULES`. The principle that decided
 * the first removal, and that the next person should weigh a rule against
 * before adding one:
 *
 * > A false positive draws furniture nobody asked for and you see it
 * > immediately. A false negative only omits.
 *
 * A map with a fireplace that the description never mentioned is wrong in a way
 * the person has to notice and undo. A map missing a fireplace they did mention
 * is a map they can look at and ask for again. Those are not the same cost, so
 * they are not traded one for one.
 *
 * It also buys back a trade that looked unavoidable. `templates.ts` explains
 * it: the long label "depósito ou adega" scored better and *flattened the
 * confidence*, which would have cost the gate that makes confidence worth
 * reading. With "porão" and "adega" already rewritten by the time the model
 * sees the sentence, the short label is no longer the worse one.
 *
 * ## Two rules this layer is written under
 *
 * **It never touches what the person wrote.** `normalizeForClassifier` returns
 * a record, not a string: `original` is the sentence exactly as it was typed,
 * `text` is the premise to classify, and `applied` is what changed between
 * them. Nothing in this front writes over a description — it is the one thing
 * here that cannot be recomputed.
 *
 * **It substitutes in place and never appends.** That is what keeps negation
 * working, and negation is worth keeping: the bench put "o salão não tem
 * lareira, mas tem um balcão" through the model and got `hearth` at 0.01. A
 * layer that collected the words it recognised and stuck them on the end would
 * turn that sentence into one that mentions a hearth in the clear, and the 0.01
 * would be gone. Swapping one noun for another leaves every "não", every "sem"
 * and every clause boundary exactly where the person put it.
 *
 * ## What it deliberately does not do
 *
 * - **One word at a time.** Every synonym the bench actually caught is a single
 *   noun, and a phrase matcher would have to decide what to do about overlaps
 *   to buy nothing measured.
 * - **No agreement repair.** "um beliche" becomes "um beliches", which is not
 *   Portuguese. It is also a premise that now contains the word the model is
 *   being asked about, which is the whole point; teaching this layer gender
 *   would be a grammar engine to fix an adjective the classifier is not reading
 *   for its endings.
 * - **No rules for `light`, `condition` or `size`.** The bench recorded no
 *   vocabulary errors in those three, so no rule here targets them. They are
 *   exposed to it all the same: all five questions are asked about the
 *   *rewritten* premise, so every swap reaches them too. Measured over the
 *   twenty bench descriptions, the layer rewrites five of them and not one of
 *   the sixty `light`/`condition`/`size` answers **this front emits** changes.
 *   Read on the argmax instead, two of the sixty do move: `size` on M4 (`small`
 *   0.428 → `medium` 0.447) and on H1 (`small` 0.413 → `medium` 0.369). Both
 *   sit under the 0.55 gate on both sides, so `sizeHint` comes back absent
 *   either way and the emitted answer is the same. The distinction is worth the
 *   sentence because this file scores `placeType` on the argmax precisely
 *   *because* the gate is reported rather than obeyed there. The scores do move —
 *   the largest single one by 0.100, `size`/`small` on H1 from 0.413 to 0.313 —
 *   and the closest call among the five was a 0.010 margin between `dark` and
 *   `dim`, which the rewrite widened to 0.015 rather than tipping it. So: exposed, and
 *   measurably undamaged on this corpus, which is not a promise about another.
 *
 * ## The risks it takes, written down
 *
 * **It reads no context at all**, so a word that means the storeroom rewrites
 * to the storeroom word wherever it sits. "um salão com uma escada que desce
 * para o porão" is a hall, and this layer hands the classifier a sentence
 * saying "depósito" — pushing the very question it was built to fix the other
 * way. The bench measured the gain on descriptions *of* cellars and did not
 * measure this loss, so the honest statement is that it is a trade whose other
 * half is unmeasured. It is bounded, though: every rewrite is one noun for one
 * noun, the sentence still says the place is a "salão", and the classifier is
 * reading the whole of it.
 *
 * **The one rule that names a kind of place is asymmetric, and all of the
 * measured `placeType` damage ran its way.** It pushes *towards* "depósito" —
 * "porão", "adega", "despensa", "armazém" — and nothing pushes towards "salão"
 * or "quarto": "taberna", "botequim", "estalagem" and "sala" are not normalised
 * at all. A review that found 3 `placeType` regressions found all 3 leaning
 * storeroom. That is not chance, it is the shape of the table. Adding hall and
 * room families would balance it; none has been measured, so none is here.
 *
 * **That is a fact about one rule out of five, and not about the layer.** The
 * other four rewrite features, seven variants between them, and `placeType` is
 * asked about the same rewritten premise — so they move it too, in whatever
 * direction the new word happens to pull. Measured: "Um quarto de hóspedes com
 * uma estante ao lado da cama." becomes "...com uma prateleiras...", and
 * `tavern_storeroom` goes 0.286 → 0.228 while `tavern_room` goes 0.568 →
 * 0.586. The layer moved an answer *away* from the storeroom. Read the
 * paragraph above as a claim about the whole table and it says that cannot
 * happen; it is a claim about four nouns.
 *
 * (These counts have gone stale three times now, each time left behind by a
 * commit that removed rules without recounting the prose around them. The third
 * time is worth the extra sentence: the shape test in `synonyms.test.ts` was
 * already asserting the right **seven**, while this paragraph and that test's
 * own comment both went on saying eight. A guard the prose beside it
 * contradicts is a guard nobody reads. They are five, four, seven and four, and
 * `synonyms.test.ts` holds each of them.)
 *
 * **False positives on `features` are the failure mode this layer reintroduces
 * most easily.** The risk above is about `placeType`, and it does not cover
 * them. Nineteen variants have been removed over three rounds, and it is worth
 * being exact about why, because "they all made false positives" is not true:
 * sixteen went for a false positive of one kind or another, and three —
 * "alcovas", "pilar", "estantes" — went for **measured null or one-for-one
 * value**, which is a different finding and a different test. All five reasons
 * are named under `SYNONYM_RULES` below. Any variant added later can bring the
 * false positives back, and they will not show up in a `placeType` count.
 *
 * ## What this layer is actually worth, measured
 *
 * On the 59-description corpus, with the hypotheses and thresholds read out of
 * `templates.ts` and `placeType` scored on the argmax, because `readPlaceType`
 * reports the gate rather than obeying it:
 *
 * - **`placeType`, 31 descriptions: 27/31 without this layer, 28/31 with it.**
 *   Two repaired (p03, p16, both storeroom words) and one broken (the "porão"
 *   verb collision). **Net +1.**
 * - **`features`, 28 neutral descriptions: 17/28 exact sets without this layer,
 *   17/28 with it.** **Net zero.** At the label level it recovers one feature
 *   (g15's `stairs`) and invents one (f10's `alcove`).
 *
 * **So the measured value of this whole file is one `placeType` answer, and the
 * `depósito` family carries all of it.** The four feature rules that remain buy
 * nothing on this corpus that they do not also give back.
 *
 * **Do not quote the F1 here as the score.** It moves 0.746 → 0.754, and it
 * moves only because F1 weighs a recovered feature and an invented one exactly
 * the same — which is the trade this front explicitly refuses. The rule it was
 * given is that a false positive draws furniture you have to notice and undo
 * while a false negative only omits. Under that rule, one for one is not an
 * improvement, and the exact-set count that says 17/28 either way is the honest
 * number.
 *
 * **The one invented label is `alcove`, and no rule here is about alcoves** —
 * "adega" → depósito pushes it over the gate on f10. That is failure mode 4
 * below, and on this corpus it accounts for every false positive the layer
 * adds.
 *
 * ## What the removals cost, which is not nothing
 *
 * Three tables have been measured on the same 28 neutral descriptions, and the
 * middle column is the one this file used to quote:
 *
 * | table | exact | TP | FP | FN |
 * |---|---|---|---|---|
 * | no layer | 17/28 | 22 | 7 | 8 |
 * | 7 rules, 21 variants (`f188bcd`) | 17/28 | 25 | 10 | 5 |
 * | 5 rules, 16 variants (`5af7182`) | 17/28 | 24 | 9 | 6 |
 * | 5 rules, 15 variants (here) | 17/28 | 23 | 8 | 7 |
 *
 * Every step down that column **paid a true positive for a false one**:
 *
 * - Dropping "fogueira" cost g02. "No canto arde uma fogueira baixa, e há
 *   bancos em volta." answered `[bar, hearth]` with the rule and answers
 *   `[alcove]` without it — the `hearth` is this project's own gold, and it is
 *   gone. The false `bar` went with it. (The `alcove` is there on both sides
 *   and is a raw model defect, not this layer's doing.)
 * - Dropping "pilastras" cost nothing and killed g14's false `shelving`.
 * - Dropping "estantes" cost g05's true `shelving` and killed the false
 *   `alcove` it brought with it, in that one sentence — one for one.
 *
 * All three were judged right under the principle above, and all three are
 * losses as well as gains. `placeType` stayed at 28/31 through every step.
 *
 * One thing the adversarial sentences are **not** evidence of: the table as it
 * now stands rewrites none of the twelve adversarial probes, their negation
 * control, or the four sentences that removed this round's variants — so its
 * column there is the no-layer baseline rather than a defence the layer mounts.
 * The removals did not *close* those false positives; they stopped opening
 * them. (An independent harness testing a different set of seventeen found one
 * it does rewrite, "Um quarto de hóspedes com uma estante ao lado da cama." —
 * which is why the set is named here instead of counted.)
 */

import { FEATURE_TEMPLATE, STOREROOM_WORD } from './templates';

/** One family of words, and the single word the model knows the family by. */
export type SynonymRule = {
  /** What the description is rewritten to say. A word the templates use. */
  readonly canonical: string;
  /** The words rewritten into it. Compared without case or accents. */
  readonly variants: readonly string[];
};

/** One rewrite that happened, in the order it was met. */
export type AppliedSynonym = {
  /** The word as the person wrote it, case and accents included. */
  readonly found: string;
  /**
   * The rule's canonical word, as `SYNONYM_RULES` spells it.
   *
   * Not necessarily character for character what landed in the text: a swap for
   * a capitalised or a shouted word wears that word's case. This is the stable
   * name of the rule that fired, which is the useful thing to carry.
   */
  readonly canonical: string;
};

/** A description, and the version of it the classifier is shown. */
export type Normalized = {
  /** Exactly what was typed. This layer never rewrites it. */
  readonly original: string;
  /** The premise to classify: `original` with every known synonym swapped. */
  readonly text: string;
  /** Every swap, in the order they occur in the text. Empty when none did. */
  readonly applied: readonly AppliedSynonym[];
};

/**
 * Every family, with the word the model knows it by taken from the templates.
 *
 * Taken and not retyped: `FEATURE_TEMPLATE`'s labels *are* these bare nouns, so
 * reading them from there is what stops this file rewriting descriptions
 * towards a word the classifier stopped being asked about. `STOREROOM_WORD`
 * exists in `templates.ts` for the same reason — the place-type label is a
 * phrase, and this layer needs the noun out of it.
 *
 * The first rule is the one the bench measured a gain on; the rest are the same
 * families in other numbers — plurals, singulars, and the everyday word for the
 * same object. What each variant has to satisfy to be here is below, and it has
 * been tightened twice.
 *
 * ## Five ways a variant turns out to be wrong, all of them found the hard way
 *
 * **Nineteen variants have been admitted and measured back out**, in three
 * rounds, and the five failure modes are different enough that the next person
 * needs all five names. Three whole rules died in the process: there is no
 * `hearth` family, no `pillars` family and no `alcove` family left, and the
 * count of what survives is five rules and fifteen variants.
 *
 * That "three" said **two** for four rounds of review, and four independent
 * places said otherwise the whole time: the last line of `SYNONYM_RULES`
 * (`// There is no alcove rule.`), the paragraph closing mode 5, the label
 * sentence in `templates.ts`, and a test in `synonyms.test.ts` — the one
 * checking the sentence `templates.ts` states — which already counted three
 * feature labels with no rule, with the literal 3 in it. The arithmetic closes
 * it too: seven feature labels plus `depósito` is eight rules possible, five
 * survive.
 *
 * **Why it survived is worth being exact about, because the obvious answer is
 * wrong.** It is not that the data went unguarded. A test asserting three had
 * been standing the whole time. The drift was **prose against prose**: this
 * sentence and the test that contradicted it are in different files, and no
 * assertion can fail because a paragraph somewhere else says "two". Nothing
 * mechanical was ever going to catch it. What caught it — four times, each time
 * a different reader — was somebody checking the prose against the data by
 * hand, and that remains the only thing that will.
 *
 * The guard added below is kept for a narrower claim than that. It names the
 * three dead canonicals rather than the four live ones, and it counts over all
 * eight labels a rule could exist for rather than the seven features, so a
 * removal in the `depósito` family is in its scope too. It does not stop the
 * next false sentence; it makes one more of them a compile-and-run failure
 * instead of a reading failure.
 *
 * Each mode was found by a *different question*, and the questions are the
 * reusable part — reading the table against the previous mode's question never
 * found the next one. Modes 4 and 5 were counted as one for a whole round,
 * because they both look like "the rule was fine and went anyway"; they are not
 * the same thing and they are not found by the same test.
 *
 * **1. Quasi-objects.** *Is this word nearly the label?* — "degrau", "chaminé",
 * "braseiro" and their plurals, six variants. A step is not a staircase, a flue
 * is not a fireplace, a brazier is not a hearth, and each rewrote a sentence
 * into one that asserts the hypothesis outright: "O salão tem um único degrau na
 * entrada, e nada mais." took `stairs` from 0.325 to 0.983, "Um quarto pequeno
 * com uma chaminé fria de tijolos atravessando a parede." took `hearth` from
 * 0.082 to 0.988, "O quarto é aquecido por um braseiro de ferro no canto." took
 * `hearth` from 0.134 to 0.971.
 *
 * **2. Nominal polysemy.** *What else can this word mean?* — "fogo", "fogos",
 * "coluna", "colunas", and later "fogueira" and "fogueiras". Not near-things at
 * all: ordinary nouns with a second, commoner reading that has nothing to do
 * with the label, which prose reaches for constantly.
 *
 * - "O fogo destruiu metade do salão no ano passado." took `hearth` from 0.008
 *   to 0.956. The fire is the thing that burned the place down.
 * - "Uma coluna de fumaça sobe da cozinha ao lado." took `pillars` from 0.020
 *   to 0.971. The column is made of smoke.
 * - "As fogueiras de São João ardem na praça da vila." took `hearth` from 0.086
 *   to 0.984 — and dragged `pillars` to 0.650 and `shelving` to 0.663 with it.
 *   "O herege foi queimado na fogueira diante da igreja." took it from 0.059 to
 *   0.935. A bonfire in a square is not a fireplace in a room.
 *
 * **"fogueira" survived the round that killed "fogo" because this file asserted
 * it had only one reading.** That sentence was written from the writer's own
 * usage and never measured; the two above have the same shape and the same
 * magnitude as the ones that convicted "fogo". No claim of the form "this word
 * has only one reading" belongs here again unless a measurement is beside it.
 *
 * **3. A correct rule feeding a contaminated label.** *Is the label itself
 * clean?* — "nicho" and "nichos". Not polysemy: a niche really is an alcove and
 * the rewrite was right. The damage came from the other end — the label "alcova"
 * pulls `beliches` up with it, so recovering a true `alcove` lit a false
 * `bunks`, in 4 sentences of 4, over the gate in 3 ("No fundo do salão há um
 * nicho com uma estátua." 0.489 → 0.879).
 *
 * **That contamination is a known defect and removing the rule did not fix
 * it.** It is in the label pair, not in any rule: across eight sentences
 * containing "alcovas" — the set in the collateral corpus, of which "Duas
 * alcovas escuras se abrem no fundo." at 0.554 is the first — the raw premise
 * puts `bunks` over the gate in **8 of 8**, with no layer at all. (This used to
 * read "a further eight", which made it nine; and `templates.ts` used to quote
 * "seven of eight" from a different, unregistered set. One set, one number,
 * 8 of 8.) Dropping "nicho" narrowed the exposure and never
 * touched the cause. Nothing in this front fixes it; `templates.ts` records it
 * beside the labels that cause it, and a bench on the label wording is where a
 * fix would start.
 *
 * **4. Collateral drag.** *What else moves when this word is swapped?* — the
 * mode the admission rule below is structurally unable to catch, because the
 * rule is written per variant and per label while the rewrite changes the whole
 * sentence. A variant can satisfy every word of it and still push some *other*
 * label over the gate.
 *
 * Measured on the table of `f188bcd` (7 rules, 21 variants), which is where the
 * mode was found: of the five neutral descriptions whose `features` set moved,
 * **four moved a label that was not the firing rule's** — "adega" → depósito
 * lighting `alcove`, "fogueira" → lareira lighting `bar`, "estantes" →
 * prateleiras lighting `alcove`, "pilastras" → pilares lighting `shelving`.
 * Three of those four **variants** have since been removed. Variants, not
 * rules: only two rules died of this mode, and read as a claim about rules the
 * sentence is false. "adega" is the one of the four that stayed, and it is the
 * one still firing on f10 in the paragraph below.
 *
 * On the table as it stands, two descriptions move their set and **one of the
 * two is still collateral drag**: f10, where "adega" → depósito lights
 * `alcove`. That single case is the whole of the false positives this layer
 * adds. The mode is narrower than it was and it is not gone.
 *
 * "pilastra" and "pilastras" were removed for this, and for a second reason
 * that is worse: they contradict this project's own gold. The bench's `g14`
 * expects only `bar` precisely *because* a pilaster is an ornament flat against
 * a wall rather than a free-standing pillar — and the rule rewrote it to
 * "pilares" anyway. On the ornament case the only measured effect was a false
 * `shelving`, 0.214 → 0.507.
 *
 * **5. Measured null, or one-for-one, value.** *Does it change any decision, and
 * at what price?* — three variants passed every test above and went anyway,
 * because the gate is what matters and they never moved it, or moved it both
 * ways at once. This is not a false-positive test and no amount of reading the
 * table finds it; it needs the counterfactual measured.
 *
 * - **"alcovas"**: across eight sentences it moved `alcove` from an
 *   already-correct 0.878–0.966 to 0.937–0.985 and crossed the gate **zero
 *   times**. The model reads that plural against the singular label perfectly
 *   well — unlike "escadas" against "escada", which crosses from 0.100 to 0.990
 *   and is why that rule exists.
 * - **"pilar"**: measured alone after the rest of its family went. Ten
 *   sentences — eight that contain a pillar, `pillars` 0.830–0.971 raw and
 *   0.897–0.988 rewritten, and two that use the verb "to pound" — **zero gate
 *   crossings in all ten**, no collateral drag. An independent harness repeated
 *   this on its own ten sentences and also found zero.
 * - **"estantes"**: the marginal one, and reversible. It bought g05's true
 *   `shelving` and g05's false `alcove`, in the same sentence — TP 24 → 23, FP
 *   9 → 8, FN 6 → 7, exact sets 17/28 unchanged. One for one, and under this
 *   front's rule a false positive costs more than a false negative, so it went.
 *   The singular **"estante" stays**: it moves nothing at all on this corpus,
 *   and outside it, it buys a real crossing — "Uma estante de pinho encosta na
 *   parede." takes `shelving` from 0.332 to 0.974. The two are not one case,
 *   and they were confused for one before being measured apart.
 *
 * A rule that changes no decision is worse than no rule, because it reads as
 * coverage. That is why **`pillars` and `alcove`** have no family left at all:
 * what survived the first four modes then failed this one, and "pilar" and
 * "alcovas" are two of the three variants named just above.
 *
 * This sentence named `hearth` too, for four rounds, and that was never true —
 * no word for a fireplace appears in this mode's three. The `hearth` family
 * died earlier and entirely: four of its eight variants under mode 1
 * ("chaminé", "chaminés", "braseiro", "braseiros") and four under mode 2
 * ("fogo", "fogos", "fogueira", "fogueiras"). Nothing of it ever reached this
 * test. Three families are gone; they did not all go the same way.
 *
 * The verb reading of "pilar" is a model defect and not a rule defect, and that
 * is measured twice: "A cozinheira começou a pilar o alho no almofariz." scores
 * `pillars` 0.819 **without any layer**, and "Ele passou a tarde a pilar milho
 * no pilão." scores 0.935. Both are wrong before this file does anything.
 *
 * ## The rule a variant is admitted under, and where it is knowingly bent
 *
 * A variant has to be a noun whose *ordinary* readings all mean the label — not
 * "can mean", "all mean" — **and** the swap must be measured for what else it
 * moves. "bancada" is not here because a workbench in a cellar is not a bar.
 *
 * **Three of the fifteen survivors do not fully meet the first half, and are
 * kept knowingly.** Saying so is the point: a rule nobody admits to bending
 * stops being a rule.
 *
 * - **"adega"** and **"armazém"** also name shops. "Ele foi à adega da esquina
 *   comprar uma garrafa." moves `tavern_storeroom` 0.380 → 0.714 and "O armazém
 *   da esquina vende farinha, sal e querosene." moves it 0.388 → 0.845. They
 *   stay because the second reading is still a place things are stored in, so
 *   the answer lands in the right neighbourhood, and because these two are
 *   inside the only family with a measured net gain.
 * - **"estante"** is also a music stand: "O menestrel apoiou a partitura numa
 *   estante de música." moves `shelving` 0.656 → 0.957. It stays because the
 *   raw premise was already over the gate — the rule is not what puts the
 *   shelving there — but it is a false positive the model finds without help,
 *   not a clean variant. This bend belongs to the **singular**; the plural
 *   "estantes" was removed under mode 5, for something else entirely, and the
 *   two were blamed on each other once before being measured apart.
 *
 * **One variant collides with a verb and stays.** "porão" is also the future
 * indicative of *pôr*. Measured: "Eles porão as mesas no salão antes de abrir a
 * taverna." goes from `tavern_hall` at 0.680 to `tavern_storeroom` at 0.488 — a
 * wrong map out of a grammatically unremarkable sentence. It stays because its
 * family is the whole of this layer's measured value; the collision is a known
 * cost, not an oversight.
 */
export const SYNONYM_RULES: readonly SynonymRule[] = [
  // Measured: "porão onde guardam os barris", "adega" and "porão de taverna"
  // all came back as `tavern_hall`.
  {
    canonical: STOREROOM_WORD,
    variants: ['porão', 'porões', 'adega', 'adegas', 'despensa', 'despensas', 'armazém', 'armazéns'],
  },
  // There is no `hearth` rule. "fogo", "fogos", "braseiro", "braseiros",
  // "chaminé", "chaminés", "fogueira" and "fogueiras" were all measured out of
  // it, one round after another, and nothing was left standing.
  //
  // There is no `pillars` rule either. "coluna" and "colunas" went as polysemy,
  // "pilastra" and "pilastras" for contradicting this project's own gold, and
  // "pilar" was then measured alone and bought nothing.
  {
    canonical: FEATURE_TEMPLATE.labels.stairs,
    variants: ['escadas', 'escadaria', 'escadarias'],
  },
  // "estantes", the plural, was measured out under mode 5: on g05 it bought the
  // true `shelving` and the false `alcove` of the same sentence, one for one —
  // TP 24 → 23, FP 9 → 8, FN 6 → 7. The singular stays: it moves nothing on the
  // corpus, and outside it, it crosses the gate (0.332 → 0.974).
  {
    canonical: FEATURE_TEMPLATE.labels.shelving,
    variants: ['prateleira', 'estante'],
  },
  {
    canonical: FEATURE_TEMPLATE.labels.bunks,
    variants: ['beliche'],
  },
  {
    canonical: FEATURE_TEMPLATE.labels.bar,
    variants: ['balcões'],
  },
  // There is no `alcove` rule. "nicho" and "nichos" were measured out, and
  // "alcovas" was then measured and bought nothing — see above.
];

/**
 * A word with its case and its accents taken off, for comparing.
 *
 * Accents come off so that "porao" typed in a hurry reaches the same rule as
 * "porão". They come off the *comparison* only — what goes back into the
 * sentence is the canonical word spelled properly, accents and all.
 */
export function fold(word: string): string {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * The rules as a lookup from folded variant to canonical word.
 *
 * Exported so that a test can hand it broken rules and watch it refuse them,
 * which is the only way the two refusals below are reachable at all.
 *
 * @throws {RangeError} if the same variant is claimed twice. By two rules, the
 *                      rewrite would depend on declaration order, which is not
 *                      a thing a reader of the data could see; by one rule
 *                      twice over, it is a typo in a list nobody reads to the
 *                      end. The message names both canonicals, so which of the
 *                      two it is can be read off it.
 * @throws {RangeError} if a variant is some rule's canonical word. That is a
 *                      rewrite that undoes another one, and which of the two
 *                      wins would depend on where the word sat in the sentence.
 */
export function buildIndex(rules: readonly SynonymRule[]): ReadonlyMap<string, string> {
  const canonicals = new Set(rules.map((rule) => fold(rule.canonical)));
  const index = new Map<string, string>();

  for (const rule of rules) {
    for (const variant of rule.variants) {
      const key = fold(variant);
      const claimed = index.get(key);
      if (claimed !== undefined) {
        // Both canonicals, rather than "by two rules": one rule listing the
        // same word twice reaches here as well, and then the two names are the
        // same word, which is exactly what tells the two cases apart.
        throw new RangeError(
          `"${variant}" is claimed twice, by "${claimed}" and by "${rule.canonical}"`,
        );
      }
      if (canonicals.has(key)) {
        throw new RangeError(`"${variant}" is already a canonical word`);
      }
      index.set(key, rule.canonical);
    }
  }
  return index;
}

/**
 * The lookup the real rules make.
 *
 * Built once, at import, so that a broken edit to `SYNONYM_RULES` fails loudly
 * the first time anything in this front is loaded rather than on the one
 * description that happens to contain the offending word.
 */
const CANONICAL_BY_VARIANT = buildIndex(SYNONYM_RULES);

/**
 * `word` wearing whatever capitalisation `sample` had.
 *
 * Three shapes, because those are the three a person actually types: a word in
 * the middle of a sentence, a word that starts one, and a word being shouted.
 * The point is narrow — a premise that reads "Depósito grande" instead of
 * "depósito grande" is the sentence the person wrote, and this layer has no
 * business tidying their capitals any more than their wording.
 *
 * A one-letter sample would be ambiguous between the last two — "A" is both
 * capitalised and shouted — but it cannot occur: this is only ever called on a
 * word that matched a variant, and the shortest variants are "porão" and
 * "adega", at five letters. So there is no tie to break and no length test
 * here.
 */
function matchCase(sample: string, word: string): string {
  // Only ever called on a run of letters and combining marks the regex below
  // matched, so `sample` has a first character. A decomposed word can in
  // principle start with a mark rather than a letter; a mark is equal to both
  // its own cases, so such a sample falls through to the last line and the
  // canonical word goes in exactly as `SYNONYM_RULES` spells it.
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) {
    return word.toUpperCase();
  }
  if (sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

/**
 * `text` with every known synonym swapped for the word the model was asked
 * about, and `text` itself, untouched, beside it.
 *
 * Whole words only: the match runs over runs of letters, so "comporão" keeps
 * its "porão" and "restante" keeps its "estante". Both examples are checked
 * against the table as it stands: an example whose inner word is no longer a
 * variant proves nothing, because it would pass with no word boundary at all.
 * Three have already had to be retired for that — "colunata", "desafogo" and
 * "restantes".
 * Everything that is neither a letter nor a combining mark
 * — spaces, commas, the person's exclamation marks — is carried through
 * character for character, because the premise of an entailment pair is the
 * sentence, not a cleaned-up version of it.
 *
 * **Combining marks are part of a word here, and leaving them out was a silent
 * hole.** A description does not arrive in one normal form: text pasted out of
 * another editor is routinely NFD, where "porão" is `p o r a ̃ o` — six code
 * points, the tilde standing on its own. `\p{L}+` alone stops at that tilde, so
 * the tokens are "pora" and "o", neither is any rule's variant, and the whole
 * layer does nothing at all without saying so. Measured on this module against
 * the table as it stands: "Um porão de taverna com dois balcões" applies
 * `[depósito, balcão]` in NFC either way, and with the old tokenizer restored
 * it applies **nothing at all** in NFD — both rules silent, the sentence handed
 * to the classifier exactly as typed. It hits every accented variant —
 * "porão", "porões", "armazém", "armazéns", "balcões" — the first of which is
 * the whole reason this layer exists. `fold` below has decomposed since it was
 * written; this is the tokenizer catching up with it.
 *
 * (The example here used to be "…com fogo aceso" applying `[depósito, lareira]`,
 * a rewrite this table has not been able to make since "fogo" was measured out.
 * An example that the code cannot produce demonstrates nothing.)
 */
export function normalizeForClassifier(text: string): Normalized {
  const applied: AppliedSynonym[] = [];

  const rewritten = text.replace(/[\p{L}\p{M}]+/gu, (word) => {
    const canonical = CANONICAL_BY_VARIANT.get(fold(word));
    if (canonical === undefined) {
      return word;
    }
    applied.push({ found: word, canonical });
    return matchCase(word, canonical);
  });

  return { original: text, text: rewritten, applied };
}

/**
 * The words a person writes, rewritten into the words the model was asked
 * about — before the model is asked anything.
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
 * **The two `features` errors the bench found are no longer repaired here, and
 * that was a decision rather than an oversight.** They were "fogo aceso" not
 * reaching `hearth` and "colunas de madeira" not reaching `pillars`, and rules
 * for "fogo" and "coluna" did repair both — measured, `hearth` 0.018 → 0.973
 * and `pillars` 0.181 → 0.972. The same two rules also fired on seven
 * sentences that have no hearth and no pillars in them, every one of them past
 * the gate. Both gains were given up to close all seven. The principle that
 * decided it, and that the next person should weigh a rule against before
 * adding one:
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
 * - **No agreement repair.** "fogo aceso" becomes "lareira aceso", which is not
 *   Portuguese. It is also a premise that now contains the word the model is
 *   being asked about, which is the whole point; teaching this layer gender
 *   would be a grammar engine to fix an adjective the classifier is not reading
 *   for its endings.
 * - **No rules for `light`, `condition` or `size`.** The bench recorded no
 *   vocabulary errors in those three, so no rule here targets them. They are
 *   exposed to it all the same: all five questions are asked about the
 *   *rewritten* premise, so every swap reaches them too. Measured over the
 *   twenty bench descriptions, the layer rewrites seven of them and not one of
 *   the sixty `light`/`condition`/`size` answers changes. The scores do move —
 *   the largest single one by 0.100, `size`/`small` on H1 from 0.413 to 0.313 —
 *   and the closest call among the seven was a 0.010 margin between `dark` and
 *   `dim`, which the rewrite widened rather than tipped. So: exposed, and
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
 * **That is a fact about one rule out of eight, and not about the layer.** The
 * other seven rewrite features, twenty variants between them, and `placeType`
 * is asked about the same rewritten premise — so they move it too, in whatever
 * direction the new word happens to pull. Measured: "Um quarto de hóspedes com
 * uma estante ao lado da cama." becomes "...com uma prateleiras...", and
 * `tavern_storeroom` goes 0.286 → 0.228 while `tavern_room` goes 0.568 →
 * 0.586. The layer moved an answer *away* from the storeroom. Read the
 * paragraph above as a claim about the whole table and it says that cannot
 * happen; it is a claim about four nouns.
 *
 * **False positives on `features` are the failure mode this layer reintroduces
 * most easily.** The risk above is about `placeType`, and it does not cover
 * them. A variant that names a part of a feature, a cousin of one, or a word
 * that merely *can* mean one rewrites a premise that mentions something into
 * one that asserts the hypothesis, and the classifier then agrees at 0.86–0.99.
 * Nine variants have been removed for exactly this, in three rounds and for
 * three different reasons — all three are named under `SYNONYM_RULES` below.
 * Any variant added later can bring it back, and it will not show up in a
 * `placeType` count.
 *
 * ## What the table is worth, on the reviewer's corpus
 *
 * Measured with the hypotheses and thresholds read out of `templates.ts`, never
 * retyped, and with `placeType` scored on the argmax because `readPlaceType`
 * reports the gate rather than obeying it:
 *
 * - **`placeType`, 31 descriptions: 27/31 without this layer, 28/31 with it.**
 *   Unchanged by the nine removals — every one of them is a `features` word, and
 *   the only description of the 31 containing one was already right both ways.
 * - **`features`, 28 neutral descriptions, label-level: F1 0.746 without,
 *   0.769 with.** Exact sets 17/28 either way.
 *
 * The second number used to be F1 0.845 and 20/28, with the nine variants in.
 * **Most of what this layer was worth on a neutral corpus went out with them**,
 * and that is the honest accounting: on those 28 descriptions the removals
 * bought one false positive and cost five false negatives. The case for making
 * them is not there — it is in the adversarial batch, measured separately,
 * where the same removals take `features` false positives from 7 of 7 to 0 of 7
 * and spurious `bunks` from 4 of 5 to 0 of 5. Under the rule this front was
 * given — a false positive draws furniture and a false negative only omits —
 * that is the trade, and it is a real trade rather than a free win.
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
 * ## Three ways a variant turns out to be wrong, all of them found the hard way
 *
 * Nine variants have been admitted and measured out again, in three rounds, and
 * the three failure modes are different enough that the next person needs all
 * three names. The first two were found by reading the table; the third was not
 * found that way at all, and the reason is the important part.
 *
 * **1. Quasi-objects.** "degrau", "chaminé" and "braseiro" — a step is not a
 * staircase, a flue is not a fireplace, a brazier is not a hearth. Each rewrote
 * a sentence into one that asserts the hypothesis outright: "O salão tem um
 * único degrau na entrada, e nada mais." took `stairs` from 0.325 to 0.983, "Um
 * quarto pequeno com uma chaminé fria de tijolos atravessando a parede." took
 * `hearth` from 0.082 to 0.988, "O quarto é aquecido por um braseiro de ferro
 * no canto." took `hearth` from 0.134 to 0.971.
 *
 * **2. Nominal polysemy — the one that hid the longest.** "fogo" and "coluna"
 * are not near-things at all. Each is a perfectly ordinary noun with a second,
 * commoner reading that has nothing to do with the label, and prose reaches for
 * the second reading constantly. Measured, with those four variants in:
 *
 * - "O fogo destruiu metade do salão no ano passado." took `hearth` from 0.008
 *   to 0.956. The fire is the thing that burned the place down.
 * - "Uma coluna de fumaça sobe da cozinha ao lado." took `pillars` from 0.020
 *   to 0.971. The column is made of smoke.
 *
 * Seven such sentences were measured across the two words and all seven crossed
 * the gate; with these rules gone, none of them does. **What hid this for two
 * rounds was the "quasi-object" framing itself.** A reviewer checking the table
 * against that rule asks "is a *fogo* nearly a *lareira*?", and in the reading
 * the rule-writer had in mind it is, so the variant passes. Asking instead "what
 * else can this word mean?" finds it immediately. It also helped that "fogo" and
 * "coluna" sat in the two families the bench had *measured a gain on* — nobody
 * reopens a family that already has a number beside it.
 *
 * **3. A correct rule feeding a contaminated label.** "nicho" and "nichos" were
 * removed too, and this one is *not* polysemy — a niche really is an alcove and
 * the rewrite was right. The damage came from the other end: the label "alcova"
 * pulls `beliches` up with it, so recovering a true `alcove` also lit a false
 * `bunks`. Measured, four sentences, `bunks` rose in all four and crossed the
 * gate in three ("No fundo do salão há um nicho com uma estátua." 0.489 →
 * 0.879). Recovering one true feature by drawing one false one is not a gain,
 * so the rule went.
 *
 * **The `alcova`/`beliches` contamination is a known defect and removing the
 * rule did not fix it.** It is in the label pair, not the rule: "Duas alcovas
 * escuras se abrem no fundo." scores `bunks` at 0.554 **with no layer at all**,
 * and across eight sentences containing "alcovas" the raw premise puts `bunks`
 * over the gate in seven. Dropping "nicho" narrowed the exposure and did not
 * touch the cause. Nothing in this front fixes it; a bench on the label wording
 * would be where to start.
 *
 * **The rule that decides all of this**, now that there are three ways to get it
 * wrong: a variant has to be a noun whose *ordinary* readings all mean the
 * label. Not "can mean" — "all mean". "bancada" is not here because a workbench
 * in a cellar is not a bar; "fogo" is no longer here because a fire in a
 * doorway is not a fireplace.
 *
 * **One variant collides with a verb and stays.** "porão" is also the future
 * indicative of *pôr*. Measured: "Eles porão as mesas no salão antes de abrir a
 * taverna." goes from `tavern_hall` at 0.680 to `tavern_storeroom` at 0.488 — a
 * wrong map out of a grammatically unremarkable sentence. It stays because it
 * repairs two of the three `placeType` errors the bench found and is the central
 * gain of this layer; the collision is a known cost, not an oversight.
 *
 * "pilar" is also the infinitive "to pound", and that one has now been measured
 * and is not a problem: "A cozinheira começou a pilar o alho no almofariz."
 * scores `pillars` at 0.819 **without the layer** and 0.841 with it. The model
 * reads that sentence wrong on its own and the rule barely moves it — there is
 * no damage here to attribute to the table. With "coluna" gone, "pilar" is a
 * singular-to-plural normalisation of the label itself, the same shape as
 * "escadas" → "escada".
 *
 * **There is no `alcove` family any more.** After "nicho" and "nichos" went, the
 * only variant left was "alcovas", and it was measured before being kept: across
 * eight sentences it moved `alcove` from an already-correct 0.878–0.966 to
 * 0.937–0.985 and crossed the gate **zero times**. The model reads the plural
 * against the singular label perfectly well here — unlike "escadas" against
 * "escada", which crosses from 0.100 to 0.990 and is why that rule exists. A
 * rule that changes no decision is worse than no rule, because it reads as
 * coverage. It was removed with that number.
 */
export const SYNONYM_RULES: readonly SynonymRule[] = [
  // Measured: "porão onde guardam os barris", "adega" and "porão de taverna"
  // all came back as `tavern_hall`.
  {
    canonical: STOREROOM_WORD,
    variants: ['porão', 'porões', 'adega', 'adegas', 'despensa', 'despensas', 'armazém', 'armazéns'],
  },
  // "fogo" and "fogos" were here and were measured out — see the third failure
  // mode above. "fogueira" is a fire somebody built and left burning, which is
  // the only reading it has.
  {
    canonical: FEATURE_TEMPLATE.labels.hearth,
    variants: ['fogueira', 'fogueiras'],
  },
  // "coluna" and "colunas" were here and were measured out for the same
  // reason. What is left is one noun in two numbers.
  {
    canonical: FEATURE_TEMPLATE.labels.pillars,
    variants: ['pilar', 'pilastra', 'pilastras'],
  },
  {
    canonical: FEATURE_TEMPLATE.labels.stairs,
    variants: ['escadas', 'escadaria', 'escadarias'],
  },
  {
    canonical: FEATURE_TEMPLATE.labels.shelving,
    variants: ['prateleira', 'estante', 'estantes'],
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
 * word that matched a variant, and the shortest variant is "fogo". So there is
 * no tie to break and no length test here.
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
 * Whole words only: the match runs over runs of letters, so "colunata" keeps
 * its "coluna", "desafogo" keeps its "fogo" and "restante" keeps its "estante".
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
 * layer does nothing at all without saying so. Measured on this module: "Um
 * porão de taverna com fogo aceso" applied `[depósito, lareira]` in NFC and
 * only `[lareira]` in NFD, with "porão" left standing. It hit the five accented
 * variants — "porão", "porões", "armazém", "armazéns", "balcões" — the first of
 * which is the whole reason this layer exists. `fold` below has decomposed
 * since it was written; this is the tokenizer catching up with it.
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

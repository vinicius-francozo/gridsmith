/**
 * The words a person writes, rewritten into the words the model was asked
 * about — before the model is asked anything.
 *
 * ## Why this layer exists at all
 *
 * Every mistake the winning model made on the bench was a synonym, and nothing
 * else. All three `placeType` errors in twenty descriptions were the same word
 * in three disguises — "porão onde guardam os barris", "adega", "porão de
 * taverna" — every one of them read as `tavern_hall`. Both feature errors in a
 * hundred and forty decisions were the same thing: "fogo aceso" did not reach
 * `hearth`, "colunas de madeira" did not reach `pillars`. A model that is wrong
 * only about vocabulary does not need a bigger model. It needs a dictionary,
 * and a dictionary costs no milliseconds and no megabytes.
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
 * them. A variant that names a part or a cousin of a feature rather than the
 * feature rewrites a premise that merely mentions something into one that
 * asserts the hypothesis, and the classifier then agrees at 0.97–0.99 — see the
 * three families measured out of `SYNONYM_RULES` below. Any variant added later
 * can bring this back, and it will not show up in a `placeType` count.
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
 * The first three rules are the ones the bench measured; the rest of each list
 * is the same family — plurals, singulars, and the everyday word for the same
 * object. The rule each one is admitted under: it has to be a noun a game
 * master writes *instead of* the label, never a near-thing that might be
 * something else. "bancada" is not here because a workbench in a cellar is not
 * a bar.
 *
 * **Three families were admitted against that rule and measured out again.**
 * "degrau", "chaminé" and "braseiro" are all quasi-objects — a step is not a
 * staircase, a flue is not a fireplace, a brazier is not a hearth — and each
 * rewrote a sentence into one that asserts the hypothesis outright. Measured,
 * with the six variants in: "O salão tem um único degrau na entrada, e nada
 * mais." took `stairs` from 0.325 to 0.983, "Um quarto pequeno com uma chaminé
 * fria de tijolos atravessando a parede." took `hearth` from 0.082 to 0.988,
 * and "O quarto é aquecido por um braseiro de ferro no canto." took `hearth`
 * from 0.134 to 0.971. Every one of those is a hearth or a staircase drawn on a
 * map nobody asked for. Across 22 feature sentences the layer scored 13/22 with
 * them and 22/22 without, against 16/22 for no layer at all — the six variants
 * were the whole of the difference, and the gains survived their removal.
 *
 * **Two variants collide with verbs, and they stay anyway.** The rule above
 * asks for nouns and these two are not only nouns:
 *
 * - **"porão"** is also the future indicative of *pôr*. Measured: "Eles porão
 *   as mesas no salão antes de abrir a taverna." goes from `tavern_hall` at
 *   0.680 to `tavern_storeroom` at 0.488 — a wrong map out of a grammatically
 *   unremarkable sentence. It stays because it repairs two of the three
 *   `placeType` errors the bench found and is the central gain of this layer;
 *   the collision is a known cost, not an oversight.
 * - **"pilar"** is also the infinitive "to pound". No sentence has been
 *   measured against it; it is written down here so that the next person
 *   measuring knows where to look.
 *
 * **One known side effect, kept because the gain is larger.** "nicho" → "alcova"
 * is a clear win — `alcove` goes from 0.03–0.24 to 0.95–0.98 on every sentence
 * tried — but the rewrite also drags `bunks` up with it, because "alcova"
 * carries a sleeping-place reading that "nicho" does not. Measured over four
 * sentences: `bunks` rose in three, and in two of the four it crossed the 0.5
 * gate that the raw premise had left uncrossed ("No fundo do salão há um nicho
 * com uma estátua." took `bunks` from 0.489 to 0.879). So a recess in a wall
 * can put beds on the map. The alcove it recovers is judged worth that, but it
 * is a cost, not a free win.
 */
export const SYNONYM_RULES: readonly SynonymRule[] = [
  // Measured: "porão onde guardam os barris", "adega" and "porão de taverna"
  // all came back as `tavern_hall`.
  {
    canonical: STOREROOM_WORD,
    variants: ['porão', 'porões', 'adega', 'adegas', 'despensa', 'despensas', 'armazém', 'armazéns'],
  },
  // Measured: "fogo aceso" did not reach `hearth`.
  {
    canonical: FEATURE_TEMPLATE.labels.hearth,
    variants: ['fogo', 'fogos', 'fogueira', 'fogueiras'],
  },
  // Measured: "colunas de madeira" did not reach `pillars`.
  {
    canonical: FEATURE_TEMPLATE.labels.pillars,
    variants: ['coluna', 'colunas', 'pilar', 'pilastra', 'pilastras'],
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
  {
    canonical: FEATURE_TEMPLATE.labels.alcove,
    variants: ['alcovas', 'nicho', 'nichos'],
  },
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
 * @throws {RangeError} if two rules claim the same variant — the rewrite would
 *                      then depend on declaration order, which is not a thing a
 *                      reader of the data could see.
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
      if (index.has(key)) {
        throw new RangeError(`"${variant}" is claimed by two synonym rules`);
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

import { describe, expect, it } from 'vitest';

import {
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
  STOREROOM_WORD,
} from './templates';
import { SYNONYM_RULES, buildIndex, fold, normalizeForClassifier } from './synonyms';
import type { AppliedSynonym, SynonymRule } from './synonyms';

/**
 * Every expectation in this file is written out as a literal sentence.
 *
 * None of it is computed from `SYNONYM_RULES`, and that is the whole point:
 * this layer's tests and this layer's data were written by the same hand on the
 * same afternoon, so a test that loops over the rules would go on passing with
 * every rule deleted — it would simply test nothing, quietly. A named `it` per
 * family dies when its family dies. Every variant in `SYNONYM_RULES` has a
 * sentence of its own above, written out word for word.
 *
 * Three tests in "the rules themselves" do loop over the rules, and none of the
 * three asks whether a rewrite happens — that is the one thing a loop here is
 * not allowed to check. They hold the data to shape: every canonical word is a
 * word some template actually asks about, every family has at least one variant
 * and a canonical that is not padded, and every canonical is a single word. All
 * three would still pass with the matcher deleted, and that is why they are
 * loops and the rest are not.
 */

describe('the three errors the bench measured', () => {
  // All three `placeType` mistakes the winning model made in twenty
  // descriptions were this one word wearing three hats, and every one of them
  // came back as `tavern_hall`.
  it('rewrites "porão" inside a sentence', () => {
    expect(normalizeForClassifier('porão onde guardam os barris').text).toBe(
      'depósito onde guardam os barris',
    );
  });

  it('rewrites "adega" standing alone', () => {
    expect(normalizeForClassifier('adega').text).toBe('depósito');
  });

  it('rewrites "porão" in front of the place it belongs to', () => {
    expect(normalizeForClassifier('porão de taverna').text).toBe('depósito de taverna');
  });

  // The two feature mistakes the bench found are deliberately NOT repaired any
  // more. Rules for "fogo" and "coluna" did repair them and fired on seven
  // sentences with no hearth and no pillars in them; all seven were closed by
  // giving the two gains up. These two tests are the record of that decision,
  // and they fail the moment somebody puts either word back thinking they are
  // fixing a regression.
  it('leaves "fogo aceso" alone, though it used to reach the hearth label', () => {
    expect(normalizeForClassifier('fogo aceso').text).toBe('fogo aceso');
  });

  it('leaves "colunas de madeira" alone, though it used to reach the pillars label', () => {
    expect(normalizeForClassifier('colunas de madeira').text).toBe('colunas de madeira');
  });
});

describe('the words this layer was told to stop rewriting', () => {
  // Nominal polysemy: an ordinary noun whose commoner reading is not the label.
  // One measured sentence each, from the batch that decided the removal.
  it('leaves the fire that burned the place down', () => {
    expect(normalizeForClassifier('O fogo destruiu metade do salão no ano passado.').text).toBe(
      'O fogo destruiu metade do salão no ano passado.',
    );
  });

  it('leaves the fireworks outside', () => {
    expect(normalizeForClassifier('Os fogos de artifício estouram lá fora.').text).toBe(
      'Os fogos de artifício estouram lá fora.',
    );
  });

  it('leaves the column of smoke', () => {
    expect(normalizeForClassifier('Uma coluna de fumaça sobe da cozinha ao lado.').text).toBe(
      'Uma coluna de fumaça sobe da cozinha ao lado.',
    );
  });

  it('leaves the column of soldiers', () => {
    expect(normalizeForClassifier('Uma coluna de soldados atravessa o salão vazio.').text).toBe(
      'Uma coluna de soldados atravessa o salão vazio.',
    );
  });

  // Not polysemy: a niche really is an alcove. The label "alcova" drags
  // `beliches` up with it, so recovering the true feature lit a false one.
  it('leaves a niche alone, because the alcove label pulls bunks with it', () => {
    expect(normalizeForClassifier('No fundo do salão há um nicho com uma estátua.').text).toBe(
      'No fundo do salão há um nicho com uma estátua.',
    );
  });

  it('leaves niches in the plural alone too', () => {
    expect(normalizeForClassifier('dois nichos rasos na parede').text).toBe(
      'dois nichos rasos na parede',
    );
  });

  // Round three: "fogueira" outlived "fogo" only because this file claimed it
  // had one reading. Two ordinary sentences say otherwise, with the same shape
  // and the same magnitude as the ones that convicted "fogo".
  it('leaves the midsummer bonfires in the village square', () => {
    expect(normalizeForClassifier('As fogueiras de São João ardem na praça da vila.').text).toBe(
      'As fogueiras de São João ardem na praça da vila.',
    );
  });

  it('leaves the pyre outside the church', () => {
    expect(normalizeForClassifier('O herege foi queimado na fogueira diante da igreja.').text).toBe(
      'O herege foi queimado na fogueira diante da igreja.',
    );
  });

  // "pilastra" contradicted this project's own gold: `g14` expects only `bar`
  // because a pilaster is an ornament flat against a wall, and the rule
  // rewrote it to "pilares" regardless.
  it('leaves a pilaster a pilaster, because the gold says it is not a pillar', () => {
    expect(normalizeForClassifier('Pilastras rasas decoram a parede lisa do salão.').text).toBe(
      'Pilastras rasas decoram a parede lisa do salão.',
    );
  });

  // "pilar" was measured alone after the rest of its family went: 0 gate
  // crossings in 10 sentences, `pillars` already 0.819-0.971 raw.
  it('leaves the cook pounding garlic, which the model misreads on its own', () => {
    expect(normalizeForClassifier('A cozinheira começou a pilar o alho no almofariz.').text).toBe(
      'A cozinheira começou a pilar o alho no almofariz.',
    );
  });

  it('leaves the plural "estantes", which bought a true label and a false one', () => {
    // Mode 5, the one-for-one case: on `g05` it bought the gold `shelving` and
    // a false `alcove` in the same breath. The singular is still a variant.
    expect(normalizeForClassifier('Estantes empoeiradas guardam potes e garrafas.').text).toBe(
      'Estantes empoeiradas guardam potes e garrafas.',
    );
  });

  it('has no alcove rule left to reach, so "alcovas" stays as typed', () => {
    // "alcovas" was the last variant standing and bought no gate crossing in
    // eight sentences -- the model already reads it against the singular label.
    expect(normalizeForClassifier('um nicho e duas alcovas').text).toBe('um nicho e duas alcovas');
  });
});

describe('each family reaches the word the model was asked about', () => {
  it('sends the cellar words to the storeroom word', () => {
    expect(normalizeForClassifier('uma despensa e um armazém e dois porões').text).toBe(
      'uma depósito e um depósito e dois depósito',
    );
    expect(normalizeForClassifier('as adegas, as despensas e os armazéns da casa').text).toBe(
      'as depósito, as depósito e os depósito da casa',
    );
  });

  it('has no fire family left, so every fire word stays as typed', () => {
    // Eight variants were measured out of this rule, over three rounds, and
    // nothing survived: "braseiro"/"braseiros" and "chaminé"/"chaminés" as
    // quasi-objects, "fogo"/"fogos" and then "fogueira"/"fogueiras" as nominal
    // polysemy. `SYNONYM_RULES` has no `hearth` entry at all.
    expect(normalizeForClassifier('uma fogueira no centro').text).toBe('uma fogueira no centro');
    expect(normalizeForClassifier('três fogueiras apagadas').text).toBe('três fogueiras apagadas');
    expect(normalizeForClassifier('dois fogos e um braseiro sob a chaminé').text).toBe(
      'dois fogos e um braseiro sob a chaminé',
    );
  });

  it('has no column family left either', () => {
    // "coluna"/"colunas" as polysemy, "pilastra"/"pilastras" for contradicting
    // the project's own gold on `g14`, and "pilar" measured alone afterwards
    // and bought nothing: 0 gate crossings in 10 sentences.
    expect(normalizeForClassifier('um pilar e uma pilastra').text).toBe('um pilar e uma pilastra');
    expect(normalizeForClassifier('uma coluna entre duas pilastras').text).toBe(
      'uma coluna entre duas pilastras',
    );
  });

  it('sends the step words to the stairs word', () => {
    // "degrau" was in this family and was measured out of it — a single step is
    // not a staircase, and rewriting it into one took `stairs` from 0.325 to
    // 0.983 on "O salão tem um único degrau na entrada, e nada mais."
    expect(normalizeForClassifier('escadas, escadaria e escadarias').text).toBe(
      'escada, escada e escada',
    );
    expect(normalizeForClassifier('um único degrau').text).toBe('um único degrau');
  });

  it('sends the shelf words to the shelving word, the singular only', () => {
    // "estantes", the plural, was measured out: on `g05` it bought the true
    // `shelving` and a false `alcove` in the same sentence. The singular buys a
    // real gate crossing on its own, 0.332 -> 0.974, and moves nothing on the
    // corpus, so the two were split rather than removed together.
    expect(normalizeForClassifier('uma estante e uma prateleira').text).toBe(
      'uma prateleiras e uma prateleiras',
    );
    expect(normalizeForClassifier('estantes até o teto').text).toBe('estantes até o teto');
  });

  it('sends the bed words to the bunks word', () => {
    expect(normalizeForClassifier('um beliche no canto').text).toBe('um beliches no canto');
  });

  it('sends the counter words to the bar word', () => {
    expect(normalizeForClassifier('dois balcões').text).toBe('dois balcão');
  });

});

describe('negation survives the rewrite', () => {
  // The bench put this exact sentence through the model and got `hearth` at
  // 0.01. That number is the thing this layer is most able to destroy.
  const BENCH_SENTENCE = 'o salão não tem lareira, mas tem um balcão';

  it('leaves the bench sentence alone, because it is already in the model\'s words', () => {
    const normalized = normalizeForClassifier(BENCH_SENTENCE);

    expect(normalized.text).toBe(BENCH_SENTENCE);
    expect(normalized.applied).toEqual([]);
  });

  it('keeps "não tem" in front of the word it rewrote', () => {
    // A layer that gathered the words it recognised and appended them would
    // produce "...um balcão lareira", which mentions a hearth in the clear and
    // throws the 0.01 away. Substituting in place cannot do that, and this
    // whole-string equality is what would notice if it started to.
    expect(normalizeForClassifier('o salão não tem lareira, mas tem dois balcões').text).toBe(
      'o salão não tem lareira, mas tem dois balcão',
    );
  });

  it('adds nothing to the end of a sentence it rewrote', () => {
    const normalized = normalizeForClassifier('sem estante e sem escadas');

    expect(normalized.text).toBe('sem prateleiras e sem escada');
    expect(normalized.text.split(/\s+/)).toHaveLength(5);
  });

  it('leaves a sentence that only negates exactly as long as it was', () => {
    const normalized = normalizeForClassifier('não há nenhum porão aqui');

    expect(normalized.text).toBe('não há nenhum depósito aqui');
    expect(normalized.text.split(' ')[0]).toBe('não');
  });
});

describe('what it refuses to touch', () => {
  it('does not fire inside a longer word', () => {
    // "comporão" carries "porão" and "restante" carries "estante", and both
    // inner words are variants in `SYNONYM_RULES` *today* — which is the only
    // reason either proves anything. An example built on a word the table no
    // longer contains would pass with no word boundary at all, which is exactly
    // the trap the note below describes. This test has already had to drop
    // three such examples: "colunata", "desafogo" and "restantes".
    expect(normalizeForClassifier('os músicos comporão o restante').text).toBe(
      'os músicos comporão o restante',
    );
  });

  it('does not fire on a word that merely starts the same way', () => {
    // "escadinha" shares "escad" with "escadas", "balconista" shares "balc"
    // with "balcões". ("afogado" would not do as an example anywhere here: it
    // contains "foga", not "fogo", so it passed even when "fogo" was a variant.)
    expect(normalizeForClassifier('uma escadinha e um balconista').text).toBe(
      'uma escadinha e um balconista',
    );
  });

  it('keeps every character that is not a letter', () => {
    expect(normalizeForClassifier('  (estante!)  ...  porão?  ').text).toBe(
      '  (prateleiras!)  ...  depósito?  ',
    );
  });

  it('gives an empty description back unchanged', () => {
    expect(normalizeForClassifier('').text).toBe('');
  });

  it('leaves a description with nothing it knows completely alone', () => {
    const description = 'Um Quarto de Taverna  PEQUENO e bagunçado!';

    expect(normalizeForClassifier(description).text).toBe(description);
  });
});

describe('what the person typed', () => {
  it('keeps the original beside the rewrite, character for character', () => {
    const description = '  Porão  ESCURO, com Fogo!  ';
    const normalized = normalizeForClassifier(description);

    expect(normalized.original).toBe(description);
    expect(normalized.text).not.toBe(description);
  });

  it('keeps the original when nothing was rewritten either', () => {
    expect(normalizeForClassifier('um salão').original).toBe('um salão');
  });

  it('gives a capitalised word back capitalised', () => {
    expect(normalizeForClassifier('Porão de taverna').text).toBe('Depósito de taverna');
  });

  it('gives a shouted word back shouted', () => {
    expect(normalizeForClassifier('um PORÃO enorme').text).toBe('um DEPÓSITO enorme');
  });

  it('finds a word typed without its accent', () => {
    expect(normalizeForClassifier('um porao com estante').text).toBe(
      'um depósito com prateleiras',
    );
  });

  it('records every swap, in the order they appear', () => {
    expect(normalizeForClassifier('Porão com estante e escadas').applied).toEqual([
      { found: 'Porão', canonical: 'depósito' },
      { found: 'estante', canonical: 'prateleiras' },
      { found: 'escadas', canonical: 'escada' },
    ]);
  });

  it('records nothing when nothing was swapped', () => {
    expect(normalizeForClassifier('um salão com lareira').applied).toEqual([]);
  });

  it('changes nothing the second time round', () => {
    // Every canonical word has to be a word no rule rewrites, or a description
    // would mean one thing on its way in and another on its way through again.
    const once = normalizeForClassifier('porão com estante, escadas e um beliche').text;

    expect(normalizeForClassifier(once).text).toBe(once);
  });
});

describe('a description that arrives decomposed', () => {
  // A sentence does not arrive in one normal form. Text pasted out of another
  // editor is routinely NFD, where "porão" is six code points with the tilde
  // standing on its own, and a tokenizer that matched only `\p{L}+` stopped at
  // that tilde: the tokens were "pora" and "o", no rule fired, and the layer
  // quietly degraded to doing nothing. These are the five variants with an
  // accent in them — every one of them was unreachable that way, including the
  // rule this whole layer was built for.
  //
  // Both sides are asserted on purpose. A test on NFD alone would go on passing
  // if the composed path broke instead.

  /** The same description read in both normal forms, put back together so that
   *  a `found` the person typed decomposed can be written out here as a word. */
  function bothWays(description: string): {
    composed: { text: string; applied: AppliedSynonym[] };
    decomposed: { text: string; applied: AppliedSynonym[] };
  } {
    const read = (form: 'NFC' | 'NFD'): { text: string; applied: AppliedSynonym[] } => {
      const normalized = normalizeForClassifier(description.normalize(form));
      return {
        text: normalized.text.normalize('NFC'),
        applied: normalized.applied.map((swap) => ({
          found: swap.found.normalize('NFC'),
          canonical: swap.canonical,
        })),
      };
    };

    return { composed: read('NFC'), decomposed: read('NFD') };
  }

  it('reaches "porão" written either way', () => {
    const { composed, decomposed } = bothWays('tem porão aqui');

    expect(composed).toEqual({
      text: 'tem depósito aqui',
      applied: [{ found: 'porão', canonical: 'depósito' }],
    });
    expect(decomposed).toEqual(composed);
  });

  it('reaches "porões" written either way', () => {
    const { composed, decomposed } = bothWays('tem porões aqui');

    expect(composed).toEqual({
      text: 'tem depósito aqui',
      applied: [{ found: 'porões', canonical: 'depósito' }],
    });
    expect(decomposed).toEqual(composed);
  });

  it('reaches "armazém" written either way', () => {
    const { composed, decomposed } = bothWays('tem armazém aqui');

    expect(composed).toEqual({
      text: 'tem depósito aqui',
      applied: [{ found: 'armazém', canonical: 'depósito' }],
    });
    expect(decomposed).toEqual(composed);
  });

  it('reaches "armazéns" written either way', () => {
    const { composed, decomposed } = bothWays('tem armazéns aqui');

    expect(composed).toEqual({
      text: 'tem depósito aqui',
      applied: [{ found: 'armazéns', canonical: 'depósito' }],
    });
    expect(decomposed).toEqual(composed);
  });

  it('reaches "balcões" written either way', () => {
    const { composed, decomposed } = bothWays('tem balcões aqui');

    expect(composed).toEqual({
      text: 'tem balcão aqui',
      applied: [{ found: 'balcões', canonical: 'balcão' }],
    });
    expect(decomposed).toEqual(composed);
  });

  it('applies both rules in the sentence the failure was measured on', () => {
    // Measured before the fix: NFC applied [depósito, lareira], NFD applied
    // only [lareira] — "porão" stood there untouched and nothing said so.
    const { composed, decomposed } = bothWays('Um porão de taverna com dois balcões');

    expect(composed).toEqual({
      text: 'Um depósito de taverna com dois balcão',
      applied: [
        { found: 'porão', canonical: 'depósito' },
        { found: 'balcões', canonical: 'balcão' },
      ],
    });
    expect(decomposed).toEqual(composed);
  });
});

describe('the rules themselves', () => {
  const canonicals = SYNONYM_RULES.map((rule) => rule.canonical);

  it('rewrites towards words the templates actually ask about', () => {
    // The one check that survives a bench replacing every label: a canonical
    // word this layer rewrites towards, that no hypothesis ever mentions, is a
    // rewrite into a word the model is not listening for.
    const asked = [
      ...Object.values(PLACE_TYPE_TEMPLATE.labels),
      ...Object.values(LIGHT_TEMPLATE.labels),
      ...Object.values(CONDITION_TEMPLATE.labels),
      ...Object.values(SIZE_HINT_TEMPLATE.labels),
      ...Object.values(FEATURE_TEMPLATE.labels),
    ].join(' ');

    for (const canonical of canonicals) {
      expect(`${canonical}: ${String(asked.split(/\s+/).includes(canonical))}`).toBe(
        `${canonical}: true`,
      );
    }
  });

  it('gives every canonical word a family, and every family a word', () => {
    for (const rule of SYNONYM_RULES) {
      expect(`${rule.canonical}: ${String(rule.variants.length > 0)}`).toBe(`${rule.canonical}: true`);
      expect(rule.canonical.trim()).toBe(rule.canonical);
    }
  });

  it('keeps every canonical word a single word', () => {
    // A canonical with a space in it would go into the sentence as two tokens,
    // and the second pass over it would see words no rule declared.
    for (const canonical of canonicals) {
      expect(`${canonical}: ${String(canonical.split(/\s+/).length)}`).toBe(`${canonical}: 1`);
    }
  });

  it('has the shape the header states in prose', () => {
    // `synonyms.ts` says "one rule out of five", "the other four", "seven
    // variants between them" and "four nouns". Those counts have gone stale
    // three times now, each time left behind by a commit that removed rules and
    // did not recount the sentences around them — a file stating a false
    // invariant about itself is the defect this front has paid for more than
    // any other. Written out as literals so the prose and the data fail
    // together.
    //
    // The third round is the one this comment has to answer for: the last
    // expectation below already said seven while the comment above it said
    // eight, and so did the paragraph in `synonyms.ts` it was written to pin.
    // A guard whose own comment carries the drift is not a guard.
    const featureRules = SYNONYM_RULES.filter((rule) => rule.canonical !== STOREROOM_WORD);

    expect(SYNONYM_RULES).toHaveLength(5);
    expect(SYNONYM_RULES.flatMap((rule) => rule.variants)).toHaveLength(15);
    expect(featureRules).toHaveLength(4);
    expect(featureRules.flatMap((rule) => rule.variants)).toHaveLength(7);
  });

  it('has the count of dead rules the header states, and names the three', () => {
    // The guard this file did not have, and the reason the header said "two
    // whole rules died" for four rounds while four other places said three.
    // Everything here counted what is alive — five rules, fifteen variants,
    // four feature rules — and a removal that takes a family to zero changes
    // none of those numbers by more than one, so nothing broke. The count of
    // rules that are *gone* had no test at all, which is exactly why it was the
    // number that stayed wrong.
    //
    // Derived from the data on both sides rather than from the prose: a rule
    // can only exist for a word some template asks about, so the labels a rule
    // *could* have are the seven features plus the storeroom noun, and the ones
    // no rule names are the ones that died. Adding a feature label or removing
    // another family fails this without anyone having to notice the sentence.
    const possible = [STOREROOM_WORD, ...Object.values(FEATURE_TEMPLATE.labels)];
    const alive = new Set(SYNONYM_RULES.map((rule) => rule.canonical));
    const dead = possible.filter((label) => !alive.has(label));

    expect(possible).toHaveLength(8);
    expect(dead).toHaveLength(3);
    // Named, so that a removal that kills a different family cannot keep the
    // count at three and leave `hearth`, `pillars` and `alcove` written down.
    expect([...dead].sort()).toEqual(['alcova', 'lareira', 'pilares']);
  });

  it('holds the count of feature labels with no rule, which `templates.ts` states', () => {
    // `templates.ts` says three of the seven feature labels have no synonym
    // rule and the other four do. That sentence is derived from this table and
    // lives in another file, so the shape check above could not see it — and it
    // shipped saying "four" while listing three. Derived here, from both.
    const covered = new Set(SYNONYM_RULES.map((rule) => rule.canonical));
    const labels = Object.values(FEATURE_TEMPLATE.labels);
    const withRule = labels.filter((label) => covered.has(label));

    expect(labels).toHaveLength(7);
    expect(withRule).toHaveLength(4);
    expect(labels.filter((label) => !covered.has(label))).toHaveLength(3);
    // Named, so that swapping which three are uncovered fails too.
    expect([...withRule].sort()).toEqual(['balcão', 'beliches', 'escada', 'prateleiras']);
  });

  it('never gives two families the same canonical word', () => {
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });

  it('builds a lookup the real rules do not break', () => {
    expect(() => buildIndex(SYNONYM_RULES)).not.toThrow();
  });

});

describe('the lookup refuses rules it could not apply predictably', () => {
  it('refuses a word two families both claim, and names both', () => {
    const rules: SynonymRule[] = [
      { canonical: 'lareira', variants: ['fogo'] },
      { canonical: 'balcão', variants: ['fogo'] },
    ];

    expect(() => buildIndex(rules)).toThrow('"fogo" is claimed twice, by "lareira" and by "balcão"');
  });

  it('refuses a word that is another family\'s canonical', () => {
    // Otherwise "lareira" would become "balcão" wherever it sat, and whether a
    // description ended up saying one or the other would depend on the order
    // the rules happened to be declared in.
    const rules: SynonymRule[] = [
      { canonical: 'lareira', variants: ['fogo'] },
      { canonical: 'balcão', variants: ['lareira'] },
    ];

    expect(() => buildIndex(rules)).toThrow(/already a canonical word/);
  });

  it('refuses the same word twice however it was accented', () => {
    const rules: SynonymRule[] = [{ canonical: 'depósito', variants: ['porão', 'porao'] }];

    expect(() => buildIndex(rules)).toThrow(
      '"porao" is claimed twice, by "depósito" and by "depósito"',
    );
  });

  it('refuses one family listing a word twice, and says it was one family', () => {
    // The old message said "claimed by two synonym rules" for this too, which
    // sent whoever read it looking for a second rule that is not there. The
    // same canonical on both sides of the message is what says so.
    const rules: SynonymRule[] = [{ canonical: 'lareira', variants: ['fogo', 'fogo'] }];

    expect(() => buildIndex(rules)).toThrow(
      '"fogo" is claimed twice, by "lareira" and by "lareira"',
    );
  });
});

describe('folding a word for comparison', () => {
  it('takes accents and case off', () => {
    expect(fold('PORÃO')).toBe('porao');
    expect(fold('Armazéns')).toBe('armazens');
  });

  it('leaves a word that has neither alone', () => {
    expect(fold('fogo')).toBe('fogo');
  });
});

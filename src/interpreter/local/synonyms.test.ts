import { describe, expect, it } from 'vitest';

import {
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
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

  // And both feature mistakes in a hundred and forty decisions.
  it('rewrites "fogo" into the word the hearth label uses', () => {
    expect(normalizeForClassifier('fogo aceso').text).toBe('lareira aceso');
  });

  it('rewrites "colunas" into the word the pillars label uses', () => {
    expect(normalizeForClassifier('colunas de madeira').text).toBe('pilares de madeira');
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

  it('sends the fire words to the hearth word', () => {
    // "braseiro" and "chaminé" were in this family and were measured out of it
    // — see `SYNONYM_RULES`. A brazier is not a hearth, and rewriting it into
    // one took `hearth` from 0.134 to 0.971 on a sentence that has no hearth.
    expect(normalizeForClassifier('dois fogos e uma fogueira').text).toBe(
      'dois lareira e uma lareira',
    );
    expect(normalizeForClassifier('três fogueiras apagadas').text).toBe('três lareira apagadas');
    expect(normalizeForClassifier('um braseiro sob a chaminé').text).toBe(
      'um braseiro sob a chaminé',
    );
  });

  it('sends the column words to the pillars word', () => {
    expect(normalizeForClassifier('um pilar e uma pilastra').text).toBe('um pilares e uma pilares');
    expect(normalizeForClassifier('uma coluna entre duas pilastras').text).toBe(
      'uma pilares entre duas pilares',
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

  it('sends the shelf words to the shelving word', () => {
    expect(normalizeForClassifier('uma estante e uma prateleira').text).toBe(
      'uma prateleiras e uma prateleiras',
    );
    expect(normalizeForClassifier('estantes até o teto').text).toBe('prateleiras até o teto');
  });

  it('sends the bed words to the bunks word', () => {
    expect(normalizeForClassifier('um beliche no canto').text).toBe('um beliches no canto');
  });

  it('sends the counter words to the bar word', () => {
    expect(normalizeForClassifier('dois balcões').text).toBe('dois balcão');
  });

  it('sends the recess words to the alcove word', () => {
    expect(normalizeForClassifier('um nicho e duas alcovas').text).toBe('um alcova e duas alcova');
    expect(normalizeForClassifier('dois nichos rasos na parede').text).toBe(
      'dois alcova rasos na parede',
    );
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
    expect(normalizeForClassifier('o salão não tem fogo, mas tem um balcão').text).toBe(
      BENCH_SENTENCE,
    );
  });

  it('adds nothing to the end of a sentence it rewrote', () => {
    const normalized = normalizeForClassifier('sem fogueira e sem colunas');

    expect(normalized.text).toBe('sem lareira e sem pilares');
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
    // "colunata" carries "coluna", "desafogo" carries "fogo" and "restante"
    // carries "estante", and none of the three is the thing its rule is about.
    // ("afogado" would not do as an example here: it contains "foga", not
    // "fogo", so it would pass this test even with no word boundary at all.)
    expect(normalizeForClassifier('a colunata do desafogo restante').text).toBe(
      'a colunata do desafogo restante',
    );
  });

  it('does not fire on a word that merely starts the same way', () => {
    expect(normalizeForClassifier('uma escadinha e um fogão').text).toBe(
      'uma escadinha e um fogão',
    );
  });

  it('keeps every character that is not a letter', () => {
    expect(normalizeForClassifier('  (fogo!)  ...  porão?  ').text).toBe(
      '  (lareira!)  ...  depósito?  ',
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
    expect(normalizeForClassifier('um porao com fogo').text).toBe('um depósito com lareira');
  });

  it('records every swap, in the order they appear', () => {
    expect(normalizeForClassifier('Porão com fogo e colunas').applied).toEqual([
      { found: 'Porão', canonical: 'depósito' },
      { found: 'fogo', canonical: 'lareira' },
      { found: 'colunas', canonical: 'pilares' },
    ]);
  });

  it('records nothing when nothing was swapped', () => {
    expect(normalizeForClassifier('um salão com lareira').applied).toEqual([]);
  });

  it('changes nothing the second time round', () => {
    // Every canonical word has to be a word no rule rewrites, or a description
    // would mean one thing on its way in and another on its way through again.
    const once = normalizeForClassifier('porão com fogo, colunas e um beliche').text;

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
    const { composed, decomposed } = bothWays('Um porão de taverna com fogo aceso');

    expect(composed).toEqual({
      text: 'Um depósito de taverna com lareira aceso',
      applied: [
        { found: 'porão', canonical: 'depósito' },
        { found: 'fogo', canonical: 'lareira' },
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

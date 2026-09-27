import { describe, expect, it } from 'vitest';

import {
  CONDITION_TEMPLATE,
  FEATURE_TEMPLATE,
  LIGHT_TEMPLATE,
  PLACE_TYPE_TEMPLATE,
  SIZE_HINT_TEMPLATE,
} from './templates';
import { SYNONYM_RULES, buildIndex, fold, normalizeForClassifier } from './synonyms';
import type { SynonymRule } from './synonyms';

/**
 * Every expectation in this file is written out as a literal sentence.
 *
 * None of it is computed from `SYNONYM_RULES`, and that is the whole point:
 * this layer's tests and this layer's data were written by the same hand on the
 * same afternoon, so a test that loops over the rules would go on passing with
 * every rule deleted — it would simply test nothing, quietly. A named `it` per
 * family dies when its family dies.
 *
 * The two places that *do* loop over the rules are at the bottom, and neither
 * of them is checking that a rewrite happens: one holds the rules to invariants
 * the whole layer depends on, the other holds every canonical word to the
 * templates it was taken from.
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
  });

  it('sends the fire words to the hearth word', () => {
    // "braseiro" and "chaminé" were in this family and were measured out of it
    // — see `SYNONYM_RULES`. A brazier is not a hearth, and rewriting it into
    // one took `hearth` from 0.134 to 0.971 on a sentence that has no hearth.
    expect(normalizeForClassifier('dois fogos e uma fogueira').text).toBe(
      'dois lareira e uma lareira',
    );
    expect(normalizeForClassifier('um braseiro sob a chaminé').text).toBe(
      'um braseiro sob a chaminé',
    );
  });

  it('sends the column words to the pillars word', () => {
    expect(normalizeForClassifier('um pilar e uma pilastra').text).toBe('um pilares e uma pilares');
  });

  it('sends the step words to the stairs word', () => {
    // "degrau" was in this family and was measured out of it — a single step is
    // not a staircase, and rewriting it into one took `stairs` from 0.325 to
    // 0.983 on "O salão tem um único degrau na entrada, e nada mais."
    expect(normalizeForClassifier('escadas e escadarias').text).toBe('escada e escada');
    expect(normalizeForClassifier('um único degrau').text).toBe('um único degrau');
  });

  it('sends the shelf words to the shelving word', () => {
    expect(normalizeForClassifier('uma estante e uma prateleira').text).toBe(
      'uma prateleiras e uma prateleiras',
    );
  });

  it('sends the bed words to the bunks word', () => {
    expect(normalizeForClassifier('um beliche no canto').text).toBe('um beliches no canto');
  });

  it('sends the counter words to the bar word', () => {
    expect(normalizeForClassifier('dois balcões').text).toBe('dois balcão');
  });

  it('sends the recess words to the alcove word', () => {
    expect(normalizeForClassifier('um nicho e duas alcovas').text).toBe('um alcova e duas alcova');
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
    // "colunata" carries "coluna", "afogado" carries "fogo", and neither is the
    // thing the rule is about.
    expect(normalizeForClassifier('a colunata do afogado').text).toBe('a colunata do afogado');
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

  it('leaves no variant the matcher cannot reach', () => {
    // The one loop over the data in this file, and it is worth being exact
    // about what it does and does not prove. It cannot check that the right
    // words are listed — the list is the thing under test, so a misspelling
    // would simply be tested as itself and pass. The named tests above are what
    // hold each family to real words.
    //
    // What a loop *can* catch is a variant this layer is structurally unable to
    // apply. `normalizeForClassifier` matches one run of letters at a time, so
    // a phrase, a hyphenated word or anything with a digit in it sits in the
    // list looking like coverage and rewrites nothing at all. That limitation
    // is written down in `synonyms.ts`; this is what keeps it honest.
    for (const rule of SYNONYM_RULES) {
      for (const variant of rule.variants) {
        const normalized = normalizeForClassifier(`tem ${variant} aqui`);

        expect(`${variant} -> ${normalized.text}`).toBe(`${variant} -> tem ${rule.canonical} aqui`);
      }
    }
  });
});

describe('the lookup refuses rules it could not apply predictably', () => {
  it('refuses a word two families both claim', () => {
    const rules: SynonymRule[] = [
      { canonical: 'lareira', variants: ['fogo'] },
      { canonical: 'balcão', variants: ['fogo'] },
    ];

    expect(() => buildIndex(rules)).toThrow(/two synonym rules/);
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

    expect(() => buildIndex(rules)).toThrow(/two synonym rules/);
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

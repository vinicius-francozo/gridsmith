import { describe, expect, it } from 'vitest';

import type { Constraints, Interpreter } from '../core/types';
import { createPlaceholderLibrary } from '../assets/placeholder';
import {
  CorsError,
  InvalidApiKeyError,
  MissingApiKeyError,
  NetworkError,
  UpstreamError,
} from '../interpreter/errors';

import { mount, mountApp } from './mount';
import type { AppServices } from './mount';
import { API_KEY_ITEM } from './storage';
import type { KeyStore } from './storage';

// --- A document, by hand -----------------------------------------------------
//
// Vitest runs under `environment: 'node'` and `vite.config.ts` belongs to
// another front, so there is no DOM here and no jsdom to reach for. The page is
// written against a deliberately small slice of the document — create an
// element, set a property, append, replace, listen — and that slice is small
// enough to stand in for honestly. What it cannot stand in for is layout and
// rasterising, and this file asserts nothing about either.

class FakeElement {
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  className = '';
  textContent = '';
  id = '';
  type = '';
  value = '';
  placeholder = '';
  htmlFor = '';
  autocomplete = '';
  inputMode = '';
  spellcheck = false;
  rows = 0;
  hidden = false;
  disabled = false;
  width = 0;
  height = 0;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...nodes);
  }

  addEventListener(type: string, handler: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  /** What the browser does when the person clicks. */
  click(): void {
    for (const handler of this.listeners.get('click') ?? []) {
      handler();
    }
  }

  /** The recording context `renderScene` paints into. */
  getContext(): unknown {
    return new Proxy(
      {},
      {
        get: () => (): undefined => undefined,
        set: () => true,
      },
    );
  }
}

class FakeDocument {
  readonly created: FakeElement[] = [];

  createElement(tag: string): FakeElement {
    const element = new FakeElement(tag, this);
    this.created.push(element);
    return element;
  }
}

/** Every element under `element`, itself included. */
function descendants(element: FakeElement): FakeElement[] {
  return [element, ...element.children.flatMap(descendants)];
}

/** Every piece of text the page shows, as one string. */
function shownText(element: FakeElement): string {
  return descendants(element)
    .filter((node) => node.tagName !== 'style')
    .map((node) => node.textContent)
    .join('\n');
}

function byId(root: FakeElement, id: string): FakeElement {
  const found = descendants(root).find((node) => node.id === id);
  if (found === undefined) {
    throw new Error(`no element with id ${id}`);
  }
  return found;
}

function buttonLabelled(root: FakeElement, label: string): FakeElement {
  const found = descendants(root).find(
    (node) => node.tagName === 'button' && node.textContent === label,
  );
  if (found === undefined) {
    throw new Error(`no button labelled ${label}`);
  }
  return found;
}

/**
 * Everything written to the console while `run` was going on.
 *
 * The trap answers to any property, so a call to a method nobody thought of is
 * recorded the same as a call to `error`.
 */
async function withTrappedConsole(run: () => Promise<void>): Promise<unknown[]> {
  const original = globalThis.console;
  const logged: unknown[] = [];
  globalThis.console = new Proxy({} as Console, {
    get:
      () =>
      (...args: unknown[]): undefined => {
        logged.push(...args);
        return undefined;
      },
  });
  try {
    await run();
  } finally {
    globalThis.console = original;
  }
  return logged;
}

/**
 * Lets every pending promise settle.
 *
 * The click handlers start their work and return, which is what a click
 * handler does. A macrotask turn drains the microtask queue behind them.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((done) => setTimeout(done, 0));
  }
}

// --- The rest of the environment ---------------------------------------------

function fakeStore(initial?: string): KeyStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  if (initial !== undefined) {
    items.set(API_KEY_ITEM, initial);
  }
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function constraintsFor(overrides: Partial<Constraints> = {}): Constraints {
  return {
    placeType: 'tavern_hall',
    light: 'dim',
    condition: 'lived_in',
    clutter: 0.4,
    features: [],
    unresolved: [],
    ...overrides,
  };
}

type Saved = { blob: Blob; filename: string };

type Harness = {
  root: FakeElement;
  doc: FakeDocument;
  store: KeyStore & { items: Map<string, string> };
  asked: string[];
  keysSeen: string[];
  saved: Saved[];
  description: FakeElement;
  apiKey: FakeElement;
  seed: FakeElement;
  generate: FakeElement;
  download: FakeElement;
  text: () => string;
};

type HarnessOptions = {
  answer?: Constraints;
  fail?: unknown;
  stored?: string;
  entropySeed?: number;
  /** How many calls answer before `fail` starts being thrown. */
  failAfter?: number;
  /** An interpreter that never answers, for the double-click case. */
  hang?: boolean;
  /** Stands in for the encoder, which only exists in a browser. */
  toPng?: AppServices['toPng'];
  /** Stands in for the platform's random source, which a browser may not have. */
  entropy?: AppServices['entropy'];
};

function mountHarness(options: HarnessOptions = {}): Harness {
  const doc = new FakeDocument();
  const root = new FakeElement('div', doc);
  const store = fakeStore(options.stored);
  const asked: string[] = [];
  const keysSeen: string[] = [];
  const saved: Saved[] = [];

  const services: Partial<AppServices> = {
    storage: store,
    library: createPlaceholderLibrary(),
    createInterpreter: (key): Interpreter => {
      keysSeen.push(key);
      return {
        interpret: (text) => {
          asked.push(text);
          if (options.hang === true) {
            return new Promise<Constraints>(() => undefined);
          }
          if (options.fail !== undefined && asked.length > (options.failAfter ?? 0)) {
            return Promise.reject(options.fail);
          }
          return Promise.resolve(options.answer ?? constraintsFor());
        },
      };
    },
    // The encoder is the browser's; what this file owns is that its result
    // reaches the saver under the right name.
    toPng: options.toPng ?? (() => Promise.resolve({ size: 1, type: 'image/png' } as Blob)),
    saveBlob: (blob, filename) => {
      saved.push({ blob, filename });
    },
    entropy: options.entropy ?? (() => options.entropySeed ?? 123456),
  };

  mountApp(root as unknown as HTMLElement, services);

  return {
    root,
    doc,
    store,
    asked,
    keysSeen,
    saved,
    description: byId(root, 'gs-description'),
    apiKey: byId(root, 'gs-api-key'),
    seed: byId(root, 'gs-seed'),
    generate: buttonLabelled(root, 'Gerar mapa'),
    download: buttonLabelled(root, 'Baixar PNG'),
    text: () => shownText(root),
  };
}

describe('the page the map is asked for on', () => {
  it('puts up a description field, a key field, a seed field and a button', () => {
    const app = mountHarness();

    expect(app.description.tagName).toBe('textarea');
    expect(app.apiKey.tagName).toBe('input');
    expect(app.seed.tagName).toBe('input');
    expect(app.generate.tagName).toBe('button');
  });

  it('labels every field, bound to the control it names', () => {
    const app = mountHarness();
    const labels = descendants(app.root).filter((node) => node.tagName === 'label');

    expect(labels.map((label) => label.htmlFor).sort()).toEqual([
      'gs-api-key',
      'gs-description',
      'gs-seed',
    ]);
    for (const label of labels) {
      expect(label.textContent).not.toBe('');
    }
  });

  it('mounts with nothing but a root, the way main.ts calls it', () => {
    // The frozen signature is one argument. This is the call `src/main.ts`
    // makes, with every service defaulting to the real one.
    const doc = new FakeDocument();
    const root = new FakeElement('div', doc);

    expect(() => {
      mount(root as unknown as HTMLElement);
    }).not.toThrow();
    expect(byId(root, 'gs-description').tagName).toBe('textarea');
  });
});

describe('the key stays on this machine', () => {
  it('hides the key as it is typed', () => {
    expect(mountHarness().apiKey.type).toBe('password');
  });

  it('builds no form, and gives the key field no name', () => {
    // Together these are what keep the key out of the URL. A named control
    // inside a form is what a GET submit serialises into a query string, and a
    // query string is copied into chat windows and kept in browser history.
    const app = mountHarness();
    const tags = descendants(app.root).map((node) => node.tagName);

    expect(tags).not.toContain('form');
    expect((app.apiKey as unknown as Record<string, unknown>).name).toBeUndefined();
  });

  it('fills the field from what was stored last time', () => {
    expect(mountHarness({ stored: 'sk-ant-api03-guardada' }).apiKey.value).toBe(
      'sk-ant-api03-guardada',
    );
  });

  it('stores the key when a map is asked for', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.apiKey.value = '  sk-ant-api03-nova\n';

    app.generate.click();
    await settle();

    expect(app.store.items.get(API_KEY_ITEM)).toBe('sk-ant-api03-nova');
    expect(app.keysSeen).toEqual(['sk-ant-api03-nova']);
  });

  it('forgets the key when the field is cleared', async () => {
    const app = mountHarness({ stored: 'sk-ant-api03-antiga' });
    app.description.value = 'um salão de taverna';
    app.apiKey.value = '';

    app.generate.click();
    await settle();

    expect(app.store.items.has(API_KEY_ITEM)).toBe(false);
  });

  it('never shows the key, even when the API echoes it back in a failure', async () => {
    const key = 'sk-ant-api03-ZZZsecretZZZ';
    const app = mountHarness({ fail: new UpstreamError(401, `x-api-key ${key} rejected`) });
    app.description.value = 'um salão de taverna';
    app.apiKey.value = key;

    app.generate.click();
    await settle();

    expect(app.text()).not.toContain(key);
    expect(app.text()).not.toContain('secret');
    expect(app.text()).toContain('sk-ant-***');
  });

  it('writes nothing to the console, on the way through or on the way out', async () => {
    // The key lives in this layer and nowhere else, so "the key never reaches
    // a log" reduces to "this layer never logs". The trap below answers to any
    // method at all, so it catches `debug` and `dir` as well as `error`.
    //
    // The two handlers in `mount.ts` catch everything for the second half of
    // the same reason: an exception that escaped one would be logged by the
    // browser itself, carrying an SDK error with the request headers hanging
    // off its `cause`. A rejection left unhandled fails this run outright.
    const key = 'sk-ant-api03-ZZZsecretZZZ';
    const logged = await withTrappedConsole(async () => {
      for (const failure of [
        undefined,
        new MissingApiKeyError(),
        new InvalidApiKeyError(),
        new NetworkError(),
        new CorsError(),
        new UpstreamError(401, `x-api-key ${key} rejected`),
      ]) {
        const app = mountHarness(failure === undefined ? {} : { fail: failure });
        app.description.value = 'um salão de taverna';
        app.apiKey.value = key;
        app.generate.click();
        await settle();
        app.download.click();
        await settle();
      }
    });

    expect(logged).toEqual([]);
  });

  it('shows a failed export instead of letting it escape to the browser', async () => {
    // The encoder rejects on a canvas the browser refused to allocate. Left
    // uncaught, the rejection is logged by the browser, and what it logs is
    // whatever the failure carries.
    const app = mountHarness({ toPng: () => Promise.reject(new Error('o canvas não produziu imagem')) });
    app.description.value = 'um salão de taverna';
    app.generate.click();
    await settle();

    const logged = await withTrappedConsole(async () => {
      app.download.click();
      await settle();
    });

    expect(logged).toEqual([]);
    expect(app.saved).toEqual([]);
    expect(app.text()).toContain('Algo deu errado');
  });
});

describe('asking for a map', () => {
  const EXAMPLES: ReadonlyArray<{ description: string; constraints: Constraints }> = [
    {
      description: 'um salão de taverna, luz baixa, móveis derrubados',
      constraints: constraintsFor({
        placeType: 'tavern_hall',
        light: 'dark',
        condition: 'disordered',
        clutter: 0.6,
        features: ['bar', 'hearth'],
      }),
    },
    {
      description: 'um quarto de taverna pequeno e bagunçado',
      constraints: constraintsFor({
        placeType: 'tavern_room',
        sizeHint: 'small',
        condition: 'disordered',
        clutter: 0.5,
        features: ['bunks'],
      }),
    },
    {
      description: 'um depósito de taverna com engradados empilhados',
      constraints: constraintsFor({
        placeType: 'tavern_storeroom',
        light: 'dark',
        clutter: 0.7,
        features: ['shelving'],
      }),
    },
  ];

  for (const example of EXAMPLES) {
    it(`draws and then downloads: ${example.description}`, async () => {
      const app = mountHarness({ answer: example.constraints });
      app.description.value = example.description;
      app.apiKey.value = 'sk-ant-api03-exemplo';
      app.seed.value = '4242';

      app.generate.click();
      await settle();

      expect(app.asked).toEqual([example.description]);
      expect(app.download.disabled).toBe(false);

      app.download.click();
      await settle();

      expect(app.saved).toHaveLength(1);
      expect(app.saved[0].filename).toContain(example.constraints.placeType.replace('_', '-'));
      expect(app.saved[0].filename).toContain('4242');
      expect(app.saved[0].filename.endsWith('.png')).toBe(true);
    });
  }

  it('says what it built, in Portuguese and with the seed', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.seed.value = '4242';

    app.generate.click();
    await settle();

    expect(app.text()).toContain('Salão de taverna');
    expect(app.text()).toContain('semente 4242');
  });

  it('draws a seed when the field is blank, and shows it so the map can be found again', async () => {
    const app = mountHarness({ entropySeed: 987654 });
    app.description.value = 'um salão de taverna';
    app.seed.value = '';

    app.generate.click();
    await settle();

    expect(app.seed.value).toBe('987654');
    expect(app.saved).toHaveLength(0);
    app.download.click();
    await settle();

    expect(app.saved[0].filename).toContain('987654');
  });

  it('leaves the download shut until there is something to download', () => {
    expect(mountHarness().download.disabled).toBe(true);
  });

  it('keeps offering the drawn map when a new request is refused before it starts', async () => {
    // The rule is that the download always saves what is on the canvas. An
    // empty description is refused before anything is drawn, so the canvas
    // still holds the previous map and it is still that map's file that the
    // button saves, under that map's own seed.
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.seed.value = '4242';
    app.generate.click();
    await settle();

    app.description.value = '';
    app.generate.click();
    await settle();
    app.download.click();
    await settle();

    expect(app.saved).toHaveLength(1);
    expect(app.saved[0].filename).toContain('4242');
  });

  it('stops offering the drawn map once a new run has begun and failed', async () => {
    // The other side of the same rule. Once the run is past its own checks the
    // renderer may have cleared the canvas, so what is on screen is no longer
    // the map the button would name.
    const app = mountHarness({ fail: new NetworkError(), failAfter: 1 });
    app.description.value = 'um salão de taverna';
    app.generate.click();
    await settle();
    expect(app.download.disabled).toBe(false);

    app.generate.click();
    await settle();

    expect(app.download.disabled).toBe(true);
  });

  it('ignores a second click while the first is still in the air', async () => {
    const app = mountHarness({ hang: true });
    app.description.value = 'um salão de taverna';

    app.generate.click();
    await settle();
    app.generate.click();
    await settle();

    expect(app.asked).toHaveLength(1);
  });
});

describe('what the map could not be', () => {
  it('shows an unresolved request as a Portuguese sentence', async () => {
    const app = mountHarness({
      answer: constraintsFor({ unresolved: ['unsupported_request:um segundo andar'] }),
    });
    app.description.value = 'um salão de taverna com um segundo andar';

    app.generate.click();
    await settle();

    expect(app.text()).toContain('O que a descrição pediu e o mapa não tem');
    expect(app.text()).toContain('Pedido que este mapa não tem como representar: “um segundo andar”.');
    expect(app.text()).not.toContain('unsupported_request');
  });

  it('shows a conflict the resolver settled, also as a sentence', async () => {
    // A bar in a bedroom: the known conflict. `resolve` writes
    // `feature_not_in_place:bar` and the screen must not show that.
    const app = mountHarness({
      answer: constraintsFor({ placeType: 'tavern_room', features: ['bar'] }),
    });
    app.description.value = 'um quarto de taverna com um balcão';

    app.generate.click();
    await settle();

    expect(app.text()).toContain('O que o gerador teve de ajustar');
    expect(app.text()).toContain('balcão');
    expect(app.text()).not.toContain('feature_not_in_place');
  });

  it('clears the notices of the previous map before drawing the next', async () => {
    const app = mountHarness({
      answer: constraintsFor({ unresolved: ['unsupported_request:um segundo andar'] }),
    });
    app.description.value = 'um salão de taverna com um segundo andar';
    app.generate.click();
    await settle();
    expect(app.text()).toContain('um segundo andar');

    app.description.value = '';
    app.generate.click();
    await settle();

    expect(app.text()).not.toContain('um segundo andar');
  });

  it('says nothing at all when there was nothing to say', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';

    app.generate.click();
    await settle();

    expect(app.text()).not.toContain('O que a descrição pediu');
    expect(app.text()).not.toContain('O que o gerador teve de ajustar');
  });
});

describe('when it goes wrong', () => {
  it('tells the four interpreter failures apart on screen', async () => {
    const shown: string[] = [];
    for (const failure of [
      new MissingApiKeyError(),
      new InvalidApiKeyError(),
      new NetworkError(),
      new CorsError(),
    ]) {
      const app = mountHarness({ fail: failure });
      app.description.value = 'um salão de taverna';
      app.generate.click();
      await settle();
      shown.push(app.text());
    }

    expect(new Set(shown).size).toBe(4);
    expect(shown[0]).toContain('Cole a sua chave');
  });

  it('leaves the download shut when the map never got drawn', async () => {
    const app = mountHarness({ fail: new NetworkError() });
    app.description.value = 'um salão de taverna';

    app.generate.click();
    await settle();

    expect(app.download.disabled).toBe(true);
    expect(app.saved).toEqual([]);
  });

  it('asks for a description instead of calling the API with nothing', async () => {
    const app = mountHarness();
    app.description.value = '   ';

    app.generate.click();
    await settle();

    expect(app.text()).toContain('Escreva uma descrição');
    expect(app.asked).toEqual([]);
  });

  it('refuses a seed that is not a number, without spending a call', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.seed.value = 'meia-noite';

    app.generate.click();
    await settle();

    expect(app.text()).toContain('número inteiro');
    expect(app.asked).toEqual([]);
  });

  it('refuses a seed outside the range it can name a map with', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.seed.value = '4294967296';

    app.generate.click();
    await settle();

    expect(app.text()).toContain('4294967295');
    expect(app.asked).toEqual([]);
  });

  it('clears the previous failure when the next attempt succeeds', async () => {
    const app = mountHarness();
    app.description.value = '';
    app.generate.click();
    await settle();
    expect(app.text()).toContain('Escreva uma descrição');

    app.description.value = 'um salão de taverna';
    app.generate.click();
    await settle();

    expect(app.text()).not.toContain('Escreva uma descrição');
  });

  it('shows why a seed could not be drawn, instead of leaving a blank page', async () => {
    // The fields are read before the loop's own try, so a browser with no
    // `crypto.getRandomValues` throws outside it. Uncaught, the rejection is
    // logged by the browser and the page just does nothing.
    const app = mountHarness({
      entropy: () => {
        throw new TypeError('this browser has no crypto.getRandomValues to draw a seed from');
      },
    });
    app.description.value = 'um salão de taverna';
    app.seed.value = '';

    const logged = await withTrappedConsole(async () => {
      app.generate.click();
      await settle();
    });

    expect(logged).toEqual([]);
    expect(app.text()).toContain('Algo deu errado');
    expect(app.generate.disabled).toBe(false);
    expect(app.asked).toEqual([]);
  });

  it('lets the button be used again after a failure', async () => {
    const app = mountHarness({ fail: new NetworkError() });
    app.description.value = 'um salão de taverna';

    app.generate.click();
    await settle();

    expect(app.generate.disabled).toBe(false);
    expect(app.generate.textContent).toBe('Gerar mapa');
  });
});

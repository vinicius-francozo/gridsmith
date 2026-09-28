import { describe, expect, it } from 'vitest';

import type { AssetLibrary, Constraints, Interpreter } from '../core/types';
import { createPlaceholderLibrary } from '../assets/placeholder';
import {
  CorsError,
  InvalidApiKeyError,
  MissingApiKeyError,
  NetworkError,
  UpstreamError,
} from '../interpreter/errors';
import type { ProgressReport } from '../interpreter/local/pipeline';

import { UI_TEXT } from './messages';
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
  disabled = false;
  width = 0;
  height = 0;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  /** Every attribute set on this element, by name. */
  readonly attributes = new Map<string, string>();

  /**
   * Being revealed, being hidden and being filled, in the order they happened.
   *
   * `hidden` is `display: none`: while it is on, the element is out of the
   * accessibility tree and a change to its children is a change nothing is
   * watching. So the order of those two is the difference between a live region
   * that announces and one that only ends up correct, and the order is the only
   * thing that can tell them apart — the final state is identical either way.
   */
  readonly trace: string[] = [];

  #hidden = false;

  get hidden(): boolean {
    return this.#hidden;
  }

  set hidden(value: boolean) {
    this.#hidden = value;
    this.trace.push(value ? 'hidden' : 'revealed');
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...nodes);
    this.trace.push(`filled:${nodes.length}`);
  }

  addEventListener(type: string, handler: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  /** What the browser does when the person clicks. */
  click(): void {
    this.fire('click');
  }

  /** What the browser does when the person picks another option. */
  change(): void {
    this.fire('change');
  }

  private fire(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) {
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

function byClass(root: FakeElement, className: string): FakeElement {
  const found = descendants(root).find((node) => node.className === className);
  if (found === undefined) {
    throw new Error(`no element with class ${className}`);
  }
  return found;
}

/** The `.gs-field` wrapper the control with `id` sits in. */
function fieldOf(root: FakeElement, id: string): FakeElement {
  const found = descendants(root).find(
    (node) =>
      node.className === 'gs-field' && descendants(node).some((child) => child.id === id),
  );
  if (found === undefined) {
    throw new Error(`no field around ${id}`);
  }
  return found;
}

/** The `<label>` bound to the control with `id`. */
function labelFor(root: FakeElement, id: string): FakeElement {
  const found = descendants(root).find(
    (node) => node.tagName === 'label' && node.htmlFor === id,
  );
  if (found === undefined) {
    throw new Error(`no label for ${id}`);
  }
  return found;
}

/**
 * Every assignment to `element.textContent`, in the order they happened.
 *
 * The final state cannot tell a region written once from one written four
 * thousand times with the same string, and the difference between those two is
 * the whole of what a live region does. `textContent` is a plain field on
 * `FakeElement`, so the recorder goes on as an accessor over it and reads back
 * exactly what was last written.
 */
function watchText(element: FakeElement): string[] {
  const writes: string[] = [];
  let current = element.textContent;
  Object.defineProperty(element, 'textContent', {
    configurable: true,
    get: () => current,
    set: (value: string) => {
      current = value;
      writes.push(value);
    },
  });
  return writes;
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
  /** The keys the Jev factory was built with, kept apart from the Claude ones. */
  jevKeysSeen: string[];
  /** The report each `createLocalInterpreter` was handed, one per build. */
  progressReports: ProgressReport[];
  saved: Saved[];
  description: FakeElement;
  engine: FakeElement;
  apiKey: FakeElement;
  apiKeyField: FakeElement;
  apiKeyLabel: FakeElement;
  apiKeyNote: FakeElement;
  engineNote: FakeElement;
  seed: FakeElement;
  generate: FakeElement;
  download: FakeElement;
  status: FakeElement;
  failure: FakeElement;
  text: () => string;
  /** Picks an engine the way the person does, and lets the page react. */
  pick: (engine: string) => void;
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
  /** The asset library, for watching the page from inside the drawing stage. */
  library?: AppServices['library'];
  /** Which engine the picker is switched to before anything is clicked. */
  engine?: string;
};

function mountHarness(options: HarnessOptions = {}): Harness {
  const doc = new FakeDocument();
  const root = new FakeElement('div', doc);
  const store = fakeStore(options.stored);
  const asked: string[] = [];
  const keysSeen: string[] = [];
  const jevKeysSeen: string[] = [];
  const progressReports: ProgressReport[] = [];
  const saved: Saved[] = [];

  // One body for all three engines: which one a run used is read off
  // `keysSeen`, `jevKeysSeen` and `progressReports`, and what it answers is the
  // same either way, so no test has to restate the answer per engine.
  const interpreter = (): Interpreter => ({
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
  });

  const services: Partial<AppServices> = {
    storage: store,
    library: options.library ?? createPlaceholderLibrary(),
    createInterpreter: (key): Interpreter => {
      keysSeen.push(key);
      return interpreter();
    },
    createJevInterpreter: (key): Interpreter => {
      jevKeysSeen.push(key);
      return interpreter();
    },
    createLocalInterpreter: (onProgress): Interpreter => {
      progressReports.push(onProgress);
      return interpreter();
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

  const engine = byId(root, 'gs-engine');
  const apiKeyField = fieldOf(root, 'gs-api-key');
  const pick = (chosen: string): void => {
    engine.value = chosen;
    engine.change();
  };
  if (options.engine !== undefined) {
    pick(options.engine);
  }

  return {
    root,
    doc,
    store,
    asked,
    keysSeen,
    jevKeysSeen,
    progressReports,
    saved,
    description: byId(root, 'gs-description'),
    engine,
    apiKey: byId(root, 'gs-api-key'),
    apiKeyField,
    apiKeyLabel: labelFor(root, 'gs-api-key'),
    apiKeyNote: descendants(apiKeyField).filter((node) => node.className === 'gs-note')[0],
    engineNote: descendants(fieldOf(root, 'gs-engine')).filter(
      (node) => node.className === 'gs-note',
    )[0],
    seed: byId(root, 'gs-seed'),
    generate: buttonLabelled(root, 'Gerar mapa'),
    download: buttonLabelled(root, 'Baixar PNG'),
    status: byClass(root, 'gs-status'),
    failure: byClass(root, 'gs-failure'),
    text: () => shownText(root),
    pick,
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

    // Four, not three. The engine picker was captioned with a `<p>` and an
    // `aria-label` for exactly as long as this list said three, because the
    // front that added it could not edit this file to say four.
    expect(labels.map((label) => label.htmlFor).sort()).toEqual([
      'gs-api-key',
      'gs-description',
      'gs-engine',
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
    // Two maps that were both actually drawn. The refusal this used to be
    // written against never reaches the clearing at all, so it proved nothing
    // about the case it was named for.
    // The same array both times, emptied in between, so the second run is a
    // map that really was drawn and really had nothing to report.
    const unresolved = ['unsupported_request:um segundo andar'];
    const app = mountHarness({ answer: constraintsFor({ unresolved }) });
    app.description.value = 'um salão de taverna com um segundo andar';
    app.generate.click();
    await settle();
    expect(app.text()).toContain('um segundo andar');

    unresolved.length = 0;
    app.description.value = 'um salão de taverna';
    app.generate.click();
    await settle();

    expect(app.text()).not.toContain('um segundo andar');
  });

  it('keeps the notices of the map it is still offering to save', async () => {
    // A refusal before the run starts leaves the previous map on the canvas
    // and the download live, by the rule the page is built on. Clearing its
    // notices there would let the person save a map whose caveats the screen
    // has just erased.
    const app = mountHarness({
      answer: constraintsFor({ unresolved: ['unsupported_request:um segundo andar'] }),
    });
    app.description.value = 'um salão de taverna com um segundo andar';
    app.generate.click();
    await settle();

    app.description.value = '';
    app.generate.click();
    await settle();

    expect(app.download.disabled).toBe(false);
    expect(app.text()).toContain('um segundo andar');
    expect(app.text()).toContain('Escreva uma descrição');
  });

  it('keeps them through a seed it cannot use either', async () => {
    const app = mountHarness({
      answer: constraintsFor({ unresolved: ['unsupported_request:um segundo andar'] }),
    });
    app.description.value = 'um salão de taverna com um segundo andar';
    app.generate.click();
    await settle();

    app.seed.value = 'meia-noite';
    app.generate.click();
    await settle();

    expect(app.text()).toContain('um segundo andar');
  });

  it('never prints a key that came back inside a notice', async () => {
    // Reachable with nothing broken. The description field is the first on the
    // page and the key field is the second and shows dots, so a key pasted
    // into the wrong one is an ordinary slip — and then the key is the prompt,
    // the model reports it as something it cannot express, and the entry is
    // wrapped whole as `unsupported_request:<the raw text>`.
    const key = 'sk-ant-api03-AAAAsegredoAAAA_BBBB-CCCC';
    const app = mountHarness({
      answer: constraintsFor({ unresolved: [`unsupported_request:um andar escondido ${key}`] }),
    });
    app.description.value = `um salão de taverna ${key}`;

    app.generate.click();
    await settle();

    expect(app.text()).toContain('O que a descrição pediu e o mapa não tem');
    expect(app.text()).not.toContain(key);
    expect(app.text()).not.toContain('segredo');
    expect(app.text()).toContain('sk-ant-***');
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

describe('what the page says it is doing', () => {
  it('says it is asking the model while the model is being asked', async () => {
    const app = mountHarness({ hang: true });
    app.description.value = 'um salão de taverna';

    app.generate.click();
    await settle();

    expect(app.status.textContent).toBe(UI_TEXT.interpreting);
  });

  it('says it is drawing once the model has answered', async () => {
    // A 20×20 hall spends its visible time here, not on the network: a bitmap
    // resolved per cell and a canvas painted. A line that still claims to be
    // interpreting sends the person to check their connection while the wait
    // is on their own machine. The library below reports what the page was
    // saying at the moment it was asked for a bitmap, which is inside the
    // drawing stage by construction.
    const real = createPlaceholderLibrary();
    const saidWhileDrawing: string[] = [];
    let saying = (): string => '(not mounted yet)';
    const watched: AssetLibrary = {
      get: (id) => real.get(id),
      query: (tags, kind) => real.query(tags, kind),
      bitmap: (id, rotation) => {
        saidWhileDrawing.push(saying());
        return real.bitmap(id, rotation);
      },
    };

    const app = mountHarness({ library: watched });
    saying = () => app.status.textContent;
    app.description.value = 'um salão de taverna';

    app.generate.click();
    await settle();

    expect(saidWhileDrawing.length).toBeGreaterThan(0);
    expect([...new Set(saidWhileDrawing)]).toEqual([UI_TEXT.drawing]);
  });

  it('says the map is ready, and what it is, when it is', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.seed.value = '4242';

    app.generate.click();
    await settle();

    expect(app.status.textContent).toContain(UI_TEXT.done);
    expect(app.status.textContent).toContain('semente 4242');
  });

  it('puts the status line and the failure in live regions', () => {
    // Both change while the focus is still on the button that started the run,
    // so without a live region nothing says the map is ready or that it failed.
    // This is the declaration only; whether a change to the failure is in fact
    // announced is the test below, because the attributes are set once at mount
    // and cannot say anything about when the children move.
    const app = mountHarness();

    expect(app.status.attributes.get('aria-live')).toBe('polite');
    expect(app.status.attributes.get('role')).toBe('status');
    expect(app.failure.attributes.get('aria-live')).toBe('assertive');
    expect(app.failure.attributes.get('role')).toBe('alert');
  });

  it('reveals the failure region before it puts the failure into it', async () => {
    // `role=\"alert\"` announces a mutation of a region that is on the screen.
    // Filled first and revealed second, the mutation happens under
    // `display: none`, where the region is not in the accessibility tree at
    // all, and what appears afterwards is a container that was already full —
    // the order a screen reader handles worst. The end state is the same both
    // ways round, so nothing but the order can tell them apart: a network error
    // comes back, the focus is still on the generate button, and the person
    // using a screen reader hears nothing.
    const app = mountHarness();
    app.description.value = '';

    app.generate.click();
    await settle();

    expect(app.failure.hidden).toBe(false);
    expect(app.failure.trace.slice(-2)).toEqual(['revealed', 'filled:1']);
  });
});

describe('saving the map that was encoded', () => {
  it('refuses to start a run while the PNG is still encoding', async () => {
    // The whole class, closed at the root. The encoder is handed `target`, the
    // live canvas, and reads its width and height after two awaits — so a run
    // that finishes underneath an encode leaves it measuring a canvas of
    // another size, it throws, and the catch says “algo deu errado ao montar o
    // mapa” about a map that came out perfectly and is still on the screen.
    // Holding both buttons for as long as anything is in the air removes the
    // window rather than rescuing what falls into it.
    let finish: (blob: Blob) => void = () => undefined;
    const app = mountHarness({
      toPng: () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    });
    app.description.value = 'um salão de taverna';
    app.seed.value = '4242';
    app.generate.click();
    await settle();
    expect(app.asked).toHaveLength(1);

    app.download.click();
    await settle();

    expect(app.generate.disabled).toBe(true);
    expect(app.download.disabled).toBe(true);

    app.generate.click();
    await settle();
    expect(app.asked).toHaveLength(1);

    finish({ size: 1, type: 'image/png' } as Blob);
    await settle();

    expect(app.saved).toHaveLength(1);
    expect(app.saved[0].filename).toContain('4242');
    expect(app.text()).not.toContain('Algo deu errado');
    expect(app.generate.disabled).toBe(false);
    expect(app.download.disabled).toBe(false);
  });

  it('takes down the failure of the save that failed, once a save works', async () => {
    // An encode that failed left its red box on the screen and nothing ever
    // took it down. The next click wrote the file, and the page went on saying
    // “Algo deu errado ao montar o mapa” to a person who had just been handed
    // the map — so the sequence is the whole test: it has to fail first and
    // succeed second, because an empty box after a clean run proves nothing.
    let attempt = 0;
    const app = mountHarness({
      toPng: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('o canvas não pôde ser lido'))
          : Promise.resolve({ size: 1, type: 'image/png' } as Blob);
      },
    });
    app.description.value = 'um salão de taverna';
    app.seed.value = '4242';
    app.generate.click();
    await settle();

    app.download.click();
    await settle();
    expect(app.saved).toHaveLength(0);
    expect(app.failure.hidden).toBe(false);
    expect(app.text()).toContain('Algo deu errado ao montar o mapa.');

    app.download.click();
    await settle();

    expect(app.saved).toHaveLength(1);
    expect(app.failure.hidden).toBe(true);
    expect(app.failure.children).toEqual([]);
    expect(app.text()).not.toContain('Algo deu errado ao montar o mapa.');
  });
});

describe('choosing which interpreter reads the description', () => {
  it('offers all three engines, each with something written on it', () => {
    const app = mountHarness();
    const options = descendants(app.root).filter((node) => node.tagName === 'option');

    expect(options.map((option) => option.value)).toEqual(['claude', 'jev', 'local']);
    for (const option of options) {
      expect(option.textContent).not.toBe('');
    }
    expect(new Set(options.map((option) => option.textContent)).size).toBe(3);
  });

  it('starts on the engine that answers without downloading anything', () => {
    // Written down rather than left to the browser's "first option wins", so
    // that somebody generating a map mid-session is not handed a 310 MB wait.
    expect(mountHarness().engine.value).toBe('claude');
  });

  it('shows the key field for the two engines that read it and hides it for the one that does not', () => {
    // The rule stopped being "hide it when local" the moment a third engine
    // existed that also needs a key — read as a flag, Jev is Claude's opposite
    // and the field would have gone away on the engine that cannot work
    // without it.
    const app = mountHarness();
    expect(app.apiKeyField.hidden).toBe(false);

    app.pick('local');
    expect(app.apiKeyField.hidden).toBe(true);

    app.pick('jev');
    expect(app.apiKeyField.hidden).toBe(false);

    app.pick('claude');
    expect(app.apiKeyField.hidden).toBe(false);
  });

  it('says what the local engine gives up against the engine that has it', () => {
    // The note names the thing the local engine cannot do: say what the
    // description asked for and the map does not have. That used to be worth
    // measuring against Claude, because Claude was the only other engine.
    // `unresolved` is permanently empty on both of those — it is the Jev
    // out-of-vocabulary noul that fills it, and that is this front's headline.
    // Measured against Claude the sentence is not false, just a year out of
    // date, and it is the one place the page explains the trade.
    expect(mountHarness().engineNote.textContent).toContain('Jev');
  });

  it('shows the download warning only on the engine that downloads', () => {
    const app = mountHarness();
    expect(app.engineNote.hidden).toBe(true);

    app.pick('local');
    expect(app.engineNote.hidden).toBe(false);

    app.pick('jev');
    expect(app.engineNote.hidden).toBe(true);
  });

  it('names the company whose key the field is asking for', () => {
    // One box, two credentials from two companies. A field captioned "Chave da
    // API da Anthropic" above a Jev run sends somebody to the wrong dashboard
    // to fetch a key that will then be refused.
    const app = mountHarness();
    expect(app.apiKeyLabel.textContent).toContain('Anthropic');

    app.pick('jev');
    expect(app.apiKeyLabel.textContent).toContain('TypeSafe');
    expect(app.apiKeyLabel.textContent).not.toContain('Anthropic');

    app.pick('claude');
    expect(app.apiKeyLabel.textContent).toContain('Anthropic');
    expect(app.apiKeyLabel.textContent).not.toContain('TypeSafe');
  });

  it('stops promising a route the Jev request does not take', () => {
    // The note under the field says the key "não passa por servidor nenhum",
    // which is true of Claude and false of Jev: that request goes through the
    // proxy in `api/jev.ts`, because TypeSafe answers a browser without
    // `access-control-allow-origin` and the response is thrown away. Left
    // alone, the page would state the opposite of what it does with a secret.
    const app = mountHarness();
    expect(app.apiKeyNote.textContent).toContain('Não passa por servidor nenhum');

    app.pick('jev');
    expect(app.apiKeyNote.textContent).not.toContain('Não passa por servidor nenhum');
    expect(app.apiKeyNote.textContent).toContain('servidor desta página');
    // And it must not promise storage either. A Jev key is deliberately not
    // kept — the one slot has to stay attributable — so "fica guardada" would
    // be the second false promise about a secret in the same two sentences.
    expect(app.apiKeyNote.textContent).toContain('não fica guardada');

    app.pick('claude');
    expect(app.apiKeyNote.textContent).toContain('Não passa por servidor nenhum');
  });

  it('gives no placeholder that a TypeSafe key has to look like', () => {
    // `sk-ant-...` is right for Anthropic and this project has no documented
    // shape for the other one, so none is shown rather than guessed at.
    const app = mountHarness();
    expect(app.apiKey.placeholder).toBe('sk-ant-...');

    app.pick('jev');
    expect(app.apiKey.placeholder).not.toContain('sk-ant');
  });
});

describe('the engine that is picked is the engine that is used', () => {
  it('sends the description to Claude, with the key from the field', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.apiKey.value = '  sk-ant-api03-nova\n';

    app.generate.click();
    await settle();

    expect(app.keysSeen).toEqual(['sk-ant-api03-nova']);
    expect(app.jevKeysSeen).toEqual([]);
    expect(app.progressReports).toEqual([]);
    expect(app.asked).toEqual(['um salão de taverna']);
  });

  it('sends it to Jev instead when Jev is picked, with the key from the same field', async () => {
    const app = mountHarness({ engine: 'jev' });
    app.description.value = 'uma ferraria com bigorna e fornalha acesa';
    app.apiKey.value = '  ts-chave-do-usuario\n';

    app.generate.click();
    await settle();

    expect(app.jevKeysSeen).toEqual(['ts-chave-do-usuario']);
    expect(app.keysSeen).toEqual([]);
    expect(app.progressReports).toEqual([]);
    expect(app.asked).toEqual(['uma ferraria com bigorna e fornalha acesa']);
  });

  it('builds the local one, with no key at all, when the local one is picked', async () => {
    const app = mountHarness({ engine: 'local' });
    app.description.value = 'um salão de taverna';
    app.apiKey.value = 'sk-ant-api03-nao-usada';

    app.generate.click();
    await settle();

    expect(app.progressReports).toHaveLength(1);
    expect(app.keysSeen).toEqual([]);
    expect(app.jevKeysSeen).toEqual([]);
  });

  it('keeps the local interpreter across runs and rebuilds the cloud ones', async () => {
    // The local one holds the model: a fresh one per click would rebuild the
    // session on every map. The other two hold a string and a client, and the
    // key may have been edited between two clicks.
    const local = mountHarness({ engine: 'local' });
    local.description.value = 'um salão de taverna';
    local.generate.click();
    await settle();
    local.generate.click();
    await settle();
    expect(local.progressReports).toHaveLength(1);
    expect(local.asked).toHaveLength(2);

    const jev = mountHarness({ engine: 'jev' });
    jev.description.value = 'um salão de taverna';
    jev.apiKey.value = 'ts-primeira';
    jev.generate.click();
    await settle();
    jev.apiKey.value = 'ts-segunda';
    jev.generate.click();
    await settle();
    expect(jev.jevKeysSeen).toEqual(['ts-primeira', 'ts-segunda']);
  });

  it('keeps the one slot Anthropic-only, so a prefill can be attributed', async () => {
    // `storage.ts` has one slot and the box is prefilled from it at mount,
    // before any engine has been picked — so a slot that can hold either
    // provider's key is a slot whose contents cannot be attributed, and the
    // page opens on Claude and hands it over. A Claude run stores; a Jev run
    // reads the field and does not; a local run never reads it at all and
    // writing anyway would let a hidden field overwrite a key that was working.
    const claude = mountHarness();
    claude.description.value = 'um salão de taverna';
    claude.apiKey.value = 'sk-ant-api03-nova';
    claude.generate.click();
    await settle();
    expect(claude.store.items.get(API_KEY_ITEM)).toBe('sk-ant-api03-nova');

    const jev = mountHarness({ engine: 'jev' });
    jev.description.value = 'um salão de taverna';
    jev.apiKey.value = 'ts-chave-do-usuario';
    jev.generate.click();
    await settle();
    expect(jev.jevKeysSeen).toEqual(['ts-chave-do-usuario']);
    expect(jev.store.items.has(API_KEY_ITEM)).toBe(false);

    const local = mountHarness({ engine: 'local', stored: 'sk-ant-api03-guardada' });
    local.description.value = 'um salão de taverna';
    local.apiKey.value = '';
    local.generate.click();
    await settle();
    expect(local.store.items.get(API_KEY_ITEM)).toBe('sk-ant-api03-guardada');
  });

  it('cannot prefill a Claude visit with the key a Jev run was given', async () => {
    // The blocker in the direction no prefix test can catch. Two visits: the
    // first runs Jev, the second is a fresh mount reading whatever the first
    // left in storage. If a Jev key could be stored, this is the click that
    // would hand it to Anthropic — with no engine switch, no paste and nothing
    // on screen suggesting a credential had just been disclosed.
    const first = mountHarness({ engine: 'jev' });
    first.description.value = 'uma ferraria com bigorna';
    first.apiKey.value = 'ts-chave-do-usuario';
    first.generate.click();
    await settle();

    const second = mountHarness({ stored: first.store.items.get(API_KEY_ITEM) });
    second.description.value = 'um salão de taverna';
    second.generate.click();
    await settle();

    expect(second.keysSeen).toEqual(['']);
    expect(second.keysSeen.join('')).not.toContain('ts-chave-do-usuario');
  });
});

describe('what the page says while the local model is arriving', () => {
  /**
   * A run on the local engine, stopped at the point the model would load.
   *
   * The interpreter is built while the click handler is still running, so the
   * report it was handed is in hand by the time `settle` returns; `hang` keeps
   * the run from finishing and writing over the line under test.
   */
  async function localRun(): Promise<{ app: Harness; report: ProgressReport }> {
    const app = mountHarness({ engine: 'local', hang: true });
    app.description.value = 'um salão de taverna';
    app.generate.click();
    await settle();
    expect(app.progressReports).toHaveLength(1);
    return { app, report: app.progressReports[0] };
  }

  it('puts the loader’s own progress on the status line, stage by stage', async () => {
    const { app, report } = await localRun();

    report({ kind: 'starting' });
    expect(app.status.textContent).toBe('Preparando o modelo local…');

    report({ kind: 'downloading', file: 'onnx/model_quantized.onnx', ratio: 0.42 });
    expect(app.status.textContent).toBe('Baixando o modelo local… model_quantized.onnx, 42%');

    report({ kind: 'preparing' });
    expect(app.status.textContent).toBe('Carregando o modelo local na memória…');

    report({ kind: 'ready' });
    expect(app.status.textContent).toContain('Modelo local pronto');
  });

  it('says which file each percentage belongs to, over the whole sequence', async () => {
    // Driven through the real page rather than the pure function, because what
    // a person sees is the sequence of writes and not one call's return value.
    // Three falls back to zero remain — `ratio` is a fraction of one file —
    // and each one now happens beside a name that changed.
    const { app, report } = await localRun();
    const writes = watchText(app.status);

    for (const [file, ratio] of [
      ['config.json', 1],
      ['tokenizer_config.json', 1],
      ['tokenizer.json', 0],
      ['tokenizer.json', 1],
      ['onnx/model_quantized.onnx', 0],
      ['onnx/model_quantized.onnx', 1],
    ] as const) {
      report({ kind: 'downloading', file, ratio });
    }

    expect(writes).toEqual([
      'Baixando o modelo local… config.json, 100%',
      'Baixando o modelo local… tokenizer_config.json, 100%',
      'Baixando o modelo local… tokenizer.json, 0%',
      'Baixando o modelo local… tokenizer.json, 100%',
      'Baixando o modelo local… model_quantized.onnx, 0%',
      'Baixando o modelo local… model_quantized.onnx, 100%',
    ]);
  });

  it('writes the live region only when the sentence would change', async () => {
    // `status` is `role="status"` / `aria-live="polite"`, and assigning
    // `textContent` replaces the text node whether or not the string differs —
    // which is a mutation of a live region, and a queued announcement. Nothing
    // on the path throttles.
    //
    // Measured over one real download: 4,627 progress events, 4,632 writes,
    // 211 of which changed the string. The hundred events below all round to
    // the same percentage of the same file, which is the shape of the other
    // 4,421.
    const { app, report } = await localRun();
    const writes = watchText(app.status);

    for (let step = 0; step < 100; step += 1) {
      report({
        kind: 'downloading',
        file: 'onnx/model_quantized.onnx',
        ratio: 0.42 + step / 100000,
      });
    }

    expect(writes).toEqual(['Baixando o modelo local… model_quantized.onnx, 42%']);
  });

  it('writes again as soon as the sentence does change', async () => {
    // The other half: a comparison that silenced the region altogether would
    // pass the test above and show a percentage frozen at its first value.
    const { app, report } = await localRun();
    const writes = watchText(app.status);

    report({ kind: 'downloading', file: 'tokenizer.json', ratio: 0.42 });
    report({ kind: 'downloading', file: 'tokenizer.json', ratio: 0.42 });
    report({ kind: 'downloading', file: 'tokenizer.json', ratio: 0.43 });
    report({ kind: 'downloading', file: 'onnx/model_quantized.onnx', ratio: 0.43 });
    report({ kind: 'preparing' });
    report({ kind: 'preparing' });

    expect(writes).toEqual([
      'Baixando o modelo local… tokenizer.json, 42%',
      'Baixando o modelo local… tokenizer.json, 43%',
      'Baixando o modelo local… model_quantized.onnx, 43%',
      'Carregando o modelo local na memória…',
    ]);
  });

  it('does not swallow a stage that repeats after something else was said', async () => {
    // The comparison is against what the line currently says, not against the
    // last progress event — the stage line and the model line share the region,
    // so a `preparing` that follows the stage text has to be written.
    const { app, report } = await localRun();
    report({ kind: 'preparing' });
    const writes = watchText(app.status);

    app.status.textContent = 'Interpretando a descrição…';
    report({ kind: 'preparing' });

    expect(writes).toEqual(['Interpretando a descrição…', 'Carregando o modelo local na memória…']);
  });
});

describe('one provider never gets the other provider’s key', () => {
  // The whole class, and it is reachable with nobody making a mistake. The box
  // is prefilled from storage at mount, `refreshEngine` used to rewrite the
  // caption around whatever was already in it, and nothing anywhere checks the
  // shape of a key: the proxy relays what it is handed and `JevInterpreter`
  // only checks it is not empty. So a return visit opened on Claude, switched
  // to Jev and clicked would put `sk-ant-…` in `x-typesafe-key` and send it to
  // TypeSafe — and what the person would then read is "confira se ela é uma
  // chave da TypeSafe", which sends them for another key and never says the
  // Anthropic one now needs rotating.

  it('empties the box when the engine that reads it changes', async () => {
    const app = mountHarness({ stored: 'sk-ant-api03-guardada' });
    expect(app.apiKey.value).toBe('sk-ant-api03-guardada');

    app.pick('jev');
    expect(app.apiKey.value).toBe('');

    app.apiKey.value = 'ts-chave-do-usuario';
    app.pick('claude');
    expect(app.apiKey.value).toBe('');
  });

  it('leaves the box alone when the engine that does not read it is passed through', () => {
    // The local engine never reads the field, so going through it is not a
    // change of key and clearing there would throw away a working one for
    // nothing.
    const app = mountHarness({ stored: 'sk-ant-api03-guardada' });

    app.pick('local');
    expect(app.apiKey.value).toBe('sk-ant-api03-guardada');

    app.pick('claude');
    expect(app.apiKey.value).toBe('sk-ant-api03-guardada');
  });

  it('still empties it when the other engine is reached by way of the local one', () => {
    const app = mountHarness({ stored: 'sk-ant-api03-guardada' });

    app.pick('local');
    app.pick('jev');

    expect(app.apiKey.value).toBe('');
  });

  it('hands Jev no key that a Claude visit left in the box', async () => {
    // End to end, through the real `mountApp`: the value that reaches the Jev
    // factory is what would have gone into `x-typesafe-key`.
    const app = mountHarness({ stored: 'sk-ant-api03-guardada' });
    app.description.value = 'uma ferraria com bigorna e fornalha acesa';

    app.pick('jev');
    app.generate.click();
    await settle();

    expect(app.jevKeysSeen.join('')).not.toContain('sk-ant');
  });

  it('refuses an Anthropic key on a Jev run, and says it was not sent', async () => {
    // What the clearing cannot cover: a key pasted straight into a Jev session
    // out of the wrong password-manager entry, with no engine change to react
    // to. Refused before the request is built, so nothing leaves.
    const app = mountHarness({ engine: 'jev' });
    app.description.value = 'uma ferraria com bigorna e fornalha acesa';
    app.apiKey.value = 'sk-ant-api03-colada-por-engano';

    app.generate.click();
    await settle();

    expect(app.jevKeysSeen).toEqual([]);
    expect(app.asked).toEqual([]);
    expect(app.store.items.has(API_KEY_ITEM)).toBe(false);
    // "Não foi enviada" is the load-bearing half: a disclosed key has to be
    // rotated and a refused one does not, so the sentence has to say which
    // happened rather than sending the person for another key.
    expect(app.text()).toContain('não foi enviada');
  });

  it('refuses it before it draws a seed, the way an empty description is refused', async () => {
    // A refusal that costs nothing should cost nothing: the seed field is left
    // as it was, so the map the person was about to make is still reachable.
    const app = mountHarness({ engine: 'jev', entropySeed: 987654 });
    app.description.value = 'uma ferraria com bigorna';
    app.apiKey.value = 'sk-ant-api03-colada-por-engano';
    app.seed.value = '';

    app.generate.click();
    await settle();

    expect(app.seed.value).toBe('');
  });

  it('lets a key that is not Anthropic’s through to Jev', async () => {
    // The other half. A refusal that fired on everything would be a page that
    // cannot run the engine this front exists to add, and there is no published
    // shape for a TypeSafe key to test positively against.
    const app = mountHarness({ engine: 'jev' });
    app.description.value = 'uma ferraria com bigorna';
    app.apiKey.value = 'ts-chave-do-usuario';

    app.generate.click();
    await settle();

    expect(app.jevKeysSeen).toEqual(['ts-chave-do-usuario']);
    expect(app.asked).toHaveLength(1);
  });

  it('leaves an Anthropic key alone on a Claude run', async () => {
    const app = mountHarness();
    app.description.value = 'um salão de taverna';
    app.apiKey.value = 'sk-ant-api03-nova';

    app.generate.click();
    await settle();

    expect(app.keysSeen).toEqual(['sk-ant-api03-nova']);
    expect(app.asked).toHaveLength(1);
  });
});

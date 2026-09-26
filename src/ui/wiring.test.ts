/**
 * The line production actually runs on.
 *
 * `mount.test.ts` drives the page with all six services stood in for, which is
 * what makes it able to test the page at all — and it means `defaultServices`
 * runs there and has its result thrown away. Every one of those six defaults is
 * a total failure of the product when it is wrong, and none of them would be
 * noticed: the key never sent, the key never remembered, the download button
 * inert, every blank seed the same number forever.
 *
 * So this file mounts with the defaults in place and moves as little as it has
 * to. Five of the six are exercised for real — the marking library, the
 * browser's storage, the platform's entropy, the saver and the file name. The
 * sixth is the interpreter, which is the one service that cannot be reached
 * without leaving the machine, so the class the page names is replaced by one
 * that records what it was handed. Nothing here touches the network.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Constraints, Interpreter } from '../core/types';

import { mountApp } from './mount';
import { API_KEY_ITEM } from './storage';
import type { KeyStore } from './storage';

/** What the stand-in interpreter recorded, and what it answers with. */
const spy = vi.hoisted(() => ({
  /** Every key `defaultServices` built an interpreter around, in order. */
  keys: [] as string[],
  /** Every description that reached it. */
  asked: [] as string[],
}));

vi.mock('../interpreter/claude', () => ({
  ClaudeInterpreter: class implements Interpreter {
    constructor(options: { apiKey: string }) {
      spy.keys.push(options.apiKey);
    }

    interpret(text: string): Promise<Constraints> {
      spy.asked.push(text);
      return Promise.resolve({
        placeType: 'tavern_hall',
        light: 'dim',
        condition: 'lived_in',
        clutter: 0.4,
        features: [],
        unresolved: [],
      });
    }
  },
}));

// --- A document, by hand -----------------------------------------------------
//
// The same slice `mount.test.ts` stands in for, plus the three things the real
// saver uses: a body to attach to, a `download` attribute and `remove`.

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
  href = '';
  download = '';
  spellcheck = false;
  rows = 0;
  hidden = false;
  disabled = false;
  width = 0;
  height = 0;
  parent: FakeElement | undefined;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    if (this.parent === undefined) {
      return;
    }
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }

  setAttribute(name: string, value: string): void {
    this.ownerDocument.attributes.push(`${this.tagName}[${name}=${value}]`);
  }

  addEventListener(type: string, handler: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  click(): void {
    this.ownerDocument.clicked.push(this);
    for (const handler of this.listeners.get('click') ?? []) {
      handler();
    }
  }

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
  readonly clicked: FakeElement[] = [];
  readonly attributes: string[] = [];
  readonly body: FakeElement;

  constructor() {
    this.body = new FakeElement('body', this);
  }

  createElement(tag: string): FakeElement {
    const element = new FakeElement(tag, this);
    this.created.push(element);
    return element;
  }
}

function descendants(element: FakeElement): FakeElement[] {
  return [element, ...element.children.flatMap(descendants)];
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

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((done) => setTimeout(done, 0));
  }
}

type Page = {
  doc: FakeDocument;
  root: FakeElement;
  description: FakeElement;
  apiKey: FakeElement;
  seed: FakeElement;
  generate: FakeElement;
  download: FakeElement;
};

/**
 * The page, with `overrides` and nothing else stood in for.
 *
 * Every test below passes at most one override, and says why in its own
 * comment. Everything not named here is the production default.
 */
function mountPage(overrides: Parameters<typeof mountApp>[1] = {}): Page {
  const doc = new FakeDocument();
  const root = new FakeElement('div', doc);
  mountApp(root as unknown as HTMLElement, overrides);
  return {
    doc,
    root,
    description: byId(root, 'gs-description'),
    apiKey: byId(root, 'gs-api-key'),
    seed: byId(root, 'gs-seed'),
    generate: buttonLabelled(root, 'Gerar mapa'),
    download: buttonLabelled(root, 'Baixar PNG'),
  };
}

/** A `localStorage` for the length of one test, put back afterwards. */
function lendLocalStorage(store: KeyStore): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: store,
  });
}

function mapStore(initial?: string): KeyStore & { items: Map<string, string> } {
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

describe('what the page is wired to when nobody stands in for anything', () => {
  afterEach(() => {
    spy.keys.length = 0;
    spy.asked.length = 0;
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.restoreAllMocks();
  });

  it('builds the interpreter around the key that was pasted, not around nothing', async () => {
    // The one that matters most. An interpreter built with an empty key makes
    // every generation die with "falta a chave da API" however right the key
    // in the field is, and nothing else in the project would see it.
    const page = mountPage();
    page.description.value = 'um salão de taverna';
    page.apiKey.value = '  sk-ant-api03-a-chave-de-verdade\n';

    page.generate.click();
    await settle();

    expect(spy.keys).toEqual(['sk-ant-api03-a-chave-de-verdade']);
    expect(spy.asked).toEqual(['um salão de taverna']);
  });

  it('remembers the key in the browser it is sitting in', async () => {
    // 4.2 in one line: the key survives the visit. A store that forgets is a
    // page that asks for the key again every time, which is the whole of what
    // this was for.
    const store = mapStore('sk-ant-api03-guardada');
    lendLocalStorage(store);

    const page = mountPage();
    expect(page.apiKey.value).toBe('sk-ant-api03-guardada');

    page.description.value = 'um salão de taverna';
    page.apiKey.value = 'sk-ant-api03-a-nova';
    page.generate.click();
    await settle();

    expect(store.items.get(API_KEY_ITEM)).toBe('sk-ant-api03-a-nova');
  });

  it('opens with an empty field, rather than refusing, where there is no storage to have', () => {
    // No `localStorage` at all is the private window and the blocked origin.
    // The fallback store is what keeps the page from throwing on the way up.
    expect(() => mountPage()).not.toThrow();
    expect(mountPage().apiKey.value).toBe('');
  });

  it('draws a blank seed from the platform, not from a number written here', async () => {
    // A fixed default would hand back the same map for every blank seed, for
    // ever, and the page would still look like it was drawing one.
    const drawn = 314_159;
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(
      array: T,
    ): T => {
      (array as unknown as Uint32Array)[0] = drawn;
      return array;
    });

    const page = mountPage();
    page.description.value = 'um salão de taverna';
    page.seed.value = '';

    page.generate.click();
    await settle();

    expect(page.seed.value).toBe(String(drawn));
  });

  it('hands the encoded map to the browser under the name the map earned', async () => {
    // The only stand-in is the encoder, which is a browser rasteriser and
    // nothing this file can supply. What it produces is a real `Blob`, and
    // everything downstream of it — the saver, the object URL, the anchor, the
    // file name — is the production one.
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    const page = mountPage({ toPng: () => Promise.resolve(png) });
    page.description.value = 'um salão de taverna';
    page.seed.value = '4242';

    page.generate.click();
    await settle();
    expect(page.download.disabled).toBe(false);

    page.download.click();
    await settle();

    const anchors = page.doc.created.filter((node) => node.tagName === 'a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('gridsmith-tavern-hall-seed-4242.png');
    expect(anchors[0].href.startsWith('blob:')).toBe(true);
    expect(page.doc.clicked).toContain(anchors[0]);
  });

  it('draws the map with the library the page ships with', async () => {
    // The marking library is real here, so a scene it cannot supply an asset
    // for is a failure this test sees. Nothing is stood in for at all.
    const page = mountPage();
    page.description.value = 'um salão de taverna';
    page.seed.value = '4242';

    page.generate.click();
    await settle();

    expect(page.download.disabled).toBe(false);
  });
});

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
 * to. Four of the six run here as they run in a browser — the marking library,
 * the browser's storage, the platform's entropy and the saver — and replacing
 * any of the four reddens a test below.
 *
 * The other two cannot be reached from Node at all. The interpreter is a
 * network round trip, so the class the page names is replaced by one that
 * records what it was handed — and the line that builds it is still pinned,
 * because the trimmed key and the typed description have to arrive at that
 * constructor. The encoder is a browser rasteriser, so one test hands back a
 * `Blob` in its place, and that stand-in is total: `toPng` in `defaultServices`
 * is the one default of the six this file leaves free, since there is nothing
 * under Node that could tell the real encoder from any other. What it produces
 * is tested where it lives, and what happens to the bytes afterwards — the
 * saver, the object URL, the anchor, the file name — is production code here.
 * Nothing touches the network.
 *
 * One thing this file cannot pin, said plainly rather than implied away:
 * `AssetLibrary.bitmap` needs a canvas to paint its marker on, so under Node
 * every bitmap request fails — and `resolveBitmaps` swallows a failed one and
 * has the paint loop fill magenta, which means a render that resolved no bitmap
 * at all still finishes successfully. A finished render therefore says nothing
 * about the library. What the library is held to here is the half that does
 * answer the same under Node as in a browser: its catalogue, through `get` and
 * `query`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRng } from '../core/prng';
import type { AssetLibrary, Constraints, Interpreter, Place, Scene } from '../core/types';
import { generate } from '../generator/generate';
import { resolve } from '../interpreter/resolve';
import { featuresFor } from '../interpreter/vocabulary';

import { mountApp } from './mount';
import type { GenerationDeps, GenerationInput } from './pipeline';
import { API_KEY_ITEM } from './storage';
import type { KeyStore } from './storage';

/** What the stand-in interpreter recorded, and what it answers with. */
const spy = vi.hoisted(() => ({
  /** Every key `defaultServices` built an interpreter around, in order. */
  keys: [] as string[],
  /** Every description that reached it. */
  asked: [] as string[],
  /** Every asset library `defaultServices` handed the loop, in order. */
  libraries: [] as AssetLibrary[],
}));

// The loop itself is not stood in for — this wrapper records the library the
// page built and then calls the real one. The library is the one default with
// no observable effect from outside the page: the interpreter is seen through
// the constructor, the store through what is in it afterwards, the entropy
// through the seed field and the saver through the anchor, but the library goes
// in one side of `generateMap` and never comes out. Recording it is the only
// way to assert on the object `defaultServices` actually built, rather than on
// a second one built here that would prove nothing about the page.
vi.mock('./pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline')>();
  return {
    ...actual,
    generateMap: (input: GenerationInput, deps: GenerationDeps) => {
      spy.libraries.push(deps.library);
      return actual.generateMap(input, deps);
    },
  };
});

vi.mock('../interpreter/claude', () => ({
  ClaudeInterpreter: class implements Interpreter {
    constructor(options: { apiKey: string }) {
      spy.keys.push(options.apiKey);
    }

    interpret(text: string): Promise<Constraints> {
      spy.asked.push(text);
      return Promise.resolve({
        place: { building: 'tavern', room: 'hall' },
        light: 'dim',
        condition: 'lived_in',
        clutter: 0.4,
        furnishing: 0.4,
        features: [],
        excluded: [],
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

/**
 * Lets every pending promise settle, on the fake clock this file runs on.
 *
 * The clock is fake for the sake of the saver, which leaves a timer running for
 * a quarter of a second after every save; a real one outlives the test and
 * fires against a document that is already gone. Moving the fake clock is then
 * also how the turns between the click and the finished map are taken.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await vi.advanceTimersByTimeAsync(1);
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

/**
 * The six building/room pairs in the approved vocabulary.
 * Keep this list in step with the pair matrix when it grows.
 */
const PLACE_TYPES: Place[] = [
  { building: 'tavern', room: 'hall' },
  { building: 'tavern', room: 'room' },
  { building: 'tavern', room: 'storeroom' },
  { building: 'dungeon', room: 'hall' },
  { building: 'dungeon', room: 'room' },
  { building: 'dungeon', room: 'storeroom' },
];

/** A scene of `place` at `seed`, asking for everything that place can hold. */
function sceneFor(place: Place, seed: number): Scene {
  const params = resolve(
    {
      place,
      light: 'dim',
      condition: 'lived_in',
      clutter: 0.6,
      furnishing: 0.6,
      features: featuresFor(place),
      excluded: [],
      unresolved: [],
    },
    seed,
  );
  return generate(params, createRng(seed));
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
  /**
   * Whatever `localStorage` this runtime came with, put back after every test.
   *
   * Captured and restored rather than deleted, which is what `storage.test.ts`
   * does with the same global and for the same reason: deleting unconditionally
   * is only correct for as long as Node happens not to supply one, and a test
   * whose cleanup quietly strips a real global is a test that breaks the file
   * that runs after it.
   */
  const hadLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  const restoreLocalStorage = (): void => {
    if (hadLocalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', hadLocalStorage);
    }
  };

  beforeEach(() => {
    // The saver keeps a timer alive for a quarter of a second after the click,
    // on purpose. Real, it outlives the test and revokes a URL long after the
    // page it belonged to is gone; fake, it is discarded with the clock. The
    // clock here is never moved as far as that quarter second, so the
    // revocation is never reached — `download.test.ts` is where it is.
    vi.useFakeTimers();
  });

  afterEach(() => {
    spy.keys.length = 0;
    spy.asked.length = 0;
    spy.libraries.length = 0;
    restoreLocalStorage();
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    // The precondition is established rather than assumed: every other test in
    // this file lends a store, and this one needs the global to be absent, so
    // it says so instead of depending on Node not having one today.
    //
    // What this pins is that the page comes up and shows an empty field. It is
    // not what pins `nullKeyStore()`: `readApiKey` and `writeApiKey` each wrap
    // their own access in a try/catch, so the page would come up just the same
    // with `undefined` in place of the fallback store, and those two catches
    // are pinned in `storage.test.ts` where they live. The fallback is a guard
    // no test here can tell from its absence.
    restoreLocalStorage();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();

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

  it('draws with the library the page ships with, and survives it supplying no bitmap', async () => {
    // What a finished render proves, and only that. Every bitmap request fails
    // under Node, `resolveBitmaps` swallows each one and the paint loop fills
    // magenta, so this is the page coming through a library that hands it
    // nothing — which is worth pinning, because a render that threw would be a
    // blank page. It is not evidence that the library has anything in it; that
    // is the test below.
    const page = mountPage();
    page.description.value = 'um salão de taverna';
    page.seed.value = '4242';

    page.generate.click();
    await settle();

    expect(page.download.disabled).toBe(false);
  });

  it('ships a catalogue that answers for every prop the generator places', async () => {
    // The library the page built, asserted on directly — a catalogue with
    // nothing in it renders exactly as well as the real one under Node, so the
    // only thing that can tell them apart is asking it what it has.
    //
    // A missing id is not a crash: the renderer paints a magenta rectangle
    // where the prop should be and the run finishes. Publish with a library
    // that answers for nothing and every map in the product comes out a field
    // of magenta boxes, with the suite green.
    const page = mountPage();
    page.description.value = 'um salão de taverna';
    page.generate.click();
    await settle();

    const library = spy.libraries[0];
    expect(library).toBeDefined();

    const missing = new Set<string>();
    let placed = 0;
    for (const place of PLACE_TYPES) {
      let placedForPair = 0;
      for (let seed = 1; seed <= 25; seed += 1) {
        for (const prop of sceneFor(place, seed).props) {
          placed += 1;
          placedForPair += 1;
          const asset = library.get(prop.assetId);
          if (asset === undefined) {
            missing.add(prop.assetId);
            continue;
          }
          expect(asset.kind).toBe(prop.layer);
          const footprint = prop.rotation === 90 || prop.rotation === 270
            ? { w: asset.footprint.h, h: asset.footprint.w }
            : asset.footprint;
          expect(prop.footprint).toEqual(footprint);
        }
      }
      expect(placedForPair).toBeGreaterThan(0);
    }

    expect(placed).toBeGreaterThan(0);
    expect([...missing]).toEqual([]);

    // The three asset kinds it does carry, and the fourth it leaves out on purpose:
    // floors are flat colour by design, so `tile/...` resolving to nothing is
    // the plan working rather than the same gap in a fourth place.
    for (const kind of ['anchor', 'group', 'scatter'] as const) {
      expect(library.query([], kind).length).toBeGreaterThan(0);
    }
    expect(library.query([], 'tile')).toEqual([]);
  });
});

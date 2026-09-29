import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Params, Place } from '../core/types';

import { createBlobSaver, FILENAME_PREFIX, mapFilename, REVOKE_DELAY_MS } from './download';

function paramsFor(overrides: Partial<Params> = {}): Params {
  return {
    place: { building: 'tavern', room: 'hall' },
    size: { w: 16, h: 14 },
    light: 'dim',
    condition: 'lived_in',
    clutter: 0.4,
    furnishing: 0.4,
    features: [],
    excluded: [],
    doorCount: 2,
    seed: 4242,
    conflicts: [],
    ...overrides,
  };
}

describe('naming the exported map', () => {
  it('carries the kind of place and the seed', () => {
    // A folder of exports is the index of which number produced what. Both
    // halves have to be in the name or the map cannot be found again.
    const name = mapFilename(paramsFor());

    expect(name).toContain('tavern-hall');
    expect(name).toContain('4242');
  });

  it('is written in one language, the same one the rest of the code is in', () => {
    // `messages.ts` is the only module that speaks Portuguese, because it is
    // the only one whose strings are read as a sentence. A file name is read by
    // a shell and sorted by a file manager, and half of one in each language
    // reads as neither.
    expect(mapFilename(paramsFor())).toBe('gridsmith-tavern-hall-seed-4242.png');
  });

  it('is a PNG, under the project prefix', () => {
    const name = mapFilename(paramsFor());

    expect(name.startsWith(`${FILENAME_PREFIX}-`)).toBe(true);
    expect(name.endsWith('.png')).toBe(true);
  });

  it('gives two seeds of the same place two names', () => {
    expect(mapFilename(paramsFor({ seed: 1 }))).not.toBe(mapFilename(paramsFor({ seed: 2 })));
  });

  it('gives two kinds of place at one seed two names', () => {
    const names = ([{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'tavern', room: 'storeroom' }] as Place[]).map(
      (place) => mapFilename(paramsFor({ place })),
    );

    expect(new Set(names).size).toBe(3);
  });

  it('names a dungeon room with both parts of its place', () => {
    expect(mapFilename(paramsFor({ place: { building: 'dungeon', room: 'room' }, seed: 42 }))).toBe(
      'gridsmith-dungeon-room-seed-42.png',
    );
  });

  it('cannot be talked into a path', () => {
    // `place` is closed by the schema before it reaches here, but this name
    // is handed to an operating system, and a slash in one is worth a line to
    // make impossible rather than a paragraph to reason about.
    const name = mapFilename(paramsFor({ place: { building: '../../etc/passwd', room: 'hall' } as unknown as Place }));

    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });

  it('does not open the distinguishing part with a hyphen', () => {
    // A negative seed would otherwise produce `gridsmith-tavern-hall-seed--7`,
    // and a name beginning a segment with a hyphen is read as a flag by some
    // shells.
    const name = mapFilename(paramsFor({ seed: -7 }));

    expect(name).toContain('7');
    expect(name).not.toContain('--');
  });
});

// --- Handing the file to the browser -----------------------------------------
//
// The claim this block replaces was that `createBlobSaver` is untestable under
// Node and has nothing to test. Neither half held. It has four observable
// effects — a URL made, an attribute set, a click, a URL revoked — and each one
// of them is the whole export path when it is the one that is missing. The
// document below stands in for the four calls the saver makes on it and records
// the order they came in, because the order is the part Firefox is strict
// about.

type Trace = string[];

class FakeAnchor {
  href = '';
  download = '';
  parent: FakeBody | undefined;

  constructor(readonly trace: Trace) {}

  click(): void {
    // Recorded with its attachment, because a click on a detached node is
    // exactly the failure that produces no file and no error.
    this.trace.push(this.parent === undefined ? 'click-detached' : 'click-attached');
  }

  remove(): void {
    if (this.parent === undefined) {
      return;
    }
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
    this.trace.push('remove');
  }
}

class FakeBody {
  readonly children: FakeAnchor[] = [];

  constructor(readonly trace: Trace) {}

  append(...nodes: FakeAnchor[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
      this.trace.push('append');
    }
  }
}

class FakeDocument {
  readonly trace: Trace = [];
  readonly body = new FakeBody(this.trace);
  readonly anchors: FakeAnchor[] = [];

  createElement(tag: string): FakeAnchor {
    this.trace.push(`create-${tag}`);
    const anchor = new FakeAnchor(this.trace);
    this.anchors.push(anchor);
    return anchor;
  }
}

function pngBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

function saveInto(doc: FakeDocument, filename = 'gridsmith-tavern-hall-seed-4242.png'): void {
  createBlobSaver(doc as unknown as Document)(pngBlob(), filename);
}

describe('handing the finished image to the browser', () => {
  // The clock is fake for every test here, not only for the two that read it.
  // The saver leaves a timer running for a quarter of a second after every
  // save, so a test that does not touch the clock still ends with a real timer
  // pending — which then fires against a document that was thrown away, after
  // the test that made it has finished.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('points an anchor at the blob, with nothing stood in for', () => {
    // No double anywhere in this one: `URL.createObjectURL` exists under Node
    // and takes a real `Blob`, so the URL the browser would be handed is the
    // URL this assertion reads.
    const doc = new FakeDocument();

    saveInto(doc);

    expect(doc.anchors).toHaveLength(1);
    expect(doc.anchors[0].href.startsWith('blob:')).toBe(true);
  });

  it('clicks the anchor', () => {
    // Without the click the button does nothing at all, silently: no file, no
    // failure, nothing on screen.
    const doc = new FakeDocument();

    saveInto(doc);

    expect(doc.trace.filter((step) => step.startsWith('click'))).toHaveLength(1);
  });

  it('asks for the file under the name it was given', () => {
    // The `download` attribute is what turns a navigation into a save, and it
    // is what carries the seed into the file name.
    const doc = new FakeDocument();

    saveInto(doc, 'gridsmith-tavern-storeroom-seed-7.png');

    expect(doc.anchors[0].download).toBe('gridsmith-tavern-storeroom-seed-7.png');
  });

  it('clicks it while it is in the document, not while it is loose', () => {
    // Firefox serves a click only from a node that is in the tree. A detached
    // one is ignored, and ignored quietly.
    const doc = new FakeDocument();

    saveInto(doc);

    expect(doc.trace).toContain('click-attached');
    expect(doc.trace).not.toContain('click-detached');
    expect(doc.trace.indexOf('append')).toBeLessThan(doc.trace.indexOf('click-attached'));
  });

  it('takes the anchor back out again', () => {
    const doc = new FakeDocument();

    saveInto(doc);

    expect(doc.body.children).toEqual([]);
  });

  it('revokes the object URL, so twenty maps in a session are not all held', () => {
    // The leak the comment on this function spends a paragraph on. Without the
    // revocation every decoded image stays alive for the life of the tab.
    //
    // Advanced by the literal rather than by `REVOKE_DELAY_MS`: a clock moved
    // by the same constant the code waits on arrives at the right moment for
    // every value of it, zero included, so it is the one number this assertion
    // could not have checked.
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const doc = new FakeDocument();

    saveInto(doc);
    vi.advanceTimersByTime(250);

    expect(revoke).toHaveBeenCalledWith(doc.anchors[0].href);
  });

  it('does not revoke it out from under the click', () => {
    // The other half. Firefox reads the URL after the handler returns, so a
    // revocation on the next line is a download that never starts — and, again,
    // nothing throws. The wait is asserted at the tick before it and the tick
    // it lands on, which is what makes a shortened delay fail here rather than
    // in Firefox.
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const doc = new FakeDocument();

    saveInto(doc);

    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('waits exactly as long as the constant the comment argues for', () => {
    // The two tests above move a literal clock, so the constant itself is what
    // is left to pin: the number in the module is the number they assume.
    expect(REVOKE_DELAY_MS).toBe(250);
  });
});

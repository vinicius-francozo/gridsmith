/**
 * The page: the only module in this project that touches the document.
 *
 * Everything decidable was decided somewhere else — the seed in `seed.ts`, the
 * wording in `messages.ts`, the loop in `pipeline.ts`, the file name in
 * `download.ts` — and every one of those is a pure function covered by tests.
 * What is left here is building elements, reading fields and putting text into
 * them, which is what makes this file long and shallow rather than short and
 * clever.
 *
 * The key never leaves this file except as a constructor argument to the
 * interpreter. It is not put in the URL, because no form is created here and
 * nothing writes to `location` — a URL is the one place a secret gets copied
 * into a chat window by accident. It is not logged, because nothing in
 * `src/ui/` calls `console` at all, and the two async handlers below catch
 * everything so that no exception escapes to the browser's own console
 * carrying an SDK error with the request headers hanging off its `cause`.
 */

import type { AssetLibrary, Interpreter, Params } from '../core/types';
import { createPlaceholderLibrary } from '../assets/placeholder';
import { ClaudeInterpreter } from '../interpreter/claude';
import { toPng } from '../renderer/png';
import type { RenderTarget } from '../renderer/render';

import { createBlobSaver, mapFilename } from './download';
import type { BlobSaver } from './download';
import { describeEntries, describeFailure, describeResult, UI_TEXT } from './messages';
import type { Failure } from './messages';
import { generateMap } from './pipeline';
import { cryptoEntropy, randomSeed, readSeed } from './seed';
import type { Entropy } from './seed';
import { browserKeyStore, nullKeyStore, readApiKey, writeApiKey } from './storage';
import type { KeyStore } from './storage';

/**
 * Everything the page reaches for outside itself.
 *
 * It exists so `mount.test.ts` can drive the page without a network, a browser
 * rasteriser or a download folder. In production every one of these is the real
 * thing, filled in by `defaultServices`.
 */
export type AppServices = {
  /** Where the API key is remembered between visits. */
  storage: KeyStore;
  /** The asset library the renderer draws from. */
  library: AssetLibrary;
  /** Builds an interpreter around the key the person pasted. */
  createInterpreter: (apiKey: string) => Interpreter;
  /** Encodes the drawn canvas. */
  toPng: (target: RenderTarget) => Promise<Blob>;
  /** Hands the encoded image to the browser. */
  saveBlob: BlobSaver;
  /** The source the seed is drawn from when the field is empty. */
  entropy: Entropy;
};

/** The real thing, for every service the caller did not stand in for. */
function defaultServices(doc: Document): AppServices {
  return {
    storage: browserKeyStore() ?? nullKeyStore(),
    library: createPlaceholderLibrary(),
    createInterpreter: (apiKey) => new ClaudeInterpreter({ apiKey }),
    toPng,
    saveBlob: createBlobSaver(doc),
    entropy: cryptoEntropy,
  };
}

/**
 * Mounts the application into `root`.
 *
 * The signature is frozen: `src/main.ts` finds `#app`, refuses to continue
 * without it, and hands the element over. Nothing is read from the document
 * here beyond what `root` leads to.
 */
export function mount(root: HTMLElement): void {
  mountApp(root, {});
}

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #14161a; color: #e8e6e1;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.gs-app { max-width: 1180px; margin: 0 auto; padding: 24px 20px 64px; }
.gs-app h1 { margin: 0; font-size: 26px; letter-spacing: 0.01em; }
.gs-tagline { margin: 4px 0 24px; color: #9aa0a6; }
.gs-layout { display: grid; gap: 24px; grid-template-columns: minmax(280px, 340px) 1fr; }
@media (max-width: 760px) { .gs-layout { grid-template-columns: 1fr; } }
.gs-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.gs-field label { font-size: 13px; color: #b8bcc2; }
.gs-field input, .gs-field textarea {
  width: 100%; padding: 9px 11px; border-radius: 7px; border: 1px solid #333840;
  background: #1c1f25; color: inherit; font: inherit; }
.gs-field textarea { resize: vertical; }
.gs-note { font-size: 12px; color: #7f858c; }
.gs-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.gs-actions button {
  padding: 10px 16px; border-radius: 7px; border: 1px solid #3a4150;
  background: #2b3240; color: inherit; font: inherit; cursor: pointer; }
.gs-actions button:disabled { opacity: 0.45; cursor: default; }
.gs-status { margin: 16px 0 0; color: #9aa0a6; min-height: 1.5em; }
.gs-failure { margin: 16px 0 0; padding: 12px 14px; border-radius: 7px;
  border: 1px solid #6b2b2b; background: #2a1a1a; }
.gs-failure p { margin: 0; }
.gs-failure .gs-detail { margin-top: 6px; font-size: 12px; color: #c39a9a;
  font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
.gs-notices { margin-top: 16px; }
.gs-notices h2 { margin: 0 0 6px; font-size: 13px; color: #b8bcc2; }
.gs-notices ul { margin: 0 0 16px; padding-left: 20px; color: #cfc6a8; }
.gs-canvas-wrap { border: 1px solid #333840; border-radius: 8px; padding: 10px;
  background: #1c1f25; overflow: auto; }
.gs-canvas-wrap canvas { display: block; max-width: 100%; height: auto; }
`;

/**
 * Mounts with `overrides` standing in for parts of the environment.
 *
 * Separate from `mount` rather than an optional second parameter, because
 * `mount`'s signature is frozen at exactly one argument and `src/main.ts` is
 * typechecked against it.
 */
export function mountApp(root: HTMLElement, overrides: Partial<AppServices>): void {
  const doc = root.ownerDocument;
  const services: AppServices = { ...defaultServices(doc), ...overrides };

  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    if (className !== undefined) {
      element.className = className;
    }
    return element;
  };

  // --- The shell ------------------------------------------------------------

  const style = make('style');
  style.textContent = STYLE;

  const app = make('div', 'gs-app');
  const heading = make('h1');
  heading.textContent = UI_TEXT.title;
  const tagline = make('p', 'gs-tagline');
  tagline.textContent = UI_TEXT.tagline;

  // --- The fields -----------------------------------------------------------

  /** A labelled field, with the label bound to the control by id. */
  const field = (id: string, label: string): HTMLDivElement => {
    const wrap = make('div', 'gs-field');
    const caption = make('label');
    caption.htmlFor = id;
    caption.textContent = label;
    wrap.append(caption);
    return wrap;
  };

  const descriptionField = field('gs-description', UI_TEXT.descriptionLabel);
  const description = make('textarea');
  description.id = 'gs-description';
  description.rows = 4;
  description.placeholder = UI_TEXT.descriptionPlaceholder;
  descriptionField.append(description);

  const apiKeyField = field('gs-api-key', UI_TEXT.apiKeyLabel);
  const apiKey = make('input');
  apiKey.id = 'gs-api-key';
  // `password` so the key is not readable over a shoulder or in a screen share,
  // and `off` so the browser does not offer to sync it anywhere. No `name`:
  // a named control is what a form serialises into a query string, and there is
  // deliberately no form here for it to be serialised by.
  apiKey.type = 'password';
  apiKey.autocomplete = 'off';
  apiKey.spellcheck = false;
  apiKey.placeholder = UI_TEXT.apiKeyPlaceholder;
  apiKey.value = readApiKey(services.storage);
  const apiKeyNote = make('p', 'gs-note');
  apiKeyNote.textContent = UI_TEXT.apiKeyNote;
  apiKeyField.append(apiKey, apiKeyNote);

  const seedField = field('gs-seed', UI_TEXT.seedLabel);
  const seed = make('input');
  seed.id = 'gs-seed';
  seed.type = 'text';
  seed.inputMode = 'numeric';
  seed.autocomplete = 'off';
  seed.placeholder = UI_TEXT.seedPlaceholder;
  const seedNote = make('p', 'gs-note');
  seedNote.textContent = UI_TEXT.seedNote;
  seedField.append(seed, seedNote);

  const actions = make('div', 'gs-actions');
  const generateButton = make('button');
  generateButton.type = 'button';
  generateButton.textContent = UI_TEXT.generate;
  const downloadButton = make('button');
  downloadButton.type = 'button';
  downloadButton.textContent = UI_TEXT.download;
  downloadButton.disabled = true;
  actions.append(generateButton, downloadButton);

  const status = make('p', 'gs-status');
  // Both of these change while the focus is still on the button that started
  // the run, so nothing would announce them on its own. The status line is
  // polite because it interrupts nothing worth interrupting; the failure is
  // assertive because it is the answer to what was just asked for.
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const failure = make('div', 'gs-failure');
  failure.hidden = true;
  failure.setAttribute('role', 'alert');
  failure.setAttribute('aria-live', 'assertive');

  const notices = make('div', 'gs-notices');

  const controls = make('div', 'gs-controls');
  controls.append(
    descriptionField,
    apiKeyField,
    seedField,
    actions,
    status,
    failure,
    notices,
  );

  // --- The map --------------------------------------------------------------

  const surface = make('div', 'gs-canvas-wrap');
  const target = make('canvas');
  surface.append(target);

  const layout = make('div', 'gs-layout');
  layout.append(controls, surface);
  app.append(heading, tagline, layout);
  root.replaceChildren(style, app);

  // --- Showing things -------------------------------------------------------

  /**
   * Shows `value`, or takes the failure region back off the screen.
   *
   * Revealed before it is filled, and in that order deliberately. `hidden` is
   * `display: none`, so a region filled while it is still hidden is not in the
   * accessibility tree at the moment its children change: the mutation an alert
   * region exists to announce happens where nothing is watching, and the
   * container then appears with the text already inside it — which a screen
   * reader may treat as nothing having happened. Revealing first puts an empty
   * live region on the screen and then mutates it, which is the shape the
   * announcement is defined for.
   *
   * Clearing goes the other way round for the same reason: hide first, then
   * empty, so the emptying is not itself announced as a change.
   */
  const showFailure = (value: Failure | undefined): void => {
    if (value === undefined) {
      failure.hidden = true;
      failure.replaceChildren();
      return;
    }
    const title = make('p');
    title.textContent = value.title;
    const children: HTMLElement[] = [title];
    if (value.detail !== undefined && value.detail !== '') {
      const detail = make('p', 'gs-detail');
      detail.textContent = value.detail;
      children.push(detail);
    }
    failure.hidden = false;
    failure.replaceChildren(...children);
  };

  const noticeList = (title: string, sentences: readonly string[]): HTMLElement[] => {
    if (sentences.length === 0) {
      return [];
    }
    const caption = make('h2');
    caption.textContent = title;
    const list = make('ul');
    list.append(
      ...sentences.map((sentence) => {
        const item = make('li');
        item.textContent = sentence;
        return item;
      }),
    );
    return [caption, list];
  };

  // --- Doing things ---------------------------------------------------------

  /** The parameters of the map currently on the canvas, for naming its file. */
  let drawn: Params | undefined;
  /** Guards against a second run while the first is still in the air. */
  let busy = false;

  const setBusy = (value: boolean): void => {
    busy = value;
    generateButton.disabled = value;
    generateButton.textContent = value ? UI_TEXT.generating : UI_TEXT.generate;
  };

  /**
   * The seed this run uses, or `undefined` when the field cannot be read.
   *
   * A drawn seed is written back into the field before anything else happens.
   * The number is the only way back to this map, and a run that fails later
   * still leaves it where the person can see it and try again.
   */
  const takeSeed = (): number | undefined => {
    const reading = readSeed(seed.value);
    switch (reading.kind) {
      case 'seed':
        return reading.seed;
      case 'blank': {
        const drawnSeed = randomSeed(services.entropy);
        seed.value = String(drawnSeed);
        return drawnSeed;
      }
      case 'not_an_integer':
        showFailure({ title: UI_TEXT.seedNotAnInteger });
        return undefined;
      case 'out_of_range':
        showFailure({ title: UI_TEXT.seedOutOfRange });
        return undefined;
      default: {
        const unreachable: never = reading;
        throw new TypeError(`unknown seed reading: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  const run = async (): Promise<void> => {
    if (busy) {
      return;
    }
    showFailure(undefined);

    const text = description.value.trim();
    if (text === '') {
      status.textContent = '';
      showFailure({ title: UI_TEXT.emptyDescription });
      return;
    }

    const chosenSeed = takeSeed();
    if (chosenSeed === undefined) {
      status.textContent = '';
      return;
    }

    // Kept the moment it is used, not on every keystroke: a key half-typed is
    // not a key, and a run is the point at which the person has shown they
    // meant this one.
    writeApiKey(services.storage, apiKey.value);

    setBusy(true);
    status.textContent = UI_TEXT.interpreting;
    downloadButton.disabled = true;
    drawn = undefined;
    // Only here, and not with the failure above. The refusals in between leave
    // the previous map on the canvas and the download button live on purpose,
    // and a map still offered for saving has to keep the notices that say what
    // it could not be — otherwise the file goes out with its caveats erased.
    notices.replaceChildren();

    try {
      const result = await generateMap(
        { description: text, seed: chosenSeed },
        {
          interpreter: services.createInterpreter(apiKey.value.trim()),
          library: services.library,
          target,
          onStage: (stage) => {
            status.textContent = stage === 'drawing' ? UI_TEXT.drawing : UI_TEXT.interpreting;
          },
        },
      );

      notices.replaceChildren(
        ...noticeList(UI_TEXT.unresolvedHeading, describeEntries(result.constraints.unresolved)),
        ...noticeList(UI_TEXT.conflictsHeading, describeEntries(result.params.conflicts)),
      );
      drawn = result.params;
      downloadButton.disabled = false;
      status.textContent = `${UI_TEXT.done} ${describeResult(result.params)}`;
    } catch (error) {
      status.textContent = '';
      showFailure(describeFailure(error));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Saves the map that is on the canvas.
   *
   * `drawn` is read into a local before the encode is awaited, and that is the
   * whole of the care this function needs. Nothing is disabled while a PNG
   * encodes — the encode is the browser's and it is quick — so both buttons
   * stay live, and a run started in that window clears `drawn` on its way in.
   * Read after the await, it would be `undefined` by the time the bytes
   * arrived: no file saved, and "algo deu errado ao montar o mapa" shown for a
   * map that was made perfectly well.
   */
  const download = async (): Promise<void> => {
    const saving = drawn;
    if (saving === undefined) {
      return;
    }
    try {
      services.saveBlob(await services.toPng(target), mapFilename(saving));
    } catch (error) {
      showFailure(describeFailure(error));
    }
  };

  // Nothing may escape a handler. A rejection left floating is logged by the
  // browser itself, with the whole error attached — and an SDK error carries
  // the request it came from. `run` catches around the loop, but the reading of
  // the fields happens before that try and can still fail: a browser with no
  // `crypto.getRandomValues` has no way to draw a seed. This is the net under
  // all of it, and it puts the reason on screen instead of in a console nobody
  // has open.
  const guarded = (work: () => Promise<void>) => (): void => {
    work().catch((error: unknown) => {
      setBusy(false);
      showFailure(describeFailure(error));
    });
  };

  generateButton.addEventListener('click', guarded(run));
  downloadButton.addEventListener('click', guarded(download));
}

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
import { JevInterpreter } from '../interpreter/jev/jev';
import { LocalInterpreter } from '../interpreter/local/local';
import type { ModelProgress, ProgressReport } from '../interpreter/local/pipeline';
import { toPng } from '../renderer/png';
import type { RenderTarget } from '../renderer/render';

import { createBlobSaver, mapFilename } from './download';
import type { BlobSaver } from './download';
import {
  describeEntries,
  describeFailure,
  describeModelProgress,
  describeResult,
  looksLikeAnthropicKey,
  UI_TEXT,
} from './messages';
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
  /**
   * Builds the Jev interpreter around the key the person pasted.
   *
   * A second factory rather than a parameter on the first, for the reason the
   * local one is separate too: what a factory takes is what its engine costs,
   * and these three differ. It takes only the key because the endpoint has a
   * default — `/api/jev`, the proxy this project serves — and the proxy is not
   * optional. TypeSafe answers a browser with no `access-control-allow-origin`,
   * measured on both the `POST` and the preflight, so a page that called the
   * API directly would get a response the browser then threw away.
   */
  createJevInterpreter: (apiKey: string) => Interpreter;
  /**
   * Builds the interpreter that runs in this browser, with no key at all.
   *
   * It takes a progress report rather than a key because that is what it costs
   * instead: a model of about 303 MB that has to arrive before the first
   * description can be read. Nothing is downloaded when this is called — the
   * interpreter loads on its first `interpret`, which is why the report is
   * handed over here and not awaited.
   */
  createLocalInterpreter: (onProgress: ProgressReport) => Interpreter;
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
    createJevInterpreter: (apiKey) => new JevInterpreter({ apiKey }),
    createLocalInterpreter: (onProgress) => new LocalInterpreter({ onProgress }),
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

/**
 * Which interpreter a run uses. The value of the picker, and nothing else.
 *
 * Three, not a flag. The page used to ask `usingLocalEngine()` and branch on
 * the answer in four places, which was exactly right while "not local" meant
 * "Claude" — and became wrong the moment a third engine existed, because every
 * one of those branches would have silently read Jev as Claude.
 */
const CLAUDE_ENGINE = 'claude';
const JEV_ENGINE = 'jev';
const LOCAL_ENGINE = 'local';

/** The three, as a type, so the switches below can be checked for exhaustiveness. */
type Engine = typeof CLAUDE_ENGINE | typeof JEV_ENGINE | typeof LOCAL_ENGINE;

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
.gs-field select, .gs-field input, .gs-field textarea {
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

  /**
   * A labelled field, with the label bound to the control by id.
   *
   * Both halves come back, because one field's caption is not fixed: the key
   * field is shared by two engines that call the key different things and make
   * different promises about where it goes, so `refreshEngine` rewrites it.
   */
  const field = (
    id: string,
    label: string,
  ): { wrap: HTMLDivElement; caption: HTMLLabelElement } => {
    const wrap = make('div', 'gs-field');
    const caption = make('label');
    caption.htmlFor = id;
    caption.textContent = label;
    wrap.append(caption);
    return { wrap, caption };
  };

  const descriptionField = field('gs-description', UI_TEXT.descriptionLabel).wrap;
  const description = make('textarea');
  description.id = 'gs-description';
  description.rows = 4;
  description.placeholder = UI_TEXT.descriptionPlaceholder;
  descriptionField.append(description);

  // The interpreter picker.
  //
  // A real `<label for="gs-engine">`, like the other three fields. It was a
  // `<p>` plus an `aria-label` for one reason, written down at the time: the
  // test below asserts the *exact* set of `htmlFor` values on the page, and the
  // front that added the picker was not allowed to edit that file. A caption
  // that is not a label is still clickable-nowhere and still invisible to
  // "list the form controls", and an `aria-label` that has to agree with a
  // separate `<p>` by hand is two strings that can drift. The test now expects
  // four values, which is what it should have expected then.
  const engineField = field('gs-engine', UI_TEXT.engineLabel).wrap;
  const engine = make('select');
  engine.id = 'gs-engine';
  const claudeOption = make('option');
  claudeOption.value = CLAUDE_ENGINE;
  claudeOption.textContent = UI_TEXT.engineClaude;
  const jevOption = make('option');
  jevOption.value = JEV_ENGINE;
  jevOption.textContent = UI_TEXT.engineJev;
  const localOption = make('option');
  localOption.value = LOCAL_ENGINE;
  localOption.textContent = UI_TEXT.engineLocal;
  engine.append(claudeOption, jevOption, localOption);
  // Set rather than left to the browser's own "first option wins", so that the
  // page knows which engine it is on without reading the DOM's mind — and so
  // that the default is a decision written down here: the one that answers in
  // seconds, for somebody generating a map mid-session.
  engine.value = CLAUDE_ENGINE;
  const engineNote = make('p', 'gs-note');
  engineNote.textContent = UI_TEXT.engineLocalNote;
  engineField.append(engine, engineNote);

  const { wrap: apiKeyField, caption: apiKeyCaption } = field('gs-api-key', UI_TEXT.apiKeyLabel);
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

  const seedField = field('gs-seed', UI_TEXT.seedLabel).wrap;
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
    engineField,
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

  /**
   * Which of the three the picker is on.
   *
   * Anything else is read as Claude, which is what `engine.value` is set to at
   * mount and the only value the page puts there that is not one of the three.
   */
  const chosenEngine = (): Engine => {
    switch (engine.value) {
      case JEV_ENGINE:
        return JEV_ENGINE;
      case LOCAL_ENGINE:
        return LOCAL_ENGINE;
      default:
        return CLAUDE_ENGINE;
    }
  };

  /**
   * Which engine the key now in the box was put there for.
   *
   * Claude at mount, because the slot the box is prefilled from can only hold
   * an Anthropic key — see the refusal to store a Jev key in `run` below, which
   * is what makes that true rather than assumed.
   */
  let keyEngine: Engine = chosenEngine();

  /**
   * Shows the parts of the form the chosen interpreter actually uses.
   *
   * The key field goes away for the local engine rather than being disabled,
   * because it is not merely unavailable there — it is meaningless, and a
   * greyed-out box invites somebody to wonder what would happen if they filled
   * it. The note appears in its place, because the cost of the local engine is
   * a download of about 310 MB — the model, the ONNX runtime and the library
   * that loads them, see `UI_TEXT.engineLocalNote` — and that is something to
   * be told before the first click, not discovered by waiting.
   *
   * For the other two the field stays, and its wording does not. Both read the
   * key out of the same box, but they are different credentials from different
   * companies and they travel differently: the Anthropic one goes straight to
   * the API from this page, the TypeSafe one goes through this project's proxy
   * because TypeSafe will not answer a browser. A field captioned "Chave da API
   * da Anthropic" above a Jev run sends somebody to the wrong dashboard, and
   * the note under it would promise a route the request does not take.
   */
  const refreshEngine = (): void => {
    const chosen = chosenEngine();
    // The box is emptied, not just recaptioned, and that is the part that
    // matters. Nothing anywhere checks the shape of what is in it — the proxy
    // relays whatever it is handed and `JevInterpreter` only checks it is not
    // empty — so a key left behind by the previous engine is sent to the new
    // one's API on the next click. With the field prefilled from storage at
    // mount, that is not a slip somebody has to make: it is what a return visit
    // looks like by default, in both directions. The person is then told the
    // key was rejected, which sends them to fetch another one and says nothing
    // about the credential that was just handed to a third party and now has to
    // be rotated.
    //
    // Passing through the local engine is not a change of key: it does not read
    // the field, so what is in there still belongs to whichever of the two put
    // it there.
    if (chosen !== LOCAL_ENGINE) {
      if (chosen !== keyEngine) {
        apiKey.value = '';
      }
      keyEngine = chosen;
    }
    apiKeyField.hidden = chosen === LOCAL_ENGINE;
    engineNote.hidden = chosen !== LOCAL_ENGINE;
    const jev = chosen === JEV_ENGINE;
    apiKeyCaption.textContent = jev ? UI_TEXT.apiKeyLabelJev : UI_TEXT.apiKeyLabel;
    apiKey.placeholder = jev ? UI_TEXT.apiKeyPlaceholderJev : UI_TEXT.apiKeyPlaceholder;
    apiKeyNote.textContent = jev ? UI_TEXT.apiKeyNoteJev : UI_TEXT.apiKeyNote;
  };

  engine.addEventListener('change', refreshEngine);
  refreshEngine();

  /**
   * Puts the model's own progress on the status line, in place of the stage.
   *
   * Only when it changes something. The status line is `role="status"` with
   * `aria-live="polite"`, and assigning `textContent` replaces the text node
   * whether or not the string differs — which a screen reader reads as a
   * mutation of a live region and queues an announcement for. Nothing on the
   * path from the library's `progress_callback` to here throttles: `src/` was
   * swept for `throttle`, `debounce`, `requestAnimationFrame` and `setTimeout`
   * and the one hit is unrelated.
   *
   * Measured over one real download: 4,627 progress events, 4,632 writes, and
   * **211** of those writes changed the string. The comparison below drops the
   * other 4,421 and changes nothing about what appears on screen. With the
   * smaller chunks Chrome tends to deliver the event count passes 18,000, and
   * what saturates is the announcement queue — minutes of the same sentence,
   * with anything else the page has to say waiting behind it.
   */
  const showModelProgress = (progress: ModelProgress): void => {
    const sentence = describeModelProgress(progress);
    if (sentence === status.textContent) {
      return;
    }
    status.textContent = sentence;
  };

  /** The local interpreter, once somebody has asked for one. */
  let localInterpreter: Interpreter | undefined;

  /**
   * The interpreter this run uses.
   *
   * The two that take a key are rebuilt every run because the key may have been
   * edited between them, and it costs nothing — each holds a string and either
   * a client or an endpoint. The local one is built once and kept, because it
   * holds the model: it loads on
   * its first description and remembers it, and a fresh one per run would throw
   * that away and rebuild the session on every click. The browser would still
   * have the files cached, so nothing would be re-downloaded and nothing would
   * look broken — it would just be tens of seconds slower per map, for a tool
   * whose whole promise is a place in seconds. Kept lazily, so choosing the
   * local engine and then changing your mind costs nothing either.
   */
  const interpreterForRun = (): Interpreter => {
    const chosen = chosenEngine();
    switch (chosen) {
      case CLAUDE_ENGINE:
        return services.createInterpreter(apiKey.value.trim());
      case JEV_ENGINE:
        return services.createJevInterpreter(apiKey.value.trim());
      case LOCAL_ENGINE:
        localInterpreter ??= services.createLocalInterpreter(showModelProgress);
        return localInterpreter;
      default: {
        const unreachable: never = chosen;
        throw new TypeError(`unknown engine: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  // --- Doing things ---------------------------------------------------------

  /** The parameters of the map currently on the canvas, for naming its file. */
  let drawn: Params | undefined;
  /**
   * Whether a generation or an encoding is in the air.
   *
   * One flag for both, and both buttons wait on it. The canvas is a single
   * mutable thing that a run overwrites and an encode reads, and every way of
   * overlapping those two ends the same way: the encode reads a canvas that is
   * no longer the map it was asked for, throws over the size it did not expect,
   * and the person is told the map failed while a perfectly good one is on the
   * screen. Keeping only what the encode needs would close one path in at a
   * time; refusing to start the second thing closes the class, and it is what a
   * disabled button already promises anyway.
   */
  let busy = false;
  /** Whether what is in the air is a generation, which is what the label says. */
  let generating = false;

  /** Puts both buttons into the state the two flags and `drawn` describe. */
  const refreshButtons = (): void => {
    generateButton.disabled = busy;
    generateButton.textContent = generating ? UI_TEXT.generating : UI_TEXT.generate;
    downloadButton.disabled = busy || drawn === undefined;
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    generating = value;
    refreshButtons();
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

    // Before the seed is drawn, beside the other refusal that costs nothing.
    // The clearing in `refreshEngine` is what makes a key of the wrong
    // provider's rare; this is what makes sending one impossible, and it is
    // needed because the clearing cannot see a key pasted straight into a Jev
    // session out of the wrong password-manager entry. Only this direction can
    // be checked: `sk-ant-` is Anthropic's documented prefix, and there is no
    // published shape for a TypeSafe key to test the other way round with.
    if (chosenEngine() === JEV_ENGINE && looksLikeAnthropicKey(apiKey.value)) {
      status.textContent = '';
      showFailure({ title: UI_TEXT.anthropicKeyOnJev });
      return;
    }

    const chosenSeed = takeSeed();
    if (chosenSeed === undefined) {
      status.textContent = '';
      return;
    }

    // Kept the moment it is used, not on every keystroke: a key half-typed is
    // not a key, and a run is the point at which the person has shown they
    // meant this one. Not on a local run at all — that one never reads the
    // field, so a run of it is no evidence about what is in there, and writing
    // anyway would let a hidden field overwrite a key that was working.
    //
    // A Jev run reads the field and still does not store, and that is the
    // choice rather than an oversight. `storage.ts` has one slot,
    // `API_KEY_ITEM`, and it is that file's constant; the box is prefilled from
    // it at mount, before any engine has been picked. So a slot that could hold
    // either provider's key is a slot whose contents cannot be attributed, and
    // an unattributable prefill is a key handed to whichever engine the page
    // happens to open on — which is Claude, every time. Storing a TypeSafe key
    // here would be the blocker this front already fixed, rebuilt in the
    // direction no prefix test can catch.
    //
    // Keeping the slot Anthropic-only is what lets `keyEngine` start at Claude
    // and be right. The cost is a paste per visit on the Jev engine, and the
    // note under the field says so. A slot per engine is the real answer and it
    // belongs in `storage.ts`, which is outside this front.
    if (chosenEngine() === CLAUDE_ENGINE) {
      writeApiKey(services.storage, apiKey.value);
    }

    // The stage is not announced here: `generateMap` reports `interpreting`
    // before it does anything else, and saying it twice would mutate a polite
    // live region twice with the same words — one announcement per generation
    // is the point of the region.
    drawn = undefined;
    setBusy(true);
    // Only here, and not with the failure above. The refusals in between leave
    // the previous map on the canvas and the download button live on purpose,
    // and a map still offered for saving has to keep the notices that say what
    // it could not be — otherwise the file goes out with its caveats erased.
    notices.replaceChildren();

    try {
      const result = await generateMap(
        { description: text, seed: chosenSeed },
        {
          interpreter: interpreterForRun(),
          library: services.library,
          target,
          onStage: (stage) => {
            switch (stage) {
              case 'interpreting':
                status.textContent = UI_TEXT.interpreting;
                break;
              case 'drawing':
                status.textContent = UI_TEXT.drawing;
                break;
              default: {
                const unreachable: never = stage;
                throw new TypeError(`unknown stage: ${JSON.stringify(unreachable)}`);
              }
            }
          },
        },
      );

      notices.replaceChildren(
        ...noticeList(UI_TEXT.unresolvedHeading, describeEntries(result.constraints.unresolved)),
        ...noticeList(UI_TEXT.conflictsHeading, describeEntries(result.params.conflicts)),
      );
      drawn = result.params;
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
   * `drawn` is read into a local before the encode is awaited, and the buttons
   * are held for as long as the encode lasts. The parameters alone are not
   * enough: `target` is the live canvas, and the encoder reads its width and
   * height after two awaits, so a run finishing underneath an encode leaves it
   * reading a canvas of another size. The encode throws, the catch below turns
   * that into "algo deu errado" — for a map that came out perfectly and is
   * still on the screen.
   *
   * The failure box is cleared on the way in, the way `run` clears it, and
   * after the guard rather than before it: a click that does nothing should
   * leave the screen alone. Without this, an encode that failed once left its
   * red box up for ever — the next click wrote the file and the screen went on
   * saying the map had gone wrong, to a person who had just been handed it.
   */
  const download = async (): Promise<void> => {
    const saving = drawn;
    if (saving === undefined || busy) {
      return;
    }
    showFailure(undefined);
    busy = true;
    refreshButtons();
    try {
      services.saveBlob(await services.toPng(target), mapFilename(saving));
    } catch (error) {
      showFailure(describeFailure(error));
    } finally {
      busy = false;
      refreshButtons();
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

/**
 * The page's stylesheet: a dungeon wall, a wooden plaque, two framed boards.
 *
 * One string, put into a `<style>` by `mountApp`, so the page is still the one
 * module that touches the document. The tokens at the top are the design
 * system's, and `~/projetos/DESIGN-SYSTEM.md` is where they are explained;
 * the values here are the source of truth and that document follows them.
 *
 * Every picture this refers to — the stone, the floor, the icons — arrives as
 * a `--gs-art-*` custom property that `scene.ts` sets once the pixels are
 * drawn. Each use has a fallback, so a page with no scenery (the tests, or a
 * browser where the drawing failed) is plain but whole.
 *
 * The page is fitted to the window: nothing scrolls but the form's own body
 * and the map's viewport. Below 900 px wide or 560 px tall that stops being
 * possible, and the page goes back to scrolling like any other.
 */

/** The four families, self-hosted from `public/fonts` under the OFL. */
const FONT_FACES = (
  [
    ['Alegreya Sans', 400, 'alegreya-sans-400'],
    ['Alegreya Sans', 500, 'alegreya-sans-500'],
    ['Alegreya Sans', 700, 'alegreya-sans-700'],
    ['Jersey 10', 400, 'jersey-10-400'],
    ['Pixelify Sans', 700, 'pixelify-sans-700'],
    ['VT323', 400, 'vt323-400'],
  ] as const
)
  .flatMap(([family, weight, file]) => [
    `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap;
  src: url(/fonts/${file}-latin-ext.woff2) format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }`,
    `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap;
  src: url(/fonts/${file}-latin.woff2) format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }`,
  ])
  .join('\n');

const TOKENS = `
:root {
  color-scheme: dark;
  --wall: #1b1d22; --board: #1f2126; --well: #14161a;
  --wood: #4a2f1e; --wood-hi: #7a4d2b; --wood-lo: #2c1b10;
  --gold: #d9a441; --gold-hi: #f2cf72; --gold-lo: #8a6424;
  --parch: #e8d6a8; --parch-lo: #bfa877;
  --ink: #ece3cf; --ink-dim: #b3a990; --ink-dark: #2a1a0e;
  --moss: #3f7a3a; --moss-hi: #6cb35f; --moss-lo: #1f3d22;
  --ember: #f08a2c; --ok: #5fbf5a; --warn: #e0a83a; --danger: #d4604a;
  --line: #4d525c;

  --f-display: "Jersey 10", "VT323", ui-monospace, monospace;
  --f-brand: "Pixelify Sans", "Jersey 10", ui-monospace, monospace;
  --f-body: "Alegreya Sans", "Segoe UI", system-ui, sans-serif;
  --f-num: "VT323", ui-monospace, "Cascadia Mono", monospace;

  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;

  --floor-h: clamp(26px, 5.4vh, 64px);
  --floor-gap: clamp(6px, 1.3vh, 14px);
  --hall-top: clamp(12px, 2.6vh, 30px);
}`;

const BASE = `
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; background: var(--wall); overflow-x: clip; }
body {
  margin: 0; color: var(--ink); font: 400 16px/1.45 var(--f-body);
  display: flex; flex-direction: column; height: 100dvh; overflow: hidden;
  padding: 0 16px calc(var(--floor-h) + var(--floor-gap));
  background-color: var(--wall); background-image: var(--gs-art-stone, none);
  background-size: 192px 96px; background-repeat: repeat; image-rendering: pixelated;
}
/* the room darkens toward its corners */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(ellipse 75% 70% at 50% 35%, transparent 55%, rgba(0,0,0,.55) 100%);
}
#app { flex: 1; min-height: 0; display: flex; flex-direction: column; }
:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.gs-px { image-rendering: pixelated; display: block; }

/* an icon is a 24 px picture before the words, drawn by scene.ts */
.gs-icon::before {
  content: ""; flex: none; width: 24px; height: 24px;
  background: center / contain no-repeat; image-rendering: pixelated;
}
.gs-icon-scroll::before { background-image: var(--gs-art-scroll, none); }
.gs-icon-hat::before { background-image: var(--gs-art-hat, none); }
.gs-icon-key::before { background-image: var(--gs-art-key, none); }
.gs-icon-sprout::before { background-image: var(--gs-art-sprout, none); }
.gs-icon-hammer::before { background-image: var(--gs-art-hammer, none); width: 28px; height: 28px; }
.gs-icon-book::before { background-image: var(--gs-art-book, none); width: 32px; height: 32px; }
.gs-icon-grid::before { background-image: var(--gs-art-grid, none); }
.gs-icon-download::before { background-image: var(--gs-art-download, none); }
`;

const LAYOUT = `
.gs-app { flex: 1; min-height: 0; width: 100%; max-width: 1280px; margin: 0 auto;
  display: flex; flex-direction: column; position: relative; z-index: 1; }

/* the hall: a plaque between torches and banners */
.gs-hall { flex: none; position: relative; width: 100%;
  display: grid; grid-template-columns: 1fr auto auto auto 1fr; align-items: start;
  gap: clamp(12px, 2vw, 24px); padding-block: var(--hall-top) clamp(8px, 1.6vh, 16px); }
.gs-hall > * { position: relative; z-index: 1; }
.gs-plaque { grid-column: 3; position: relative; text-align: center;
  padding: clamp(6px, 1.2vh, 12px) clamp(16px, 2.4vw, 32px) clamp(8px, 1.6vh, 16px);
  background: linear-gradient(#5a3820, #432916); border: 4px solid var(--wood-lo);
  box-shadow: inset 0 0 0 3px var(--gold-lo), inset 0 0 0 5px var(--wood-lo), 5px 7px 0 #0008; }
.gs-brand { display: flex; align-items: center; justify-content: center; gap: var(--s3); }
.gs-brand::before { content: ""; height: clamp(26px, 4.2vh, 42px); aspect-ratio: 26 / 14;
  background: var(--gs-art-anvil, none) center / contain no-repeat; image-rendering: pixelated;
  filter: drop-shadow(2px 3px 0 rgba(0,0,0,.38)); }
.gs-brand h1 { margin: 0; font: 700 clamp(26px, 5vh, 54px)/1 var(--f-brand); color: var(--gold-hi);
  letter-spacing: .02em; text-shadow: 3px 3px 0 #2a1608, -1px -1px 0 #f7dc8f55; }
.gs-tagline { margin: clamp(2px, .8vh, 8px) 0 0; font: 400 clamp(15px, 2.1vh, 21px)/1.15 var(--f-display);
  color: var(--parch); text-shadow: 2px 2px 0 #1a0e05; text-wrap: balance; }

/* the boards */
.gs-layout { flex: 1; min-height: 0; width: 100%; display: grid; gap: var(--s5); align-items: stretch;
  grid-template-columns: minmax(320px, clamp(360px, 31vw, 440px)) minmax(0, 1fr); }
.gs-board { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  background: var(--board); border: 4px solid var(--wood);
  padding: clamp(14px, 2.2vh, 24px) clamp(16px, 1.8vw, 24px);
  box-shadow: inset 0 0 0 2px var(--wood-hi), inset 0 0 0 4px var(--wood-lo), 0 0 0 2px #000a, 6px 8px 0 #0007; }
.gs-board-body { flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px;
  scrollbar-width: thin; scrollbar-color: var(--wood-hi) transparent; }
.gs-tag { display: inline-flex; align-items: center; gap: var(--s2);
  margin: calc(-1 * var(--s2)) 0 clamp(8px, 1.6vh, 16px); padding: var(--s2) var(--s4);
  color: var(--ink-dark); font: 400 clamp(25px, 3.4vh, 30px)/1 var(--f-display); letter-spacing: .02em;
  background-color: var(--parch);
  background-image: radial-gradient(ellipse at 50% 45%, transparent 52%, rgba(122,82,34,.32) 100%), var(--gs-art-parchment, none);
  background-size: 100% 100%, 96px 48px; image-rendering: pixelated;
  clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px), 0 6px);
  box-shadow: inset 0 -4px 0 #b39461, inset 0 0 0 2px #c4a96f, inset 3px 3px 0 #f6ead0;
  text-shadow: 1px 1px 0 #f6ead0; }
`;

const FORM = `
.gs-field { display: grid; gap: clamp(4px, .8vh, 8px); margin-bottom: clamp(8px, 1.5vh, 16px); }
.gs-field > label { display: flex; align-items: center; gap: var(--s2);
  font: 400 22px/1 var(--f-display); color: var(--gold-hi); letter-spacing: .03em; }
.gs-field textarea, .gs-field select, .gs-field input {
  width: 100%; color: var(--ink); background: var(--well); border: 2px solid var(--line); border-radius: 0;
  box-shadow: inset 0 3px 0 #0009; font: 400 17px/1.35 var(--f-body); padding: 10px 12px; }
.gs-field textarea { resize: vertical; min-height: 0; height: clamp(66px, 9.5vh, 88px); }
.gs-field select { appearance: none; padding-right: 36px; text-overflow: ellipsis;
  background-image: linear-gradient(45deg, transparent 50%, var(--gold) 50%), linear-gradient(-45deg, transparent 50%, var(--gold) 50%);
  background-position: calc(100% - 18px) 50%, calc(100% - 12px) 50%; background-size: 6px 6px; background-repeat: no-repeat; }
.gs-field option { background: var(--well); color: var(--ink); }
#gs-seed { font: 400 26px/1 var(--f-num); letter-spacing: .04em; padding: 6px 12px; height: 48px;
  font-variant-numeric: tabular-nums; }
#gs-seed::placeholder { font: 400 17px/1 var(--f-body); letter-spacing: 0; }
.gs-note { margin: 0; font-size: clamp(12.5px, 1.6vh, 14px); line-height: 1.32; color: var(--ink-dim); max-width: 60ch; }

/* the seed and the button that uses it, on one row; the note runs under both */
.gs-go-row { display: grid; grid-template-columns: minmax(120px, 1fr) auto; column-gap: 10px;
  row-gap: clamp(4px, .8vh, 8px); align-items: end; margin-top: var(--s1); }
.gs-go-row > .gs-field { display: contents; }
.gs-go-row > .gs-field > label { grid-column: 1; grid-row: 1; }
.gs-go-row > .gs-field > input { grid-column: 1; grid-row: 2; }
.gs-go-row > .gs-field > .gs-note { grid-column: 1 / -1; grid-row: 3; margin-top: var(--s1); }
.gs-forge { grid-column: 2; grid-row: 2; height: 48px; padding: 0 14px; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  font: 400 clamp(25px, 3.2vh, 29px)/1 var(--f-display); color: #f4f1e2; letter-spacing: .03em;
  text-shadow: 2px 2px 0 var(--moss-lo); background: var(--moss); border: 3px solid var(--gold-lo);
  box-shadow: inset 0 4px 0 var(--moss-hi), inset 0 -5px 0 var(--moss-lo), 0 0 0 2px #000, 0 5px 0 #0008; }
.gs-forge:hover { filter: brightness(1.08); }
.gs-forge:active { transform: translateY(2px);
  box-shadow: inset 0 4px 0 var(--moss-hi), inset 0 -3px 0 var(--moss-lo), 0 0 0 2px #000, 0 3px 0 #0008; }
.gs-forge:disabled { cursor: default; filter: saturate(.4) brightness(.8); transform: none; }

.gs-failure { margin-top: var(--s4); padding: var(--s3) var(--s4); color: #f3d6cf; font-size: 15px;
  background: #2a1512; border: 2px solid var(--danger); border-left-width: 6px; }
.gs-failure p { margin: 0; }
.gs-failure p:first-child { font: 400 21px/1.1 var(--f-display); color: #ffb9a8; }
.gs-failure .gs-detail { margin-top: var(--s1); font: 400 13px/1.4 ui-monospace, monospace;
  color: #e3b3a8; overflow-wrap: anywhere; }
`;

const MAP = `
.gs-map-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: var(--s3); margin-bottom: clamp(8px, 1.4vh, 16px); }
.gs-map-title { margin: 0; display: flex; align-items: center; gap: var(--s2);
  font: 400 31px/1 var(--f-display); color: var(--parch); }
.gs-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
.gs-tool { display: inline-flex; align-items: center; gap: var(--s2); height: 38px; padding: 0 12px; cursor: pointer;
  font: 400 21px/1 var(--f-display); color: var(--ink); background: var(--well); border: 2px solid var(--line); }
.gs-tool:hover:not(:disabled) { border-color: var(--ink-dim); }
.gs-tool:disabled { cursor: default; opacity: .45; }
.gs-tool[aria-pressed="true"] { border-color: var(--ok); box-shadow: inset 0 -3px 0 #2f6b2c; }
.gs-tool[aria-pressed="false"]::before { opacity: .4; }
.gs-tool-square { width: 38px; padding: 0; justify-content: center; font-size: 24px; }
.gs-tool-gold { color: var(--gold-hi); border-color: var(--gold); background: #2a1d0f; }
.gs-zoom { font: 400 24px/1 var(--f-num); min-width: 4ch; text-align: center; font-variant-numeric: tabular-nums; }

.gs-viewport { position: relative; flex: 1; min-height: 0; overflow: auto; container-type: size;
  display: grid; align-items: safe center; justify-items: safe center;
  padding: clamp(8px, 1.6vh, 24px); background: var(--well);
  border: 2px solid #0008; box-shadow: inset 0 0 0 2px #2a2d33; }
.gs-map { --ar: 1.25; position: relative; aspect-ratio: var(--ar);
  width: calc(min(100cqw, 100cqh * var(--ar)) * var(--z, 1)); transition: opacity .2s; }
/* the map is a drawing, not pixel art: scaled down, it has to be smoothed */
.gs-map canvas { display: block; width: 100%; height: 100%; image-rendering: auto;
  box-shadow: 0 0 0 2px #000, 4px 5px 0 #0008; }
.gs-empty { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; padding: var(--s4);
  text-align: center; font: 400 clamp(20px, 2.8vh, 26px)/1.2 var(--f-display); color: var(--ink-dim);
  border: 2px dashed #ffffff1a; }
.gs-map-board[aria-busy="true"] .gs-map { opacity: .35; }

.gs-notices { flex: none; margin-top: clamp(8px, 1.4vh, 16px); padding: var(--s3) var(--s4);
  max-height: 30%; overflow-y: auto;
  background: #251d10; border: 2px solid #6b5422; border-left: 6px solid var(--warn); }
.gs-notices:empty { display: none; }
.gs-notices h2 { margin: 0 0 var(--s2); font: 400 22px/1.1 var(--f-display); color: var(--gold-hi); }
.gs-notices ul { margin: 0 0 var(--s2); padding-left: 1.2em; display: grid; gap: var(--s1); }
.gs-notices ul:last-child { margin-bottom: 0; }
.gs-notices li { font-size: 15.5px; }

.gs-map-foot { flex: none; margin-top: clamp(8px, 1.4vh, 16px); padding-top: clamp(6px, 1.1vh, 12px);
  border-top: 2px solid #ffffff10; }
.gs-status { margin: 0; min-height: 1.45em; display: flex; align-items: center; gap: var(--s2);
  font-size: 15px; color: var(--ink-dim); }
.gs-status::before { content: ""; flex: none; width: 10px; height: 10px; background: var(--ok); box-shadow: 0 0 0 2px #0008; }
.gs-status:empty::before { background: var(--line); }
.gs-map-board[aria-busy="true"] .gs-status::before { background: var(--ember); animation: gs-blink 1s steps(2) infinite; }
@keyframes gs-blink { 50% { opacity: .3; } }
`;

const SCENE = `
.gs-deco { position: absolute; pointer-events: none; z-index: 3; }
.gs-rivet { position: absolute; width: 8px; height: 8px; background: var(--gold); pointer-events: none;
  box-shadow: inset -2px -2px 0 var(--gold-lo), inset 2px 2px 0 var(--gold-hi), 0 0 0 2px #000; }
.gs-rivet.tl { top: -6px; left: -6px; } .gs-rivet.tr { top: -6px; right: -6px; }
.gs-rivet.bl { bottom: -6px; left: -6px; } .gs-rivet.br { bottom: -6px; right: -6px; }
.gs-wall-shadow { filter: drop-shadow(3px 5px 0 rgba(0,0,0,.5)); }
.gs-soft-shadow { filter: drop-shadow(2px 3px 0 rgba(0,0,0,.38)); }

.gs-beam { flex: none; position: relative; z-index: 2; height: clamp(22px, 3.6vh, 36px); margin-inline: -48px;
  background: var(--gs-art-beam, var(--wood)) repeat-x; background-size: auto 100%; box-shadow: 0 6px 0 #0007; }
.gs-beam .gs-bracket { position: absolute; top: 0; }

.gs-hall .gs-banner { height: clamp(60px, 13vh, 144px); width: auto; margin-top: calc(-1 * var(--hall-top)); }
.gs-hall .gs-banner.l { grid-column: 1; justify-self: end; }
.gs-hall .gs-banner.r { grid-column: 5; justify-self: start; }
.gs-torch-wrap { position: relative; }
.gs-torch-wrap.l { grid-column: 2; } .gs-torch-wrap.r { grid-column: 4; }
.gs-torch { height: clamp(44px, 8.5vh, 88px); width: auto; margin-top: clamp(6px, 1.4vh, 16px); }
.gs-torch-wrap::before, .gs-glow::before {
  content: ""; position: absolute; left: 50%; top: 18%; z-index: -1; pointer-events: none;
  width: var(--g, 240px); height: var(--g, 240px); transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(240,138,44,.26) 0, rgba(240,138,44,.10) 38%, transparent 70%);
  animation: gs-flicker 2.4s steps(6) infinite; }
.gs-torch-wrap::after { content: ""; position: absolute; z-index: -1; left: 50%; top: -38%; width: 70%; height: 70%;
  transform: translateX(-50%); pointer-events: none;
  background: radial-gradient(ellipse at 50% 80%, rgba(0,0,0,.5), transparent 70%); }
.gs-glow { position: relative; }
.gs-glow::before { --g: 150px; top: 30%; }
@keyframes gs-flicker { 0%, 100% { opacity: 1; } 30% { opacity: .82; } 55% { opacity: .95; } 80% { opacity: .78; } }
.gs-ember { position: absolute; left: var(--x); top: 20%; width: 4px; height: 4px; background: var(--gold-hi);
  box-shadow: 0 0 0 1px #f08a2c88; opacity: 0; animation: gs-rise 2.8s linear infinite; animation-delay: var(--d); }
@keyframes gs-rise { 0% { transform: translate(0, 0); opacity: 0; } 12% { opacity: 1; }
  100% { transform: translate(var(--dx), -84px); opacity: 0; } }
.gs-plaque .gs-chain { position: absolute; top: -42px; }

.gs-hall .gs-prop { position: absolute; z-index: 0; pointer-events: none; width: auto; }
.gs-hall .gs-vine { position: absolute; top: 0; z-index: 0; width: auto; height: calc(var(--len, 30) * clamp(1.5px, .3vh, 3px)); }
.gs-hall .gs-window { left: 6%; top: calc(var(--hall-top) + 2px); height: clamp(64px, 12vh, 112px); }
.gs-moonbeam { position: absolute; z-index: 4; pointer-events: none; left: 5%;
  top: calc(var(--hall-top) + clamp(30px, 5vh, 50px));
  width: clamp(140px, 16vw, 240px); height: clamp(260px, 52vh, 520px);
  background: linear-gradient(to bottom, rgba(196,214,255,.13), rgba(196,214,255,.04) 60%, transparent);
  clip-path: polygon(14% 0, 46% 0, 100% 100%, 46% 100%); }
.gs-hall .gs-bat { left: 13%; top: 0; height: clamp(16px, 2.6vh, 26px); transform-origin: 50% 0;
  animation: gs-sway 4.5s ease-in-out infinite; }
@keyframes gs-sway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.gs-hall .gs-ring.l { left: 17%; top: calc(var(--hall-top) + clamp(24px, 4vh, 40px)); height: clamp(36px, 6vh, 60px); }
.gs-hall .gs-ring.r { right: 17%; top: calc(var(--hall-top) + clamp(30px, 5vh, 48px)); height: clamp(36px, 6vh, 60px); }
.gs-hall .gs-lantern { right: 8%; top: 0; display: flex; flex-direction: column; align-items: center; }
.gs-hall .gs-lantern canvas { width: auto; }
.gs-hall .gs-lantern .gs-chain { height: clamp(18px, 3vh, 30px); }
.gs-hall .gs-lantern .gs-lamp { height: clamp(42px, 7.4vh, 72px); }
.gs-hall .gs-lantern::before { top: 70%; --g: 190px; }
.gs-hall .gs-crack { height: clamp(28px, 4.4vh, 44px); opacity: .9; }
.gs-hall .gs-moss { height: clamp(10px, 1.8vh, 18px); opacity: .9; }

.gs-side { position: absolute; top: clamp(48px, 9vh, 96px); bottom: calc(-1 * (var(--floor-gap) + var(--floor-h) * .58));
  width: 150px; display: none; flex-direction: column; align-items: center; gap: clamp(24px, 5vh, 56px); pointer-events: none; }
.gs-side.l { right: calc(100% + 28px); }
.gs-side.r { left: calc(100% + 28px); }
.gs-side .gs-grow { flex: 1; }
.gs-shelf { position: relative; display: flex; align-items: flex-end; justify-content: center; gap: 6px; padding-inline: 10px;
  border-bottom: 9px solid var(--wood); box-shadow: 0 3px 0 var(--wood-lo), 0 10px 0 #0006; }
.gs-shelf::before, .gs-shelf::after { content: ""; position: absolute; bottom: -22px; width: 12px; height: 14px;
  background: var(--wood); box-shadow: inset -2px -2px 0 var(--wood-lo); }
.gs-shelf::before { left: 10px; clip-path: polygon(0 0, 100% 0, 0 100%); }
.gs-shelf::after { right: 10px; clip-path: polygon(0 0, 100% 0, 100% 100%); }
.gs-floor-row { display: flex; align-items: flex-end; justify-content: center; gap: 6px; }
.gs-side.l .gs-floor-row { transform: translateX(-40px); }
.gs-side.r .gs-floor-row { transform: translateX(40px); }
.gs-standing { position: relative; display: inline-block; }
.gs-standing::after { content: ""; position: absolute; z-index: -1; left: 4%; right: -16%; bottom: -6px; height: 13px;
  background: rgba(0,0,0,.6); clip-path: polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%); }
/* a piece that stands, but beside a board rather than in a row: still out of the flow */
.gs-deco.gs-standing { position: absolute; }
.gs-deco.gs-stand { bottom: calc(-1 * (var(--floor-gap) + var(--floor-h) * .52)); }
.gs-deco.gs-litter { z-index: 2; bottom: calc(-1 * (var(--floor-gap) + var(--floor-h) * .8));
  height: calc(var(--floor-h) * .4); width: auto; }

.gs-floor { position: fixed; left: 0; right: 0; bottom: 0; height: var(--floor-h); z-index: 0; pointer-events: none;
  background: var(--gs-art-floor, #101114) repeat-x; background-size: auto 100%; }
.gs-critters { position: fixed; left: 0; right: 0; bottom: 0; height: var(--floor-h); z-index: 2; pointer-events: none; }
.gs-critters .gs-rat { position: absolute; left: 0; bottom: 10%; height: calc(var(--floor-h) * .5); width: auto;
  transform: translateX(-90px); animation: gs-scurry 24s linear infinite; animation-delay: 3s;
  filter: drop-shadow(2px 2px 0 rgba(0,0,0,.45)); }
@keyframes gs-scurry { 0% { transform: translateX(-90px); } 30%, 100% { transform: translateX(calc(100vw + 90px)); } }
`;

const RESPONSIVE = `
@media (min-width: 1600px) { .gs-side { display: flex; } }
@media (max-width: 1100px) { .gs-hall .gs-ring { display: none; } }
@media (max-width: 1080px) { .gs-hall .gs-banner { display: none; } }
@media (max-width: 980px) { .gs-deco.gs-edge { display: none; } }
@media (max-width: 760px) { .gs-hall .gs-prop, .gs-moonbeam { display: none; } }
@media (max-height: 720px) {
  :root { --hall-top: 9px; }
  .gs-field textarea { height: 58px; }
  .gs-field, .gs-tag { margin-bottom: 6px; }
  .gs-board { padding-top: 12px; padding-bottom: 12px; }
  .gs-tag { font-size: 23px; }
  .gs-note { line-height: 1.25; }
}

/* too narrow or too short to fit on one screen: the page scrolls as any other */
@media (max-width: 900px), (max-height: 560px) {
  html, body { height: auto; }
  body { display: block; height: auto; overflow: visible; padding-bottom: 24px; }
  #app, .gs-app, .gs-layout, .gs-board-body, .gs-viewport { flex: none; }
  .gs-board-body { overflow: visible; }
  .gs-viewport { container-type: inline-size; min-height: 0; }
  .gs-map { width: calc(min(100cqw, 720px) * var(--z, 1)); }
  .gs-floor, .gs-critters { display: none; }
  .gs-side { bottom: 0; }
}
@media (max-width: 900px) { .gs-layout { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .gs-hall { grid-template-columns: 1fr; justify-items: center; }
  .gs-plaque { grid-column: 1; padding-inline: var(--s4); }
  .gs-torch-wrap, .gs-hall .gs-vine, .gs-plaque .gs-chain { display: none; }
  .gs-beam { margin-inline: -16px; }
  .gs-board { padding: var(--s4); }
  .gs-viewport { padding: var(--s3); }
}
@media (prefers-reduced-motion: reduce) {
  .gs-ember { display: none; }
  .gs-torch-wrap::before, .gs-glow::before, .gs-hall .gs-bat,
  .gs-map-board[aria-busy="true"] .gs-status::before { animation: none; }
  .gs-critters .gs-rat { animation: none; transform: none; left: 62%; }
}
`;

export const STYLE = [FONT_FACES, TOKENS, BASE, LAYOUT, FORM, MAP, SCENE, RESPONSIVE].join('\n');

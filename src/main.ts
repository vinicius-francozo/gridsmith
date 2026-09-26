// `./ui/mount` belongs to the UI front and does not exist yet, so the import
// cannot resolve. The directive suppresses exactly that, and no more: once the
// module lands, TypeScript reports the directive itself as unused (TS2578) and
// this file has to be revisited. Excluding it from the program instead would
// hide the call below forever, and a `mount` of the wrong arity would compile,
// build and ship a blank page.
// @ts-expect-error `./ui/mount` is delivered by F4; see the note above.
import { mount } from './ui/mount';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Gridsmith: #app container missing from index.html');
}

mount(root);

// `./ui/mount` belongs to the UI front and does not exist yet, so the import
// cannot resolve. The directive suppresses every error on this import line,
// including a wrong export name: if F4 exports `mountApp` instead of `mount`,
// nothing here complains. What it does buy is that once a `mount` export lands,
// TypeScript reports the directive as unused (TS2578) and the wrong arity as
// TS2554, so this file has to be revisited. Excluding it from the program
// instead would hide the call below forever and ship a blank page in silence.
import { mount } from './ui/mount';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Gridsmith: #app container missing from index.html');
}

mount(root);

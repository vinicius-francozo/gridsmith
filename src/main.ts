// Excluded from `npm run typecheck` (see tsconfig.json) because `./ui/mount`
// belongs to the UI front and does not exist yet; re-include it once it lands.
import { mount } from './ui/mount';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Gridsmith: #app container missing from index.html');
}

mount(root);

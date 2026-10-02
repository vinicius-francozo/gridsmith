// The entry point: find the container, mount the page, count the visit.
import { inject } from '@vercel/analytics';

import { mount } from './ui/mount';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Gridsmith: #app container missing from index.html');
}

mount(root);

// Vercel Web Analytics: page views only. The mode is passed explicitly because
// the package's own detection reads `NODE_ENV`, which a Vite build does not
// expose to the browser. In development the package loads Vercel's debug
// script instead, which logs each event to the console and makes no request.
// Nothing the page holds — the description, the key — is in the URL, so
// nothing of it can reach the analytics either.
inject({ mode: import.meta.env.DEV ? 'development' : 'production' });

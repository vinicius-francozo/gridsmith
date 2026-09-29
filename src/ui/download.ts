/**
 * Getting the finished image onto the disk.
 *
 * The name is the whole of the interesting part. A map is worth keeping only
 * if it can be found again, and finding it again means the seed — so the seed
 * goes in the file name, next to the kind of place, and a folder of exports
 * doubles as the index of which numbers produced what.
 */

import type { Params } from '../core/types';

/** What every exported map is called before the distinguishing part. */
export const FILENAME_PREFIX = 'gridsmith';

/**
 * Anything that is not a plain word, collapsed to a hyphen.
 *
 * `place` comes out of a language model, and the schema closes the
 * vocabulary before it gets here — but a file name is handed to the operating
 * system, and a slash or a `..` in one is worth an extra line to make
 * impossible rather than worth reasoning about.
 */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * What to call the PNG of `params`.
 *
 * Every word in it is English, like the rest of the code. `messages.ts` is the
 * one module that speaks Portuguese, because it is the one whose strings a
 * person reads as a sentence; a file name is read by a shell, sorted by a file
 * manager and typed at a prompt, and half of one in each language is a name
 * that reads as neither.
 *
 * The seed is written as an unsigned decimal. A negative seed would otherwise
 * open the name with a hyphen, which some shells read as the start of a flag.
 */
export function mapFilename(params: Params): string {
  const seed = slug(String(params.seed));
  return `${FILENAME_PREFIX}-${slug(params.place.building)}-${slug(params.place.room)}-seed-${seed}.png`;
}

/** Hands `blob` to the browser to save under `filename`. */
export type BlobSaver = (blob: Blob, filename: string) => void;

/**
 * How long the object URL is kept alive after the click.
 *
 * Revoking it on the next line, which is what this did first, is the shape
 * every "download a blob" snippet on the web has and it is wrong in Firefox:
 * the click only queues the download, and the URL is read after the handler
 * has returned. A URL revoked before that read gives a click that produces no
 * file and no error — nothing throws, so the `catch` upstream never fires and
 * the person is told nothing at all. A quarter of a second is far past the
 * read and far short of holding several megabytes for the life of the tab.
 */
export const REVOKE_DELAY_MS = 250;

/**
 * The browser's own download: an anchor with a `download` attribute, clicked.
 *
 * There is no backend to serve the file from, so the bytes never leave the
 * page — `createObjectURL` makes a URL that points at memory in this document,
 * and revoking it afterwards is what keeps the decoded image from being held
 * for the life of the tab. A map of a large hall is several megabytes, and
 * generating twenty in a session is the ordinary case.
 *
 * The anchor is put in the document before it is clicked, for the same reason
 * the revocation is deferred: Firefox ignores a click on a node that is not in
 * the tree. Both are silent failures — no exception, no file — so neither can
 * be left to be noticed in use.
 */
export function createBlobSaver(doc: Document): BlobSaver {
  return (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    doc.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, REVOKE_DELAY_MS);
    }
  };
}

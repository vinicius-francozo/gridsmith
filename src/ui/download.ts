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
 * `placeType` comes out of a language model, and the schema closes the
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
 * The seed is written as an unsigned decimal. A negative seed would otherwise
 * open the name with a hyphen, which some shells read as the start of a flag.
 */
export function mapFilename(params: Params): string {
  const seed = slug(String(params.seed));
  return `${FILENAME_PREFIX}-${slug(params.placeType)}-semente-${seed}.png`;
}

/** Hands `blob` to the browser to save under `filename`. */
export type BlobSaver = (blob: Blob, filename: string) => void;

/**
 * The browser's own download: an anchor with a `download` attribute, clicked.
 *
 * There is no backend to serve the file from, so the bytes never leave the
 * page — `createObjectURL` makes a URL that points at memory in this document,
 * and revoking it immediately after the click is what keeps the decoded image
 * from being held for the life of the tab. A map of a large hall is several
 * megabytes, and generating twenty in a session is the ordinary case.
 *
 * Untestable under Node, and untested: it has no branches, and everything it
 * touches is the document.
 */
export function createBlobSaver(doc: Document): BlobSaver {
  return (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };
}

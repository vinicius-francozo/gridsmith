/**
 * Where the API key lives between visits.
 *
 * There is no backend, so there is nowhere to put a key but the browser the
 * person is sitting at. `localStorage` is that place: it survives a reload,
 * which is what makes the tool usable at the table, and it never leaves the
 * machine.
 *
 * Two rules hold everywhere the key is touched, here and in `mount.ts`. It is
 * never written into the URL — no query string, no fragment, no history entry —
 * because a URL is copied, pasted into a chat and kept in browser history.
 * And it is never written to a log: nothing in `src/ui/` calls `console`, and
 * `messages.ts` blanks anything key-shaped out of the text it shows, so a key
 * echoed back inside an error message does not reach the screen either.
 *
 * Every access goes through a try/catch. A browser in private mode, or one with
 * site data blocked, throws on the very first `getItem` rather than returning
 * nothing — and a tool that refuses to open because it could not remember a key
 * is worse than one that asks for it again.
 */

/** The slot the key is kept in. Namespaced so it cannot collide on a shared origin. */
export const API_KEY_ITEM = 'gridsmith.api-key';

/** The part of `Storage` this module uses, so a test can stand in for it. */
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The browser's own storage, or `undefined` where there is none to reach.
 *
 * Touched inside the try because merely *naming* `localStorage` throws in a
 * browser configured to block site data — the exception is raised by the
 * property getter, not by the call.
 */
export function browserKeyStore(): KeyStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** A store that remembers nothing, for when the browser will not lend one. */
export function nullKeyStore(): KeyStore {
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

/** The stored key, or an empty string when there is none to be had. */
export function readApiKey(store: KeyStore): string {
  try {
    return store.getItem(API_KEY_ITEM) ?? '';
  } catch {
    return '';
  }
}

/**
 * Stores `key`, or forgets it when there is nothing left to store.
 *
 * A key is trimmed before it is kept. Pasting one out of a dashboard brings a
 * trailing newline often enough that not trimming it means an authentication
 * failure the person has no way to see.
 *
 * Clearing the field clears the slot rather than storing an empty string, so
 * "I removed my key from this machine" is true of the stored data and not only
 * of what the field shows.
 */
export function writeApiKey(store: KeyStore, key: string): void {
  const trimmed = key.trim();
  try {
    if (trimmed === '') {
      store.removeItem(API_KEY_ITEM);
    } else {
      store.setItem(API_KEY_ITEM, trimmed);
    }
  } catch {
    // Storage full, or blocked. The key still works for this session; it just
    // will not be here next time.
  }
}

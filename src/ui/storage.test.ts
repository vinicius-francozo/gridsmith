import { describe, expect, it } from 'vitest';

import { API_KEY_ITEM, nullKeyStore, readApiKey, writeApiKey } from './storage';
import type { KeyStore } from './storage';

/** A `localStorage` that lives in a Map, and records what it was asked to do. */
class FakeStore implements KeyStore {
  readonly items = new Map<string, string>();
  readonly calls: string[] = [];

  getItem(key: string): string | null {
    this.calls.push(`get ${key}`);
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.calls.push(`set ${key}`);
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.calls.push(`remove ${key}`);
    this.items.delete(key);
  }
}

/** What a browser with site data blocked does: it throws on every access. */
const blockedStore: KeyStore = {
  getItem: () => {
    throw new Error('the user agent denied access to the storage area');
  },
  setItem: () => {
    throw new Error('the user agent denied access to the storage area');
  },
  removeItem: () => {
    throw new Error('the user agent denied access to the storage area');
  },
};

describe('keeping the key between visits', () => {
  it('reads back what it stored', () => {
    const store = new FakeStore();

    writeApiKey(store, 'sk-ant-api03-exemplo');

    expect(readApiKey(store)).toBe('sk-ant-api03-exemplo');
  });

  it('keeps it under one namespaced key', () => {
    const store = new FakeStore();

    writeApiKey(store, 'sk-ant-api03-exemplo');

    expect([...store.items.keys()]).toEqual([API_KEY_ITEM]);
  });

  it('answers with an empty string when nothing was ever stored', () => {
    expect(readApiKey(new FakeStore())).toBe('');
  });

  it('trims a key pasted with a trailing newline', () => {
    // Copying one out of a dashboard brings the newline often enough that not
    // trimming means an authentication failure with no visible cause.
    const store = new FakeStore();

    writeApiKey(store, '  sk-ant-api03-exemplo\n');

    expect(readApiKey(store)).toBe('sk-ant-api03-exemplo');
  });

  it('forgets the key when the field is cleared, rather than storing nothing', () => {
    const store = new FakeStore();
    writeApiKey(store, 'sk-ant-api03-exemplo');

    writeApiKey(store, '   ');

    expect(store.items.has(API_KEY_ITEM)).toBe(false);
    expect(store.calls).toContain(`remove ${API_KEY_ITEM}`);
  });
});

describe('a browser that will not lend its storage', () => {
  it('reads as if nothing were stored instead of throwing', () => {
    // Private mode, or site data blocked. A tool that refuses to open because
    // it could not remember a key is worse than one that asks again.
    expect(() => readApiKey(blockedStore)).not.toThrow();
    expect(readApiKey(blockedStore)).toBe('');
  });

  it('swallows a refused write, so the session still works', () => {
    expect(() => writeApiKey(blockedStore, 'sk-ant-api03-exemplo')).not.toThrow();
  });

  it('swallows a refused clear too', () => {
    expect(() => writeApiKey(blockedStore, '')).not.toThrow();
  });

  it('has a store that remembers nothing and complains about nothing', () => {
    const store = nullKeyStore();

    writeApiKey(store, 'sk-ant-api03-exemplo');

    expect(readApiKey(store)).toBe('');
  });
});

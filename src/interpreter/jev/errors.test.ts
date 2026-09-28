import { describe, expect, it } from 'vitest';

import { InterpreterError } from '../errors';

import { JevRejectedKeyError, JevUnavailableError, JevUnusableAnswerError } from './errors';

const EVERY_ERROR = [JevUnavailableError, JevRejectedKeyError, JevUnusableAnswerError];

describe('the three ways this engine fails', () => {
  it('are all InterpreterError, so one catch reaches them', () => {
    // `describeFailure` in `src/ui/messages.ts` ends on an
    // `instanceof InterpreterError` arm. Extending `Error` instead would land
    // these on "algo deu errado ao montar o mapa" with nothing under it.
    for (const Failure of EVERY_ERROR) {
      const failure = new Failure('a detail');

      expect(failure).toBeInstanceOf(InterpreterError);
      expect(failure).toBeInstanceOf(Error);
    }
  });

  it('are three types and not one, so the interface can tell them apart', () => {
    expect(new JevUnavailableError('x')).not.toBeInstanceOf(JevRejectedKeyError);
    expect(new JevRejectedKeyError('x')).not.toBeInstanceOf(JevUnusableAnswerError);
    expect(new JevUnusableAnswerError('x')).not.toBeInstanceOf(JevUnavailableError);
  });

  it('name themselves, because a stack trace is where these are read', () => {
    expect(new JevUnavailableError('x').name).toBe('JevUnavailableError');
    expect(new JevRejectedKeyError('x').name).toBe('JevRejectedKeyError');
    expect(new JevUnusableAnswerError('x').name).toBe('JevUnusableAnswerError');
  });

  it('say what happened and keep the detail they were given', () => {
    for (const Failure of EVERY_ERROR) {
      const failure = new Failure('SENTINELA');

      expect(failure.message).toContain('SENTINELA');
      // A message that is only the detail would reach the log with no subject.
      expect(failure.message).not.toBe('SENTINELA');
    }
  });

  it('keeps the cause, so the original is still in the chain', () => {
    const cause = new TypeError('fetch failed');

    for (const Failure of EVERY_ERROR) {
      expect(new Failure('a detail', { cause }).cause).toBe(cause);
    }
  });

  it('never names the Anthropic API, which is what ../errors.ts does', () => {
    // The reason these exist at all: `../errors.ts` says "Anthropic API" in so
    // many words and matches against that SDK's classes.
    for (const Failure of EVERY_ERROR) {
      expect(new Failure('a detail').message).not.toContain('Anthropic');
    }
  });
});

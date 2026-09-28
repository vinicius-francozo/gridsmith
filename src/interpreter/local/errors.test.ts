import { describe, expect, it } from 'vitest';

import { InterpreterError } from '../errors';

import { ClassificationFailedError, ModelUnavailableError } from './errors';

describe('the local failures are interpreter failures', () => {
  it('makes a model that will not load an InterpreterError', () => {
    // This is what puts it in front of the person as a sentence rather than as
    // "algo deu errado ao montar o mapa": `describeFailure` ends with an
    // `instanceof InterpreterError` arm.
    expect(new ModelUnavailableError('offline')).toBeInstanceOf(InterpreterError);
  });

  it('makes an unreadable answer an InterpreterError', () => {
    expect(new ClassificationFailedError('no labels')).toBeInstanceOf(InterpreterError);
  });

  it('names each one, so a log says which happened', () => {
    expect(new ModelUnavailableError('offline').name).toBe('ModelUnavailableError');
    expect(new ClassificationFailedError('no labels').name).toBe('ClassificationFailedError');
  });

  it('tells the two apart, so a caller can answer each differently', () => {
    expect(new ClassificationFailedError('no labels')).not.toBeInstanceOf(ModelUnavailableError);
    expect(new ModelUnavailableError('offline')).not.toBeInstanceOf(ClassificationFailedError);
  });
});

describe('what each one says', () => {
  it('keeps the detail of a load failure in the message', () => {
    expect(new ModelUnavailableError('failed to fetch').message).toContain('failed to fetch');
  });

  it('says the model is large, because that is what the person is waiting on', () => {
    expect(new ModelUnavailableError('failed to fetch').message).toContain('large download');
  });

  it('keeps the detail of an unreadable answer in the message', () => {
    expect(new ClassificationFailedError('clutter: too big').message).toContain('clutter: too big');
  });

  it('keeps the cause, so the original is not lost', () => {
    const original = new Error('TypeError: fetch failed');

    expect(new ModelUnavailableError('offline', { cause: original }).cause).toBe(original);
    expect(new ClassificationFailedError('nope', { cause: original }).cause).toBe(original);
  });
});

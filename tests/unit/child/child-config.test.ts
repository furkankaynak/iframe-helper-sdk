import { describe, expect, test } from 'vitest';

import { normalizeChildConfig } from '../../../src/child/child-config';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';

const parentOrigin = 'https://parent.example';
const encodedParentOrigin = encodeURIComponent(parentOrigin);

describe('normalizeChildConfig', () => {
  test('parses default query bootstrap values', () => {
    const normalized = normalizeChildConfig(
      {},
      locationFromHref(
        `https://child.example/app?__iframeBridgeSessionId=session-1&__iframeBridgeParentOrigin=${encodedParentOrigin}`,
      ),
    );

    expect(normalized.sessionId).toBe('session-1');
    expect(normalized.parentOrigin).toBe(parentOrigin);
    expect(normalized.connectionTimeoutMs).toBe(10000);
    expect(normalized.bootstrap.session.paramName).toBe('__iframeBridgeSessionId');
    expect(normalized.bootstrap.parentOrigin.paramName).toBe('__iframeBridgeParentOrigin');
    expect(normalized.bootstrap.session.location).toBe('query');
  });

  test('parses hash bootstrap values', () => {
    const normalized = normalizeChildConfig(
      {
        bootstrap: {
          parentOrigin: { location: 'hash' },
          session: { location: 'hash' },
        },
      },
      locationFromHref(
        `https://child.example/app#__iframeBridgeSessionId=session-2&__iframeBridgeParentOrigin=${encodedParentOrigin}`,
      ),
    );

    expect(normalized.sessionId).toBe('session-2');
    expect(normalized.parentOrigin).toBe(parentOrigin);
    expect(normalized.bootstrap.session.location).toBe('hash');
  });

  test('omitted allowedParentOrigins accepts the bootstrap parent origin', () => {
    const normalized = normalizeChildConfig({}, defaultLocation());

    expect(normalized.parentOrigin).toBe(parentOrigin);
    expect(normalized.allowedParentOrigins).toBeNull();
  });

  test('null allowedParentOrigins accepts the bootstrap parent origin', () => {
    const normalized = normalizeChildConfig({ allowedParentOrigins: null }, defaultLocation());

    expect(normalized.parentOrigin).toBe(parentOrigin);
    expect(normalized.allowedParentOrigins).toBeNull();
  });

  test('non-empty allowedParentOrigins requires an exact bootstrap parent origin match', () => {
    const normalized = normalizeChildConfig(
      { allowedParentOrigins: ['https://parent.example', 'https://other.example'] },
      defaultLocation(),
    );

    expect(normalized.parentOrigin).toBe(parentOrigin);
    expect(normalized.allowedParentOrigins).toEqual([
      'https://parent.example',
      'https://other.example',
    ]);
  });

  test('rejects an allowedParentOrigins mismatch', () => {
    expectBridgeError(
      () =>
        normalizeChildConfig(
          { allowedParentOrigins: ['https://other.example'] },
          defaultLocation(),
        ),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test('rejects an empty allowedParentOrigins array', () => {
    expectBridgeError(
      () => normalizeChildConfig({ allowedParentOrigins: [] }, defaultLocation()),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test('rejects a missing session id', () => {
    expectBridgeError(
      () =>
        normalizeChildConfig(
          {},
          locationFromHref(
            `https://child.example/app?__iframeBridgeParentOrigin=${encodedParentOrigin}`,
          ),
        ),
      'CONFIG_INVALID_SRC',
    );
  });

  test('rejects a missing parent origin', () => {
    expectBridgeError(
      () =>
        normalizeChildConfig(
          {},
          locationFromHref('https://child.example/app?__iframeBridgeSessionId=session-1'),
        ),
      'CONFIG_INVALID_SRC',
    );
  });

  test('rejects an invalid connection timeout', () => {
    expectBridgeError(
      () => normalizeChildConfig({ bootstrap: { connectionTimeoutMs: 0 } }, defaultLocation()),
      'CONFIG_INVALID_TIMEOUT',
    );
  });
});

function defaultLocation(): Location {
  return locationFromHref(
    `https://child.example/app?__iframeBridgeSessionId=session-1&__iframeBridgeParentOrigin=${encodedParentOrigin}`,
  );
}

function locationFromHref(href: string): Location {
  const url = new URL(href);

  return {
    hash: url.hash,
    href: url.href,
    search: url.search,
  } as Location;
}

function expectBridgeError(callback: () => void, code: IframeBridgeErrorCode): void {
  expect(callback).toThrow(IframeBridgeError);

  try {
    callback();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code).toBe(code);
  }
}

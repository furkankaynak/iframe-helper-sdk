import { describe, expect, test } from 'vitest';

import { buildBootstrapUrl, type BootstrapUrlConfig } from '../../../src/host/bootstrap-url';

const queryBootstrap = {
  parentOrigin: {
    enabled: true,
    location: 'query',
    paramName: 'parentOrigin',
    value: 'https://host.example',
  },
  session: {
    location: 'query',
    paramName: 'sessionId',
    paramValue: 'session-visible-correlation-id',
  },
} satisfies BootstrapUrlConfig;

const hashBootstrap = {
  parentOrigin: {
    enabled: true,
    location: 'hash',
    paramName: 'parentOrigin',
    value: 'https://host.example',
  },
  session: {
    location: 'hash',
    paramName: 'sessionId',
    paramValue: 'session-visible-correlation-id',
  },
} satisfies BootstrapUrlConfig;

describe('buildBootstrapUrl', () => {
  test('appends session and parent origin to the query without redacting the session id', () => {
    const url = buildBootstrapUrl('https://partner.example/app', queryBootstrap);

    expect(url.searchParams.get('sessionId')).toBe('session-visible-correlation-id');
    expect(url.searchParams.get('parentOrigin')).toBe('https://host.example');
    expect(url.href).toBe(
      'https://partner.example/app?sessionId=session-visible-correlation-id&parentOrigin=https%3A%2F%2Fhost.example',
    );
  });

  test('appends session and parent origin to an existing hash query', () => {
    const url = buildBootstrapUrl('https://partner.example/app#/child?tab=details', hashBootstrap);

    expect(url.href).toBe(
      'https://partner.example/app#/child?tab=details&sessionId=session-visible-correlation-id&parentOrigin=https%3A%2F%2Fhost.example',
    );
  });

  test('preserves existing query and hash values while returning a new URL', () => {
    const original = new URL('https://partner.example/app?mode=embedded#child-state');

    const url = buildBootstrapUrl(original, queryBootstrap);

    expect(url).not.toBe(original);
    expect(original.href).toBe('https://partner.example/app?mode=embedded#child-state');
    expect(url.href).toBe(
      'https://partner.example/app?mode=embedded&sessionId=session-visible-correlation-id&parentOrigin=https%3A%2F%2Fhost.example#child-state',
    );
  });

  test('preserves existing query serialization when appending query params', () => {
    const url = buildBootstrapUrl(
      'https://partner.example/app?next=%2Fchild%20route&flag=~',
      queryBootstrap,
    );

    expect(url.href).toBe(
      'https://partner.example/app?next=%2Fchild%20route&flag=~&sessionId=session-visible-correlation-id&parentOrigin=https%3A%2F%2Fhost.example',
    );
  });

  test('preserves hash text without existing hash query when appending hash params', () => {
    const url = buildBootstrapUrl(
      'https://partner.example/app?mode=embedded#child-state',
      hashBootstrap,
    );

    expect(url.href).toBe(
      'https://partner.example/app?mode=embedded#child-state?sessionId=session-visible-correlation-id&parentOrigin=https%3A%2F%2Fhost.example',
    );
  });

  test('does not append parent origin when disabled', () => {
    const url = buildBootstrapUrl('https://partner.example/app?mode=embedded', {
      ...queryBootstrap,
      parentOrigin: {
        ...queryBootstrap.parentOrigin,
        enabled: false,
      },
    });

    expect(url.searchParams.get('sessionId')).toBe('session-visible-correlation-id');
    expect(url.searchParams.has('parentOrigin')).toBe(false);
    expect(url.href).toBe(
      'https://partner.example/app?mode=embedded&sessionId=session-visible-correlation-id',
    );
  });
});

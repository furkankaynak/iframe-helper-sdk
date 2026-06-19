import { afterEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../../../src/host/config';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';

const parentOrigin = 'https://host.example';

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

afterEach(() => {
  restoreGlobalProperty('document', originalDocumentDescriptor);
  restoreGlobalProperty('location', originalLocationDescriptor);
});

describe('normalizeConfig', () => {
  test('resolves a selector container and normalizes a valid HTTPS URL', () => {
    const container = createElement();
    setDocumentQuerySelector((selector) => (selector === '#frame-root' ? container : null));
    setLocationOrigin(parentOrigin);

    const normalized = normalizeConfig({
      bootstrap: {
        session: {
          paramValue: 'session-1',
        },
      },
      container: '#frame-root',
      src: 'https://partner.example/app?mode=embedded',
    });

    expect(normalized.container).toBe(container);
    expect(normalized.url.href).toBe('https://partner.example/app?mode=embedded');
    expect(normalized.targetOrigin).toBe('https://partner.example');
    expect(normalized.allowedOrigin).toBe('https://partner.example');
    expect(normalized.bootstrap.session.paramValue).toBe('session-1');
    expect(normalized.replaceContainerContent).toBe(false);
    expect(normalized.warnings).toEqual([]);
  });

  test.each([
    ['http://localhost:3000/app', 'http://localhost:3000'],
    ['http://127.0.0.1:5173/app', 'http://127.0.0.1:5173'],
    ['http://[::1]:5173/app', 'http://[::1]:5173'],
  ])('allows localhost development URL %s when explicitly enabled', (src, expectedOrigin) => {
    const normalized = normalizeConfig({
      allowInsecureLocalhost: true,
      bootstrap: {
        session: {
          paramValue: 'session-1',
        },
      },
      container: createElement(),
      src,
    });

    expect(normalized.targetOrigin).toBe(expectedOrigin);
    expect(normalized.allowedOrigin).toBe(expectedOrigin);
  });

  test('rejects a missing selector container with a typed config error', () => {
    setDocumentQuerySelector(() => null);

    expectBridgeError(
      () =>
        normalizeConfig({
          container: '#missing',
          src: 'https://partner.example/app',
        }),
      'CONFIG_INVALID_CONTAINER',
    );
  });

  test('rejects non-element container values from untyped callers', () => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: {} as Element,
          src: 'https://partner.example/app',
        }),
      'CONFIG_INVALID_CONTAINER',
    );
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,<p>iframe</p>',
    'blob:https://partner.example/id',
  ])('rejects unsafe iframe src scheme %s', (src) => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          src,
        }),
      'CONFIG_INVALID_SRC',
    );
  });

  test('rejects an invalid iframe src URL', () => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          src: 'not a url',
        }),
      'CONFIG_INVALID_SRC',
    );
  });

  test('rejects iframe src URLs with embedded credentials', () => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          src: 'https://user:pass@partner.example/app',
        }),
      'CONFIG_INVALID_SRC',
    );
  });

  test('rejects insecure non-localhost HTTP origins', () => {
    expectBridgeError(
      () =>
        normalizeConfig({
          allowInsecureLocalhost: true,
          container: createElement(),
          src: 'http://partner.example/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test.each(['targetOrigin', 'allowedOrigin'] as const)('rejects wildcard %s', (originOption) => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          [originOption]: '*',
          src: 'https://partner.example/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test.each([
    ['targetOrigin', 'https://partner.example/path'],
    ['allowedOrigin', 'https://partner.example?x=1'],
    ['targetOrigin', 'https://*.partner.example'],
    ['allowedOrigin', 'ftp://partner.example'],
  ] as const)('rejects non-exact %s value %s', (originOption, origin) => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          [originOption]: origin,
          src: 'https://partner.example/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test.each(['https://host.example/path', '*'])(
    'rejects unsafe bootstrap parent origin %s',
    (value) => {
      expectBridgeError(
        () =>
          normalizeConfig({
            bootstrap: {
              parentOrigin: { value },
            },
            container: createElement(),
            src: 'https://partner.example/app',
          }),
        'CONFIG_UNSAFE_ORIGIN',
      );
    },
  );

  test('defaults to allowing insecure localhost iframe URLs from a localhost parent origin', () => {
    setLocationOrigin('http://localhost:5173');

    const normalized = normalizeConfig({
      container: createElement(),
      src: 'http://localhost:3000/app',
    });

    expect(normalized.targetOrigin).toBe('http://localhost:3000');
    expect(normalized.allowedOrigin).toBe('http://localhost:3000');
    expect(normalized.bootstrap.parentOrigin.value).toBe('http://localhost:5173');
  });

  test('defaults to rejecting insecure localhost iframe URLs from a non-localhost parent origin', () => {
    setLocationOrigin(parentOrigin);

    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          src: 'http://localhost:3000/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test('applies default bootstrap, timeout, and queue values', () => {
    setLocationOrigin(parentOrigin);

    const normalized = normalizeConfig({
      container: createElement(),
      src: 'https://partner.example/app',
    });

    expect(normalized.bootstrap.session.paramName).toBe('__iframeBridgeSessionId');
    expect(normalized.bootstrap.session.paramValue).toEqual(expect.any(String));
    expect(normalized.bootstrap.session.paramValue).not.toBe('');
    expect(normalized.bootstrap.session.location).toBe('query');
    expect(normalized.bootstrap.parentOrigin).toEqual({
      enabled: true,
      location: 'query',
      paramName: '__iframeBridgeParentOrigin',
      value: parentOrigin,
    });
    expect(normalized.bootstrap.handshakeTimeoutMs).toBe(10000);
    expect(normalized.timeouts.operationTimeoutMs).toBe(5000);
    expect(normalized.queue).toEqual({
      enabled: true,
      maxSize: 50,
    });
    expect(normalized.securityProfile).toBe('development');
  });

  test('normalizes strict security profile for production configurations', () => {
    setLocationOrigin(parentOrigin);

    const normalized = normalizeConfig({
      container: createElement(),
      securityProfile: 'strict',
      src: 'https://partner.example/app',
    });

    expect(normalized.securityProfile).toBe('strict');
    expect(normalized.warnings).toEqual([]);
  });

  test('rejects invalid security profile values from untyped callers', () => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          securityProfile: 'permissive' as never,
          src: 'https://partner.example/app',
        }),
      'CONFIG_INVALID_SECURITY_PROFILE' as IframeBridgeErrorCode,
    );
  });

  test('strict profile rejects insecure localhost even from localhost parents', () => {
    setLocationOrigin('http://localhost:5173');

    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          securityProfile: 'strict',
          src: 'http://localhost:3000/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test('strict profile validates default bootstrap parent origin from current location', () => {
    setLocationOrigin('http://localhost:5173');

    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          securityProfile: 'strict',
          src: 'https://partner.example/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test('strict profile rejects explicit insecure localhost allowance', () => {
    expectBridgeError(
      () =>
        normalizeConfig({
          allowInsecureLocalhost: true,
          container: createElement(),
          securityProfile: 'strict',
          src: 'https://partner.example/app',
        }),
      'CONFIG_UNSAFE_ORIGIN',
    );
  });

  test('freezes normalized config and nested plain objects', () => {
    const normalized = normalizeConfig({
      container: createElement(),
      iframeAttributes: {
        title: 'Embedded child',
      },
      sandbox: ['allow-scripts', 'allow-same-origin'],
      src: 'https://partner.example/app',
    });

    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.bootstrap)).toBe(true);
    expect(Object.isFrozen(normalized.bootstrap.parentOrigin)).toBe(true);
    expect(Object.isFrozen(normalized.bootstrap.session)).toBe(true);
    expect(Object.isFrozen(normalized.iframeAttributes)).toBe(true);
    expect(Object.isFrozen(normalized.queue)).toBe(true);
    expect(Object.isFrozen(normalized.timeouts)).toBe(true);
    expect(Object.isFrozen(normalized.warnings)).toBe(true);
  });

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects an invalid queue max size %s', (_label, maxSize) => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          queue: { maxSize },
          src: 'https://partner.example/app',
        }),
      'CONFIG_INVALID_QUEUE',
    );
  });

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects an invalid handshake timeout %s', (_label, handshakeTimeoutMs) => {
    expectBridgeError(
      () =>
        normalizeConfig({
          bootstrap: { handshakeTimeoutMs },
          container: createElement(),
          src: 'https://partner.example/app',
        }),
      'CONFIG_INVALID_TIMEOUT',
    );
  });

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects an invalid operation timeout %s', (_label, operationTimeoutMs) => {
    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          src: 'https://partner.example/app',
          timeouts: { operationTimeoutMs },
        }),
      'CONFIG_INVALID_TIMEOUT',
    );
  });

  test('warns when sandbox combines allow-scripts and allow-same-origin', () => {
    const normalized = normalizeConfig({
      container: createElement(),
      sandbox: ['allow-scripts', 'allow-same-origin'],
      src: 'https://partner.example/app',
    });

    expect(normalized.sandbox).toBe('allow-scripts allow-same-origin');
    expect(normalized.warnings).toEqual([
      expect.objectContaining({
        code: 'CONFIG_UNSAFE_SANDBOX',
        message: expect.stringContaining('allow-scripts'),
      }),
    ]);
  });

  test('strict profile rejects sandbox that combines allow-scripts and allow-same-origin', () => {
    setLocationOrigin(parentOrigin);

    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          sandbox: ['allow-scripts', 'allow-same-origin'],
          securityProfile: 'strict',
          src: 'https://partner.example/app',
        }),
      'CONFIG_UNSAFE_SANDBOX',
    );
  });

  test('warns when iframe allow grants wildcard Permissions Policy features', () => {
    const normalized = normalizeConfig({
      container: createElement(),
      iframeAttributes: {
        allow: 'camera *; microphone https://trusted.example',
      },
      src: 'https://partner.example/app',
    });

    expect(normalized.warnings).toEqual([
      expect.objectContaining({
        code: 'CONFIG_UNSAFE_PERMISSIONS_POLICY',
        details: { allow: 'camera *; microphone https://trusted.example' },
        message: expect.stringContaining('Permissions Policy'),
      }),
    ]);
  });

  test('strict profile rejects wildcard Permissions Policy grants', () => {
    setLocationOrigin(parentOrigin);

    expectBridgeError(
      () =>
        normalizeConfig({
          container: createElement(),
          iframeAttributes: {
            allow: 'camera *',
          },
          securityProfile: 'strict',
          src: 'https://partner.example/app',
        }),
      'CONFIG_UNSAFE_PERMISSIONS_POLICY' as IframeBridgeErrorCode,
    );
  });
});

function createElement(): Element {
  return { nodeType: 1 } as Element;
}

function setDocumentQuerySelector(querySelector: (selector: string) => Element | null): void {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector },
  });
}

function setLocationOrigin(origin: string): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin },
  });
}

function restoreGlobalProperty(
  property: 'document' | 'location',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, property, descriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, property);
}

function expectBridgeError(run: () => void, code: IframeBridgeErrorCode): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code).toBe(code);
    return;
  }

  throw new Error(`Expected ${code}`);
}

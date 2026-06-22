import { IframeBridgeError } from '../shared/errors.js';
import type { BootstrapParamLocation, IframeChildBridgeConfig } from '../types/index.js';

const defaultSessionParamName = '__iframeBridgeSessionId';
const defaultParentOriginParamName = '__iframeBridgeParentOrigin';
const defaultConnectionTimeoutMs = 10000;

export type ChildConfigLocation = Pick<Location, 'hash' | 'href' | 'search'>;

export type NormalizedIframeChildBridgeConfig = {
  readonly allowedParentOrigins: readonly string[] | null;
  readonly bootstrap: {
    readonly connectionTimeoutMs: number;
    readonly parentOrigin: {
      readonly location: BootstrapParamLocation;
      readonly paramName: string;
    };
    readonly session: {
      readonly location: BootstrapParamLocation;
      readonly paramName: string;
    };
  };
  readonly connectionTimeoutMs: number;
  readonly parentOrigin: string;
  readonly sessionId: string;
};

export function normalizeChildConfig(
  config: IframeChildBridgeConfig = {},
  location: ChildConfigLocation = getCurrentLocation(),
): NormalizedIframeChildBridgeConfig {
  const sessionLocation = normalizeBootstrapLocation(
    config.bootstrap?.session?.location ?? 'query',
  );
  const parentOriginLocation = normalizeBootstrapLocation(
    config.bootstrap?.parentOrigin?.location ?? 'query',
  );
  const sessionParamName = config.bootstrap?.session?.paramName ?? defaultSessionParamName;
  const parentOriginParamName =
    config.bootstrap?.parentOrigin?.paramName ?? defaultParentOriginParamName;
  const connectionTimeoutMs = normalizeTimeout(
    config.bootstrap?.connectionTimeoutMs ?? defaultConnectionTimeoutMs,
  );
  const sessionId = readRequiredBootstrapParam(
    location,
    sessionLocation,
    sessionParamName,
    'session',
  );
  const parentOrigin = parseExactOrigin(
    readRequiredBootstrapParam(
      location,
      parentOriginLocation,
      parentOriginParamName,
      'parentOrigin',
    ),
  );
  const allowedParentOrigins = normalizeAllowedParentOrigins(
    config.allowedParentOrigins,
    parentOrigin,
  );

  return Object.freeze({
    allowedParentOrigins,
    bootstrap: Object.freeze({
      connectionTimeoutMs,
      parentOrigin: Object.freeze({
        location: parentOriginLocation,
        paramName: parentOriginParamName,
      }),
      session: Object.freeze({
        location: sessionLocation,
        paramName: sessionParamName,
      }),
    }),
    connectionTimeoutMs,
    parentOrigin,
    sessionId,
  });
}

function normalizeBootstrapLocation(location: BootstrapParamLocation): BootstrapParamLocation {
  if (location === 'query' || location === 'hash') {
    return location;
  }

  throw new IframeBridgeError('CONFIG_INVALID_SRC', 'Bootstrap location must be query or hash.', {
    details: { location },
  });
}

function readRequiredBootstrapParam(
  location: ChildConfigLocation,
  paramLocation: BootstrapParamLocation,
  paramName: string,
  fieldName: string,
): string {
  const value = paramsForLocation(location, paramLocation).get(paramName)?.trim();

  if (value) {
    return value;
  }

  throw new IframeBridgeError('CONFIG_INVALID_SRC', 'Child bootstrap parameter is missing.', {
    details: { fieldName, paramLocation, paramName },
  });
}

function paramsForLocation(
  location: ChildConfigLocation,
  paramLocation: BootstrapParamLocation,
): URLSearchParams {
  if (paramLocation === 'query') {
    return new URLSearchParams(location.search);
  }

  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = hash.startsWith('?') ? hash.slice(1) : hash;

  return new URLSearchParams(params);
}

function normalizeAllowedParentOrigins(
  allowedParentOrigins: readonly string[] | null | undefined,
  parentOrigin: string,
): readonly string[] | null {
  if (allowedParentOrigins === undefined || allowedParentOrigins === null) {
    return null;
  }

  if (allowedParentOrigins.length === 0) {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'allowedParentOrigins must be omitted, null, or a non-empty exact-origin allowlist.',
    );
  }

  const normalizedOrigins = allowedParentOrigins.map((origin) => parseExactOrigin(origin));

  if (!normalizedOrigins.includes(parentOrigin)) {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'Bootstrap parent origin is not in allowedParentOrigins.',
      { details: { allowedParentOrigins: normalizedOrigins, parentOrigin } },
    );
  }

  return Object.freeze(normalizedOrigins);
}

function normalizeTimeout(timeoutMs: number): number {
  if (Number.isInteger(timeoutMs) && timeoutMs >= 1) {
    return timeoutMs;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_TIMEOUT',
    'Connection timeout must be an integer greater than or equal to 1.',
    { details: { timeoutMs } },
  );
}

function parseExactOrigin(origin: string): string {
  const trimmedOrigin = origin.trim();

  if (trimmedOrigin === '*' || trimmedOrigin.includes('*')) {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Wildcard origins are not allowed.', {
      details: { origin },
    });
  }

  if (trimmedOrigin === '') {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Origin must not be empty.', {
      details: { origin },
    });
  }

  let parsedOrigin: URL;

  try {
    parsedOrigin = new URL(trimmedOrigin);
  } catch (cause: unknown) {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Origin must be an absolute URL origin.', {
      cause,
      details: { origin },
    });
  }

  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Origin must use HTTP or HTTPS.', {
      details: { origin },
    });
  }

  if (parsedOrigin.protocol === 'http:' && !isLocalhost(parsedOrigin.hostname)) {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Origin must use HTTPS.', {
      details: { origin },
    });
  }

  if (!isExactOriginString(trimmedOrigin, parsedOrigin)) {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'Origin must not include path, query, or hash.',
      { details: { origin } },
    );
  }

  return parsedOrigin.origin;
}

function isExactOriginString(origin: string, parsedOrigin: URL): boolean {
  if (parsedOrigin.username !== '' || parsedOrigin.password !== '') {
    return false;
  }

  const authorityMatch = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(origin);

  return authorityMatch?.[0] === origin;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function getCurrentLocation(): ChildConfigLocation {
  if (typeof location !== 'undefined') {
    return location;
  }

  throw new IframeBridgeError('CONFIG_INVALID_SRC', 'Child bootstrap requires a location.');
}

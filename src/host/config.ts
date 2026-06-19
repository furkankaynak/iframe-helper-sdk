import { IframeBridgeError } from '../shared/errors.js';
import type {
  BootstrapParamLocation,
  DiagnosticEvent,
  IframeBridgeConfig,
  IframeBridgeIframeAttributes,
  IframeBridgeSecurityProfile,
} from '../types/index.js';

const defaultSessionParamName = '__iframeBridgeSessionId';
const defaultParentOriginParamName = '__iframeBridgeParentOrigin';
const defaultHandshakeTimeoutMs = 10000;
const defaultOperationTimeoutMs = 5000;
const defaultQueueMaxSize = 50;

export type NormalizedIframeBridgeConfig = {
  readonly allowedOrigin: string;
  readonly bootstrap: {
    readonly handshakeTimeoutMs: number;
    readonly parentOrigin: {
      readonly enabled: boolean;
      readonly location: BootstrapParamLocation;
      readonly paramName: string;
      readonly value: string;
    };
    readonly session: {
      readonly location: BootstrapParamLocation;
      readonly paramName: string;
      readonly paramValue: string;
    };
  };
  readonly container: Element;
  readonly iframeAttributes: Readonly<IframeBridgeIframeAttributes>;
  readonly queue: {
    readonly enabled: boolean;
    readonly maxSize: number;
  };
  readonly replaceContainerContent: boolean;
  readonly sandbox: string | undefined;
  readonly securityProfile: IframeBridgeSecurityProfile;
  readonly targetOrigin: string;
  readonly timeouts: {
    readonly operationTimeoutMs: number;
  };
  readonly url: URL;
  readonly warnings: readonly Readonly<DiagnosticEvent>[];
};

export function normalizeConfig(config: IframeBridgeConfig): NormalizedIframeBridgeConfig {
  const currentOrigin = getCurrentOrigin();
  const securityProfile = normalizeSecurityProfile(config.securityProfile);

  if (securityProfile === 'strict' && config.allowInsecureLocalhost === true) {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'Strict security profile does not allow insecure localhost origins.',
      { details: { securityProfile } },
    );
  }

  const allowInsecureLocalhost =
    securityProfile === 'strict'
      ? false
      : (config.allowInsecureLocalhost ?? isLocalhostOrigin(currentOrigin));
  const container = resolveContainer(config.container);
  const url = parseIframeUrl(config.src);

  validateIframeUrl(url, allowInsecureLocalhost);

  const derivedOrigin = url.origin;
  const targetOrigin = normalizeOrigin(config.targetOrigin, derivedOrigin, allowInsecureLocalhost);
  const allowedOrigin = normalizeOrigin(
    config.allowedOrigin,
    derivedOrigin,
    allowInsecureLocalhost,
  );
  const parentOriginValue = normalizeParentOrigin(
    config.bootstrap?.parentOrigin?.value,
    currentOrigin,
    allowInsecureLocalhost,
    securityProfile === 'strict',
  );
  const handshakeTimeoutMs = normalizeTimeout(
    config.bootstrap?.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs,
    'handshakeTimeoutMs',
  );
  const operationTimeoutMs = normalizeTimeout(
    config.timeouts?.operationTimeoutMs ?? defaultOperationTimeoutMs,
    'operationTimeoutMs',
  );
  const queueMaxSize = normalizeQueueMaxSize(config.queue?.maxSize ?? defaultQueueMaxSize);
  const iframeAttributes = Object.freeze({ ...config.iframeAttributes });
  const sandbox = normalizeSandbox(config.sandbox, securityProfile);
  const permissionsPolicyWarnings = createPermissionsPolicyWarnings(
    iframeAttributes.allow,
    securityProfile,
  );

  return freezeNormalizedConfig({
    allowedOrigin,
    bootstrap: Object.freeze({
      handshakeTimeoutMs,
      parentOrigin: Object.freeze({
        enabled: config.bootstrap?.parentOrigin?.enabled ?? true,
        location: config.bootstrap?.parentOrigin?.location ?? 'query',
        paramName: config.bootstrap?.parentOrigin?.paramName ?? defaultParentOriginParamName,
        value: parentOriginValue,
      }),
      session: Object.freeze({
        location: config.bootstrap?.session?.location ?? 'query',
        paramName: config.bootstrap?.session?.paramName ?? defaultSessionParamName,
        paramValue: config.bootstrap?.session?.paramValue ?? createSessionId(),
      }),
    }),
    container,
    iframeAttributes,
    queue: Object.freeze({
      enabled: config.queue?.enabled ?? true,
      maxSize: queueMaxSize,
    }),
    replaceContainerContent: config.replaceContainerContent ?? false,
    sandbox: sandbox.value,
    securityProfile,
    targetOrigin,
    timeouts: Object.freeze({
      operationTimeoutMs,
    }),
    url,
    warnings: Object.freeze(
      [...sandbox.warnings, ...permissionsPolicyWarnings].map((warning) =>
        Object.freeze({ ...warning }),
      ),
    ),
  });
}

function freezeNormalizedConfig(
  config: NormalizedIframeBridgeConfig,
): NormalizedIframeBridgeConfig {
  return Object.freeze(config);
}

function normalizeTimeout(timeoutMs: number, name: string): number {
  if (Number.isInteger(timeoutMs) && timeoutMs >= 1) {
    return timeoutMs;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_TIMEOUT',
    'Timeout must be an integer greater than or equal to 1.',
    {
      details: { name, timeoutMs },
    },
  );
}

function normalizeQueueMaxSize(maxSize: number): number {
  if (Number.isInteger(maxSize) && maxSize >= 1) {
    return maxSize;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_QUEUE',
    'Queue maxSize must be an integer greater than or equal to 1.',
    {
      details: { maxSize },
    },
  );
}

function normalizeSecurityProfile(
  securityProfile: IframeBridgeSecurityProfile | undefined,
): IframeBridgeSecurityProfile {
  if (securityProfile === undefined) {
    return 'development';
  }

  if (securityProfile === 'development' || securityProfile === 'strict') {
    return securityProfile;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_SECURITY_PROFILE',
    'Security profile must be either development or strict.',
    { details: { securityProfile } },
  );
}

function resolveContainer(container: Element | string): Element {
  if (typeof container !== 'string') {
    if (!isElementLike(container)) {
      throw new IframeBridgeError('CONFIG_INVALID_CONTAINER', 'Container must be an Element.', {
        details: { containerType: typeof container },
      });
    }

    return container;
  }

  if (typeof document === 'undefined') {
    throw new IframeBridgeError(
      'CONFIG_INVALID_CONTAINER',
      'Container selector requires a document.',
      {
        details: { selector: container },
      },
    );
  }

  let resolvedContainer: Element | null;

  try {
    resolvedContainer = document.querySelector(container);
  } catch (cause: unknown) {
    throw new IframeBridgeError('CONFIG_INVALID_CONTAINER', 'Container selector is invalid.', {
      cause,
      details: { selector: container },
    });
  }

  if (!resolvedContainer) {
    throw new IframeBridgeError(
      'CONFIG_INVALID_CONTAINER',
      'Container selector did not match an element.',
      {
        details: { selector: container },
      },
    );
  }

  return resolvedContainer;
}

function isElementLike(value: unknown): value is Element {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    ('nodeType' in value && value.nodeType === 1) ||
    ('appendChild' in value && typeof value.appendChild === 'function') ||
    ('replaceChildren' in value && typeof value.replaceChildren === 'function')
  );
}

function parseIframeUrl(src: string | URL): URL {
  try {
    return new URL(src instanceof URL ? src.href : src);
  } catch (cause: unknown) {
    throw new IframeBridgeError('CONFIG_INVALID_SRC', 'Iframe src must be an absolute URL.', {
      cause,
      details: { src: String(src) },
    });
  }
}

function validateIframeUrl(url: URL, allowInsecureLocalhost: boolean): void {
  if (url.username !== '' || url.password !== '') {
    throw new IframeBridgeError(
      'CONFIG_INVALID_SRC',
      'Iframe src must not include embedded credentials.',
      {
        details: { origin: url.origin },
      },
    );
  }

  if (url.protocol === 'https:') {
    return;
  }

  if (url.protocol === 'http:') {
    if (allowInsecureLocalhost && isLocalhost(url.hostname)) {
      return;
    }

    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Iframe src must use HTTPS.', {
      details: { origin: url.origin },
    });
  }

  throw new IframeBridgeError('CONFIG_INVALID_SRC', 'Iframe src uses an unsupported URL scheme.', {
    details: { protocol: url.protocol },
  });
}

function normalizeOrigin(
  origin: string | undefined,
  fallbackOrigin: string,
  allowInsecureLocalhost: boolean,
): string {
  if (origin === undefined) {
    return fallbackOrigin;
  }

  return parseExactOrigin(origin, allowInsecureLocalhost);
}

function normalizeParentOrigin(
  origin: string | undefined,
  fallbackOrigin: string,
  allowInsecureLocalhost: boolean,
  validateFallbackOrigin = false,
): string {
  if (origin === undefined) {
    if (validateFallbackOrigin) {
      return parseExactOrigin(fallbackOrigin, allowInsecureLocalhost);
    }

    return fallbackOrigin;
  }

  return parseExactOrigin(origin, allowInsecureLocalhost);
}

function parseExactOrigin(origin: string, allowInsecureLocalhost: boolean): string {
  const trimmedOrigin = origin.trim();

  if (trimmedOrigin === '*' || trimmedOrigin.includes('*')) {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Wildcard origins are not allowed.', {
      details: { origin },
    });
  }

  if (trimmedOrigin === '') {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Configured origin must not be empty.', {
      details: { origin },
    });
  }

  let parsedOrigin: URL;

  try {
    parsedOrigin = new URL(trimmedOrigin);
  } catch (cause: unknown) {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'Configured origin must be an absolute URL origin.',
      {
        cause,
        details: { origin },
      },
    );
  }

  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'Configured origin must use HTTP or HTTPS.',
      {
        details: { origin },
      },
    );
  }

  if (
    parsedOrigin.protocol === 'http:' &&
    !(allowInsecureLocalhost && isLocalhost(parsedOrigin.hostname))
  ) {
    throw new IframeBridgeError('CONFIG_UNSAFE_ORIGIN', 'Configured origin must use HTTPS.', {
      details: { origin },
    });
  }

  if (!isExactOriginString(trimmedOrigin, parsedOrigin)) {
    throw new IframeBridgeError(
      'CONFIG_UNSAFE_ORIGIN',
      'Configured origin must not include path, query, or hash.',
      {
        details: { origin },
      },
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

function normalizeSandbox(
  sandbox: string | readonly string[] | undefined,
  securityProfile: IframeBridgeSecurityProfile,
): {
  value: string | undefined;
  warnings: DiagnosticEvent[];
} {
  const value = typeof sandbox === 'string' ? sandbox : sandbox?.join(' ');
  const tokens = new Set((value ?? '').split(/\s+/).filter(Boolean));

  if (!tokens.has('allow-scripts') || !tokens.has('allow-same-origin')) {
    return { value, warnings: [] };
  }

  const warning = {
    code: 'CONFIG_UNSAFE_SANDBOX',
    details: { sandbox: value },
    message:
      'Sandbox combines allow-scripts and allow-same-origin, which can weaken iframe isolation.',
  };

  if (securityProfile === 'strict') {
    throw new IframeBridgeError('CONFIG_UNSAFE_SANDBOX', warning.message, {
      details: warning.details,
    });
  }

  return {
    value,
    warnings: [warning],
  };
}

function createPermissionsPolicyWarnings(
  allow: string | undefined,
  securityProfile: IframeBridgeSecurityProfile,
): DiagnosticEvent[] {
  if (allow === undefined || !hasWildcardPermissionsPolicyGrant(allow)) {
    return [];
  }

  const warning = {
    code: 'CONFIG_UNSAFE_PERMISSIONS_POLICY',
    details: { allow },
    message:
      'Iframe Permissions Policy allow attribute grants wildcard access; use exact feature origins.',
  };

  if (securityProfile === 'strict') {
    throw new IframeBridgeError('CONFIG_UNSAFE_PERMISSIONS_POLICY', warning.message, {
      details: warning.details,
    });
  }

  return [warning];
}

function hasWildcardPermissionsPolicyGrant(allow: string): boolean {
  return /(^|[\s(;])\*(?=$|[\s;)])/u.test(allow);
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const parsedOrigin = new URL(origin);

    return (
      (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
      isLocalhost(parsedOrigin.hostname)
    );
  } catch {
    return false;
  }
}

function getCurrentOrigin(): string {
  return typeof location === 'undefined' ? '' : location.origin;
}

function createSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `iframe-bridge-${Date.now().toString(36)}-${randomText()}`
  );
}

function randomText(): string {
  return Math.random().toString(36).slice(2);
}

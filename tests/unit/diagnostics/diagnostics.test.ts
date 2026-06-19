import { afterEach, describe, expect, test, vi } from 'vitest';

import { createDiagnosticRecorder, createDiagnostics } from '../../../src/diagnostics/diagnostics';
import { createIframeBridge } from '../../../src/host/create-iframe-bridge';
import { IframeBridgeError } from '../../../src/shared/errors';
import type {
  BridgeMessageEvent,
  BridgeTransportWindowLike,
} from '../../../src/messaging/post-message-transport';
import type {
  BridgeEventEnvelope,
  BridgeReadyEnvelope,
  DiagnosticEvent,
  IframeBridgeConfig,
} from '../../../src/types';

const parentOrigin = 'https://host.example';
const childOrigin = 'https://child.example';
const sessionId = 'diagnostics-session';

const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

afterEach(() => {
  vi.useRealTimers();
  restoreGlobalProperty('location', originalLocationDescriptor);
});

describe('createDiagnostics', () => {
  test('delivers warnings without calling debug hooks when debug is disabled', () => {
    const logger = createLogger();
    const diagnostics = createDiagnostics({ logger });

    diagnostics.warn({
      code: 'CONFIG_UNSAFE_SANDBOX',
      details: { sandbox: 'allow-scripts allow-same-origin' },
      message: 'Sandbox combines risky permissions.',
      sessionId,
    });
    diagnostics.debug({
      code: 'BRIDGE_DEBUG',
      details: { state: 'waiting_for_handshake' },
      message: 'Bridge debug event.',
      sessionId,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONFIG_UNSAFE_SANDBOX',
        level: 'warn',
        message: 'Sandbox combines risky permissions.',
        sessionId,
      }),
    );
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('createDiagnosticRecorder', () => {
  test('records diagnostic logger events with levels, timestamps, and sequence numbers', () => {
    const recorder = createDiagnosticRecorder({ now: createNow([100, 101, 102]) });

    recorder.logger.debug({ code: 'DEBUG_EVENT', message: 'Debug event.', sessionId });
    recorder.logger.warn({ code: 'WARN_EVENT', message: 'Warn event.', sessionId });
    recorder.logger.error({ code: 'ERROR_EVENT', message: 'Error event.', sessionId });

    expect(recorder.entries).toEqual([
      {
        code: 'DEBUG_EVENT',
        level: 'debug',
        message: 'Debug event.',
        sequence: 1,
        sessionId,
        timestamp: 100,
      },
      {
        code: 'WARN_EVENT',
        level: 'warn',
        message: 'Warn event.',
        sequence: 2,
        sessionId,
        timestamp: 101,
      },
      {
        code: 'ERROR_EVENT',
        level: 'error',
        message: 'Error event.',
        sequence: 3,
        sessionId,
        timestamp: 102,
      },
    ]);
  });

  test('keeps only maxEntries and supports clear', () => {
    const recorder = createDiagnosticRecorder({ maxEntries: 2, now: createNow([1, 2, 3]) });

    recorder.logger.warn({ code: 'FIRST', message: 'First.' });
    recorder.logger.warn({ code: 'SECOND', message: 'Second.' });
    recorder.logger.warn({ code: 'THIRD', message: 'Third.' });

    expect(recorder.entries.map((entry) => entry.code)).toEqual(['SECOND', 'THIRD']);

    recorder.clear();

    expect(recorder.entries).toEqual([]);
  });

  test('returns immutable entry snapshots', () => {
    const recorder = createDiagnosticRecorder({ now: createNow([1, 2]) });

    recorder.logger.warn({ code: 'FIRST', message: 'First.' });

    const firstSnapshot = recorder.entries;
    const firstEntry = firstSnapshot[0];

    recorder.logger.warn({ code: 'SECOND', message: 'Second.' });

    expect(Object.isFrozen(firstSnapshot)).toBe(true);
    expect(Object.isFrozen(firstEntry)).toBe(true);
    expect(firstSnapshot.map((entry) => entry.code)).toEqual(['FIRST']);
    expect(recorder.entries.map((entry) => entry.code)).toEqual(['FIRST', 'SECOND']);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxEntries value %s',
    (maxEntries) => {
      expect(() => createDiagnosticRecorder({ maxEntries })).toThrow(IframeBridgeError);
    },
  );
});

describe('bridge diagnostics', () => {
  test('logs sandbox configuration warnings during bridge creation without debug logging', () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const harness = createHarness({
      diagnostics: { logger },
      sandbox: ['allow-scripts', 'allow-same-origin'],
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONFIG_UNSAFE_SANDBOX',
        details: { sandbox: 'allow-scripts allow-same-origin' },
        level: 'warn',
        message: expect.stringContaining('allow-scripts'),
        sessionId,
      }),
    );
    expect(logger.debug).not.toHaveBeenCalled();

    harness.bridge.destroy();
  });

  test('logs broad Permissions Policy warnings during bridge creation', () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const harness = createHarness({
      diagnostics: { logger },
      iframeAttributes: {
        allow: 'camera *',
      },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONFIG_UNSAFE_PERMISSIONS_POLICY',
        details: { allow: 'camera *' },
        level: 'warn',
        message: expect.stringContaining('Permissions Policy'),
        sessionId,
      }),
    );

    harness.bridge.destroy();
  });

  test('logs invalid transport messages without including the raw message payload', () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const harness = createHarness({ diagnostics: { logger } });

    harness.dispatch({
      payload: { secret: 'do-not-log' },
      protocol: 'iframe-bridge',
      sessionId,
      type: 'bridge:unknown',
      version: 1,
    });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MESSAGE_INVALID_ENVELOPE',
        details: expect.objectContaining({ reason: 'invalid_envelope' }),
        level: 'warn',
        message: expect.stringContaining('invalid'),
        sessionId,
      }),
    );
    expect(JSON.stringify(firstDiagnostic(logger.warn.mock.calls))).not.toContain('do-not-log');

    harness.bridge.destroy();
  });

  test('logs browser messageerror diagnostics without including raw message payloads', () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const harness = createHarness({ diagnostics: { logger } });

    harness.dispatchMessageError({ payload: { secret: 'do-not-log' } });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MESSAGE_DESERIALIZATION_ERROR',
        details: expect.objectContaining({ reason: 'message_error' }),
        level: 'warn',
        message: expect.stringContaining('messageerror'),
        sessionId,
      }),
    );
    expect(JSON.stringify(firstDiagnostic(logger.warn.mock.calls))).not.toContain('do-not-log');

    harness.bridge.destroy();
  });

  test('logs listener errors without blocking event waiters or logging event payloads', async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const harness = createHarness({ diagnostics: { logger } });

    harness.ready();
    harness.bridge.on('status:changed', () => {
      throw new Error('listener saw do-not-log');
    });
    const event = harness.bridge.waitForEvent<{ readonly secret: string }>('status:changed');

    harness.dispatch(eventEnvelope('status:changed', { secret: 'do-not-log' }));

    await expect(event).resolves.toEqual({ secret: 'do-not-log' });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EVENT_LISTENER_ERROR',
        details: expect.objectContaining({ errorName: 'Error', name: 'status:changed' }),
        level: 'error',
        message: expect.stringContaining('listener'),
        sessionId,
      }),
    );
    expect(JSON.stringify(firstDiagnostic(logger.error.mock.calls))).not.toContain('do-not-log');

    harness.bridge.destroy();
  });
});

type CreateHarnessOptions = {
  readonly diagnostics?: IframeBridgeConfig['diagnostics'];
  readonly iframeAttributes?: IframeBridgeConfig['iframeAttributes'];
  readonly sandbox?: IframeBridgeConfig['sandbox'];
};

function createHarness(options: CreateHarnessOptions = {}) {
  setLocationOrigin(parentOrigin);

  const container = new FakeContainer();
  const document = new FakeDocument();
  const parentWindow = new FakeParentWindow();
  const config: IframeBridgeConfig = {
    bootstrap: {
      handshakeTimeoutMs: 1000,
      session: {
        paramValue: sessionId,
      },
    },
    container: container as unknown as Element,
    src: 'https://child.example/app',
  };

  if (options.diagnostics !== undefined) {
    config.diagnostics = options.diagnostics;
  }

  if (options.iframeAttributes !== undefined) {
    config.iframeAttributes = options.iframeAttributes;
  }

  if (options.sandbox !== undefined) {
    config.sandbox = options.sandbox;
  }

  const bridge = createIframeBridge(config, {
    document: document as unknown as Document,
    parentWindow,
  });
  const iframe = document.createdIframes[0];

  if (iframe === undefined) {
    throw new Error('Expected bridge to create an iframe.');
  }

  return {
    bridge,
    dispatch(data: unknown): void {
      parentWindow.dispatch(messageEvent(data, iframe.contentWindow));
    },
    dispatchMessageError(data: unknown): void {
      parentWindow.dispatchMessageError(messageEvent(data, iframe.contentWindow));
    },
    ready(): void {
      parentWindow.dispatch(messageEvent(readyEnvelope(), iframe.contentWindow));
    },
  };
}

function createLogger() {
  return {
    debug: vi.fn<(event: DiagnosticEvent) => void>(),
    error: vi.fn<(event: DiagnosticEvent) => void>(),
    warn: vi.fn<(event: DiagnosticEvent) => void>(),
  };
}

function firstDiagnostic(calls: Array<[DiagnosticEvent]>): DiagnosticEvent {
  const diagnostic = calls[0]?.[0];

  if (diagnostic === undefined) {
    throw new Error('Expected a diagnostic event.');
  }

  return diagnostic;
}

function createNow(values: readonly number[]): () => number {
  let index = 0;

  return () => {
    const value = values[index];

    if (value === undefined) {
      throw new Error('No timestamp configured for test.');
    }

    index += 1;
    return value;
  };
}

class FakeDocument {
  readonly createdIframes: FakeIframe[] = [];

  createElement(tagName: string): HTMLIFrameElement {
    if (tagName !== 'iframe') {
      throw new Error(`Expected iframe element, received ${tagName}.`);
    }

    const iframe = new FakeIframe();
    this.createdIframes.push(iframe);
    return iframe as unknown as HTMLIFrameElement;
  }
}

class FakeIframe {
  readonly contentWindow = new FakeTargetWindow();
  readonly attributes = new Map<string, string>();
  allow = '';
  allowFullscreen = false;
  className = '';
  id = '';
  loading = '';
  name = '';
  parentNode: FakeContainer | null = null;
  referrerPolicy = '';
  src = '';
  title = '';

  remove(): void {
    this.parentNode?.removeChild(this as unknown as Node);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeContainer {
  readonly children: FakeIframe[] = [];

  appendChild(node: Node): Node {
    const iframe = node as unknown as FakeIframe;
    iframe.parentNode = this;
    this.children.push(iframe);
    return node;
  }

  removeChild(node: Node): Node {
    const iframe = node as unknown as FakeIframe;
    this.children.splice(this.children.indexOf(iframe), 1);
    iframe.parentNode = null;
    return node;
  }

  replaceChildren(...nodes: Node[]): void {
    for (const child of this.children) {
      child.parentNode = null;
    }

    this.children.splice(0, this.children.length);

    for (const node of nodes) {
      const iframe = node as unknown as FakeIframe;
      iframe.parentNode = this;
      this.children.push(iframe);
    }
  }
}

class FakeParentWindow implements BridgeTransportWindowLike {
  readonly #listeners = new Set<(event: BridgeMessageEvent) => void>();
  readonly #messageErrorListeners = new Set<(event: BridgeMessageEvent) => void>();

  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: BridgeMessageEvent) => void,
  ): void {
    if (type === 'message') {
      this.#listeners.add(listener);
      return;
    }

    if (type === 'messageerror') {
      this.#messageErrorListeners.add(listener);
      return;
    }

    throw new Error(`Unexpected listener type: ${type}`);
  }

  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: BridgeMessageEvent) => void,
  ): void {
    if (type === 'message') {
      this.#listeners.delete(listener);
      return;
    }

    if (type === 'messageerror') {
      this.#messageErrorListeners.delete(listener);
      return;
    }

    throw new Error(`Unexpected listener type: ${type}`);
  }

  dispatch(event: BridgeMessageEvent): void {
    for (const listener of Array.from(this.#listeners)) {
      listener(event);
    }
  }

  dispatchMessageError(event: BridgeMessageEvent): void {
    for (const listener of Array.from(this.#messageErrorListeners)) {
      listener(event);
    }
  }
}

class FakeTargetWindow {
  readonly messages: Array<{ readonly message: unknown; readonly targetOrigin: string }> = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.messages.push({ message, targetOrigin });
  }
}

function messageEvent(data: unknown, source: unknown): BridgeMessageEvent {
  return {
    data,
    origin: childOrigin,
    source,
  };
}

function readyEnvelope(): BridgeReadyEnvelope {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:ready',
    version: 1,
  };
}

function eventEnvelope<TPayload>(name: string, payload: TPayload): BridgeEventEnvelope<TPayload> {
  return {
    name,
    payload,
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:event',
    version: 1,
  };
}

function setLocationOrigin(origin: string): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin },
  });
}

function restoreGlobalProperty(
  name: keyof typeof globalThis,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }

  Object.defineProperty(globalThis, name, descriptor);
}

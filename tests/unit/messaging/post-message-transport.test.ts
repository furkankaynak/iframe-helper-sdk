import { describe, expect, test, vi } from 'vitest';

import {
  BridgeTransport,
  type BridgeMessageEvent,
  type BridgeTransportInvalidMessage,
  type BridgeTransportTargetWindowLike,
  type BridgeTransportWindowLike,
} from '../../../src/messaging/post-message-transport';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';
import type {
  BridgeConnectedEnvelope,
  BridgeEventEnvelope,
  BridgeReadyEnvelope,
  BridgeRequestEnvelope,
  BridgeResponseEnvelope,
} from '../../../src/types';

const expectedOrigin = 'https://child.example';
const targetOrigin = 'https://child.example';
const sessionId = 'session-1';

describe('BridgeTransport', () => {
  test('posts envelopes to the target window with the exact target origin', () => {
    const { targetWindow, transport } = createTransport();
    const envelope = connectedEnvelope();

    transport.post(envelope);

    expect(targetWindow.messages).toEqual([{ message: envelope, targetOrigin }]);
  });

  test('rejects wildcard target origins before posting', () => {
    const { targetWindow, transport } = createTransport({ targetOrigin: '*' });
    const error = expectBridgeThrow(
      () => transport.post(connectedEnvelope()),
      'MESSAGE_TARGET_MISMATCH',
    );

    expect(error.details).toEqual({ targetOrigin: '*' });
    expect(targetWindow.messages).toEqual([]);
  });

  test('starts and stops the configured message listener without a global window', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();
    const firstReady = readyEnvelope();
    const lateReady = readyEnvelope();

    transport.start();
    transport.start();

    expect(parentWindow.listenerCount).toBe(1);

    parentWindow.dispatch(messageEvent(firstReady, sourceWindow));

    expect(callbacks.onReady).toHaveBeenCalledOnce();
    expect(callbacks.onReady).toHaveBeenCalledWith(firstReady);

    transport.stop();
    transport.stop();

    expect(parentWindow.listenerCount).toBe(0);

    parentWindow.dispatch(messageEvent(lateReady, sourceWindow));

    expect(callbacks.onReady).toHaveBeenCalledOnce();
  });

  test('starts and stops messageerror listener and reports deserialization failures', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();

    transport.start();

    expect(parentWindow.listenerCount).toBe(1);
    expect(parentWindow.messageErrorListenerCount).toBe(1);

    parentWindow.dispatchMessageError(messageErrorEvent(sourceWindow));

    expect(callbacks.onInvalidMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        actualOrigin: expectedOrigin,
        code: 'message_error',
        originMatches: true,
        reason: 'message_error',
        sourceMatches: true,
      }),
    );

    const diagnostic = firstInvalidMessage(callbacks);

    expect('event' in diagnostic).toBe(false);
    expect(JSON.stringify(diagnostic)).not.toContain('do-not-log');

    transport.stop();

    expect(parentWindow.listenerCount).toBe(0);
    expect(parentWindow.messageErrorListenerCount).toBe(0);

    callbacks.onInvalidMessage.mockClear();
    parentWindow.dispatchMessageError(messageErrorEvent(sourceWindow));

    expect(callbacks.onInvalidMessage).not.toHaveBeenCalled();
  });

  test('routes ready, event, request, and response envelopes for the configured session', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();
    const ready = readyEnvelope();
    const event = eventEnvelope();
    const request = requestEnvelope();
    const response = responseEnvelope();

    transport.start();

    parentWindow.dispatch(messageEvent(ready, sourceWindow));
    parentWindow.dispatch(messageEvent(event, sourceWindow));
    parentWindow.dispatch(messageEvent(request, sourceWindow));
    parentWindow.dispatch(messageEvent(response, sourceWindow));

    expect(callbacks.onReady).toHaveBeenCalledWith(ready);
    expect(callbacks.onEvent).toHaveBeenCalledWith(event);
    expect(callbacks.onRequest).toHaveBeenCalledWith(request);
    expect(callbacks.onResponse).toHaveBeenCalledWith(response);
    expect(callbacks.onInvalidMessage).not.toHaveBeenCalled();
  });

  test('rejects origin mismatches before reading message data', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();

    transport.start();

    expect(() =>
      parentWindow.dispatch(unreadableDataEvent('https://attacker.example', sourceWindow)),
    ).not.toThrow();

    expect(callbacks.onInvalidMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        actualOrigin: 'https://attacker.example',
        code: 'origin_mismatch',
        expectedOrigin,
        reason: 'origin_mismatch',
      }),
    );
    expectNoRoutedMessages(callbacks);
  });

  test('rejects source mismatches before reading message data', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();
    const unexpectedSource = new FakeTargetWindow();

    transport.start();

    expect(() =>
      parentWindow.dispatch(unreadableDataEvent(expectedOrigin, unexpectedSource)),
    ).not.toThrow();

    expect(callbacks.onInvalidMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        actualSource: unexpectedSource,
        code: 'source_mismatch',
        expectedSource: sourceWindow,
        reason: 'source_mismatch',
      }),
    );
    expectNoRoutedMessages(callbacks);
  });

  test('rejects session mismatches after envelope validation', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();
    const envelope = readyEnvelope({ sessionId: 'other-session' });

    transport.start();

    parentWindow.dispatch(messageEvent(envelope, sourceWindow));

    expect(callbacks.onInvalidMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        actualSessionId: 'other-session',
        code: 'session_mismatch',
        envelope,
        expectedSessionId: sessionId,
        reason: 'session_mismatch',
      }),
    );
    expectNoRoutedMessages(callbacks);
  });

  test('surfaces invalid envelopes as diagnostics without throwing from the listener', () => {
    const { callbacks, parentWindow, sourceWindow, transport } = createTransport();

    transport.start();

    expect(() =>
      parentWindow.dispatch(
        messageEvent(
          {
            protocol: 'iframe-bridge',
            sessionId,
            type: 'bridge:unknown',
            version: 1,
          },
          sourceWindow,
        ),
      ),
    ).not.toThrow();

    const diagnostic = firstInvalidMessage(callbacks);

    expect(diagnostic).toMatchObject({
      code: 'invalid_envelope',
      reason: 'invalid_envelope',
    });

    if (diagnostic.reason !== 'invalid_envelope') {
      throw new Error(`Expected invalid_envelope diagnostic, received ${diagnostic.reason}`);
    }

    expect(diagnostic.error).toBeInstanceOf(IframeBridgeError);
    expect(diagnostic.error.code).toBe('MESSAGE_INVALID_ENVELOPE');
    expectNoRoutedMessages(callbacks);
  });
});

type TransportCallbacks = ReturnType<typeof createCallbacks>;

type CreateTransportOptions = {
  readonly expectedOrigin?: string;
  readonly parentWindow?: FakeParentWindow;
  readonly sessionId?: string;
  readonly sourceWindow?: unknown;
  readonly targetOrigin?: string;
  readonly targetWindow?: FakeTargetWindow;
};

class FakeParentWindow implements BridgeTransportWindowLike {
  readonly #listeners = new Set<(event: BridgeMessageEvent) => void>();
  readonly #messageErrorListeners = new Set<(event: BridgeMessageEvent) => void>();

  get listenerCount(): number {
    return this.#listeners.size;
  }

  get messageErrorListenerCount(): number {
    return this.#messageErrorListeners.size;
  }

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

class FakeTargetWindow implements BridgeTransportTargetWindowLike {
  readonly messages: Array<{ readonly message: unknown; readonly targetOrigin: string }> = [];

  postMessage(message: unknown, exactTargetOrigin: string): void {
    this.messages.push({ message, targetOrigin: exactTargetOrigin });
  }
}

function createTransport(options: CreateTransportOptions = {}) {
  const parentWindow = options.parentWindow ?? new FakeParentWindow();
  const targetWindow = options.targetWindow ?? new FakeTargetWindow();
  const sourceWindow = options.sourceWindow ?? targetWindow;
  const callbacks = createCallbacks();
  const transport = new BridgeTransport({
    expectedOrigin: options.expectedOrigin ?? expectedOrigin,
    onEvent: callbacks.onEvent,
    onInvalidMessage: callbacks.onInvalidMessage,
    onReady: callbacks.onReady,
    onRequest: callbacks.onRequest,
    onResponse: callbacks.onResponse,
    parentWindow,
    sessionId: options.sessionId ?? sessionId,
    sourceWindow,
    targetOrigin: options.targetOrigin ?? targetOrigin,
    targetWindow,
  });

  return { callbacks, parentWindow, sourceWindow, targetWindow, transport };
}

function createCallbacks() {
  return {
    onEvent: vi.fn<(envelope: BridgeEventEnvelope) => void>(),
    onInvalidMessage: vi.fn<(message: BridgeTransportInvalidMessage) => void>(),
    onReady: vi.fn<(envelope: BridgeReadyEnvelope) => void>(),
    onRequest: vi.fn<(envelope: BridgeRequestEnvelope) => void>(),
    onResponse: vi.fn<(envelope: BridgeResponseEnvelope) => void>(),
  };
}

function connectedEnvelope(): BridgeConnectedEnvelope {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:connected',
    version: 1,
  };
}

function readyEnvelope(overrides: Partial<BridgeReadyEnvelope> = {}): BridgeReadyEnvelope {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:ready',
    version: 1,
    ...overrides,
  };
}

function eventEnvelope(): BridgeEventEnvelope {
  return {
    name: 'child:event',
    payload: { ok: true },
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:event',
    version: 1,
  };
}

function requestEnvelope(): BridgeRequestEnvelope {
  return {
    name: 'child:method',
    payload: { value: 1 },
    protocol: 'iframe-bridge',
    requestId: 'request-1',
    sessionId,
    type: 'bridge:request',
    version: 1,
  };
}

function responseEnvelope(): BridgeResponseEnvelope {
  return {
    payload: { ok: true },
    protocol: 'iframe-bridge',
    requestId: 'request-1',
    sessionId,
    type: 'bridge:response',
    version: 1,
  };
}

function messageEvent(data: unknown, source: unknown, origin = expectedOrigin): BridgeMessageEvent {
  return { data, origin, source };
}

function messageErrorEvent(source: unknown, origin = expectedOrigin): BridgeMessageEvent {
  return { data: { secret: 'do-not-log' }, origin, source };
}

function unreadableDataEvent(origin: string, source: unknown): BridgeMessageEvent {
  return {
    get data(): unknown {
      throw new Error('Message data should not be read.');
    },
    origin,
    source,
  };
}

function expectNoRoutedMessages(callbacks: TransportCallbacks): void {
  expect(callbacks.onEvent).not.toHaveBeenCalled();
  expect(callbacks.onReady).not.toHaveBeenCalled();
  expect(callbacks.onRequest).not.toHaveBeenCalled();
  expect(callbacks.onResponse).not.toHaveBeenCalled();
}

function firstInvalidMessage(callbacks: TransportCallbacks): BridgeTransportInvalidMessage {
  const call = callbacks.onInvalidMessage.mock.calls[0];

  if (call === undefined) {
    throw new Error('Expected onInvalidMessage to be called.');
  }

  const diagnostic = call[0];

  if (diagnostic === undefined) {
    throw new Error('Expected onInvalidMessage diagnostic.');
  }

  return diagnostic;
}

function expectBridgeThrow(run: () => unknown, code: IframeBridgeErrorCode): IframeBridgeError {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
    return error as IframeBridgeError;
  }

  throw new Error(`Expected ${code}`);
}

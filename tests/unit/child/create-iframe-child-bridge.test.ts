import { afterEach, describe, expect, test, vi } from 'vitest';

import { createIframeChildBridge } from '../../../src/child/create-iframe-child-bridge';
import type { ChildBridgeWindowLike } from '../../../src/child/child-dependencies';
import type { BridgeMessageEvent } from '../../../src/messaging/post-message-transport';
import type {
  BridgeConnectedEnvelope,
  BridgeEventEnvelope,
  BridgeRequestEnvelope,
} from '../../../src/types';

const parentOrigin = 'https://parent.example';
const sessionId = 'session-1';

afterEach(() => {
  vi.useRealTimers();
});

describe('createIframeChildBridge', () => {
  test('sends bridge:ready to the exact parent origin on creation', () => {
    const { bridge, parentWindow } = createBridge();

    expect(bridge.state).toBe('connecting');
    expect(parentWindow.messages).toEqual([
      {
        message: {
          protocol: 'iframe-bridge',
          sessionId,
          type: 'bridge:ready',
          version: 1,
        },
        targetOrigin: parentOrigin,
      },
    ]);
  });

  test('resolves whenConnected after a valid bridge:connected message', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();
    const connected = bridge.whenConnected();

    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));

    await expect(connected).resolves.toBeUndefined();
    expect(bridge.state).toBe('connected');
  });

  test('dispatches parent events to matching child listeners after connection', () => {
    const { bridge, childWindow, parentWindow } = createBridge();
    const themeHandler = vi.fn<(payload: { readonly theme: string } | undefined) => void>();
    const otherHandler = vi.fn<(payload: unknown) => void>();

    const unsubscribe = bridge.on<{ readonly theme: string }>('theme:changed', themeHandler);
    bridge.on('other:event', otherHandler);

    childWindow.dispatch(
      messageEvent(eventEnvelope('theme:changed', { theme: 'dark' }), parentWindow),
    );
    expect(themeHandler).not.toHaveBeenCalled();

    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    childWindow.dispatch(
      messageEvent(eventEnvelope('theme:changed', { theme: 'light' }), parentWindow),
    );

    expect(themeHandler).toHaveBeenCalledWith({ theme: 'light' });
    expect(otherHandler).not.toHaveBeenCalled();

    unsubscribe();
    unsubscribe();
    childWindow.dispatch(
      messageEvent(eventEnvelope('theme:changed', { theme: 'dark' }), parentWindow),
    );

    expect(themeHandler).toHaveBeenCalledTimes(1);
  });

  test('reports child event listener errors without blocking other listeners', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const { bridge, childWindow, parentWindow } = createBridge({
      diagnostics: { logger: { error, warn } },
    });
    const throwingHandler = vi.fn(() => {
      throw new Error('listener failed');
    });
    const nextHandler = vi.fn<(payload: { readonly ok: boolean } | undefined) => void>();

    bridge.on('app:event', throwingHandler);
    bridge.on<{ readonly ok: boolean }>('app:event', nextHandler);
    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    childWindow.dispatch(messageEvent(eventEnvelope('app:event', { ok: true }), parentWindow));

    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(nextHandler).toHaveBeenCalledWith({ ok: true });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EVENT_LISTENER_ERROR',
        details: { errorName: 'Error', name: 'app:event' },
        level: 'error',
        sessionId,
      }),
    );
  });

  test('responds to parent requests registered with handleRequest', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();
    const handler = vi.fn((payload: { readonly userId: string } | undefined) => ({
      displayName: `User ${payload?.userId}`,
    }));

    const unregister = bridge.handleRequest('user:get', handler);
    childWindow.dispatch(
      messageEvent(requestEnvelope('user:get', 'request-1', { userId: '1' }), parentWindow),
    );
    expect(handler).not.toHaveBeenCalled();

    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    childWindow.dispatch(
      messageEvent(requestEnvelope('user:get', 'request-1', { userId: '1' }), parentWindow),
    );
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({ userId: '1' });
    expect(parentWindow.messages.at(-1)).toEqual({
      message: {
        payload: { displayName: 'User 1' },
        protocol: 'iframe-bridge',
        requestId: 'request-1',
        sessionId,
        type: 'bridge:response',
        version: 1,
      },
      targetOrigin: parentOrigin,
    });

    unregister();
    childWindow.dispatch(
      messageEvent(requestEnvelope('user:get', 'request-2', { userId: '2' }), parentWindow),
    );
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(parentWindow.messages.at(-1)).toMatchObject({
      message: {
        error: { code: 'REQUEST_HANDLER_NOT_FOUND' },
        requestId: 'request-2',
        type: 'bridge:response',
      },
    });
  });

  test('keeps child request handlers registered until cleanup is called', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();
    const handler = vi.fn((payload: { readonly userId: string } | undefined) => ({
      displayName: `User ${payload?.userId}`,
    }));

    bridge.handleRequest('user:get', handler);
    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));

    childWindow.dispatch(
      messageEvent(requestEnvelope('user:get', 'request-1', { userId: '1' }), parentWindow),
    );
    await Promise.resolve();

    childWindow.dispatch(
      messageEvent(requestEnvelope('user:get', 'request-2', { userId: '2' }), parentWindow),
    );
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(parentWindow.messages.slice(-2)).toEqual([
      {
        message: {
          payload: { displayName: 'User 1' },
          protocol: 'iframe-bridge',
          requestId: 'request-1',
          sessionId,
          type: 'bridge:response',
          version: 1,
        },
        targetOrigin: parentOrigin,
      },
      {
        message: {
          payload: { displayName: 'User 2' },
          protocol: 'iframe-bridge',
          requestId: 'request-2',
          sessionId,
          type: 'bridge:response',
          version: 1,
        },
        targetOrigin: parentOrigin,
      },
    ]);
  });

  test('responds with sanitized request errors for failed child handlers', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();

    bridge.handleRequest('user:get', async () => {
      throw new Error('User lookup failed');
    });
    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    childWindow.dispatch(messageEvent(requestEnvelope('user:get', 'request-1'), parentWindow));
    await Promise.resolve();
    await Promise.resolve();

    expect(parentWindow.messages.at(-1)).toEqual({
      message: {
        error: {
          code: 'REQUEST_HANDLER_ERROR',
          message: 'Child request handler failed.',
        },
        protocol: 'iframe-bridge',
        requestId: 'request-1',
        sessionId,
        type: 'bridge:response',
        version: 1,
      },
      targetOrigin: parentOrigin,
    });
    expect(JSON.stringify(parentWindow.messages.at(-1))).not.toContain('stack');
    expect(JSON.stringify(parentWindow.messages.at(-1))).not.toContain('User lookup failed');
  });

  test('does not post an async child request response after destroy', async () => {
    let resolveRequest: ((value: { readonly ok: true }) => void) | undefined;
    const { bridge, childWindow, parentWindow } = createBridge();

    bridge.handleRequest(
      'slow:get',
      () =>
        new Promise<{ readonly ok: true }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    childWindow.dispatch(messageEvent(requestEnvelope('slow:get', 'request-1'), parentWindow));

    bridge.destroy();
    resolveRequest?.({ ok: true });
    await Promise.resolve();

    expect(parentWindow.messages.map((message) => message.message)).toEqual([
      {
        protocol: 'iframe-bridge',
        sessionId,
        type: 'bridge:ready',
        version: 1,
      },
    ]);
  });

  test('rejects child sendEvent with an aborted signal before posting', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();
    const controller = new AbortController();

    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    controller.abort();

    await expect(
      bridge.sendEvent('child:event', { ok: true }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
    expect(parentWindow.messages).toEqual([
      {
        message: {
          protocol: 'iframe-bridge',
          sessionId,
          type: 'bridge:ready',
          version: 1,
        },
        targetOrigin: parentOrigin,
      },
    ]);
  });

  test('ignores wrong origin, wrong source, wrong session, and malformed envelopes', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();
    let connected = false;
    const connectedPromise = bridge.whenConnected().then(() => {
      connected = true;
    });

    childWindow.dispatch(
      messageEvent(connectedEnvelope(), parentWindow, 'https://attacker.example'),
    );
    childWindow.dispatch(messageEvent(connectedEnvelope(), new FakeParentWindow()));
    childWindow.dispatch(
      messageEvent(connectedEnvelope({ sessionId: 'other-session' }), parentWindow),
    );
    childWindow.dispatch(messageEvent({ protocol: 'iframe-bridge' }, parentWindow));
    await Promise.resolve();

    expect(connected).toBe(false);

    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));

    await expect(connectedPromise).resolves.toBeUndefined();
    expect(bridge.state).toBe('connected');
  });

  test('transitions to connection_failed when the connection times out', async () => {
    vi.useFakeTimers();
    const { bridge } = createBridge();
    const connected = bridge.whenConnected();

    vi.advanceTimersByTime(10000);

    await expect(connected).rejects.toMatchObject({ code: 'HANDSHAKE_TIMEOUT' });
    expect(bridge.state).toBe('connection_failed');
  });

  test('destroy removes listeners and rejects future sends', async () => {
    const { bridge, childWindow, parentWindow } = createBridge();

    expect(childWindow.listenerCount).toBe(1);

    bridge.destroy();
    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));

    expect(bridge.state).toBe('destroyed');
    expect(childWindow.listenerCount).toBe(0);
    await expect(bridge.whenConnected()).rejects.toMatchObject({ code: 'BRIDGE_DESTROYED' });
    await expect(bridge.sendEvent('child:event', { ok: true })).rejects.toMatchObject({
      code: 'BRIDGE_DESTROYED',
    });
  });
});

class FakeChildWindow implements ChildBridgeWindowLike {
  readonly #listeners = new Set<(event: BridgeMessageEvent) => void>();
  readonly #messageErrorListeners = new Set<(event: BridgeMessageEvent) => void>();

  get listenerCount(): number {
    return this.#listeners.size;
  }

  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: BridgeMessageEvent) => void,
  ): void {
    if (type === 'message') {
      this.#listeners.add(listener);
      return;
    }

    this.#messageErrorListeners.add(listener);
  }

  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: BridgeMessageEvent) => void,
  ): void {
    if (type === 'message') {
      this.#listeners.delete(listener);
      return;
    }

    this.#messageErrorListeners.delete(listener);
  }

  dispatch(event: BridgeMessageEvent): void {
    for (const listener of Array.from(this.#listeners)) {
      listener(event);
    }
  }
}

class FakeParentWindow {
  readonly messages: Array<{ readonly message: unknown; readonly targetOrigin: string }> = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.messages.push({ message, targetOrigin });
  }
}

function createBridge(config: Parameters<typeof createIframeChildBridge>[0] = {}) {
  const childWindow = new FakeChildWindow();
  const parentWindow = new FakeParentWindow();
  const bridge = createIframeChildBridge(config, {
    childWindow,
    clearTimeout: (timer) => clearTimeout(timer),
    location: locationFromHref(
      `https://child.example/app?__iframeBridgeSessionId=${sessionId}&__iframeBridgeParentOrigin=${encodeURIComponent(parentOrigin)}`,
    ),
    parentWindow,
    setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
  });

  return { bridge, childWindow, parentWindow };
}

function locationFromHref(href: string): Location {
  const url = new URL(href);

  return {
    hash: url.hash,
    href: url.href,
    search: url.search,
  } as Location;
}

function connectedEnvelope(
  overrides: Partial<BridgeConnectedEnvelope> = {},
): BridgeConnectedEnvelope {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:connected',
    version: 1,
    ...overrides,
  };
}

function eventEnvelope<TPayload>(name: string, payload?: TPayload): BridgeEventEnvelope<TPayload> {
  return {
    ...(payload === undefined ? {} : { payload }),
    name,
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:event',
    version: 1,
  };
}

function requestEnvelope<TPayload>(
  name: string,
  requestId: string,
  payload?: TPayload,
): BridgeRequestEnvelope<TPayload> {
  return {
    ...(payload === undefined ? {} : { payload }),
    name,
    protocol: 'iframe-bridge',
    requestId,
    sessionId,
    type: 'bridge:request',
    version: 1,
  };
}

function messageEvent(data: unknown, source: unknown, origin = parentOrigin): BridgeMessageEvent {
  return { data, origin, source };
}

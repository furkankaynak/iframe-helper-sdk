import { afterEach, describe, expect, test, vi } from 'vitest';

import { createIframeChildBridge } from '../../../src/child/create-iframe-child-bridge';
import type { ChildBridgeWindowLike } from '../../../src/child/child-dependencies';
import type { BridgeMessageEvent } from '../../../src/messaging/post-message-transport';
import type { BridgeConnectedEnvelope } from '../../../src/types';

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

function createBridge() {
  const childWindow = new FakeChildWindow();
  const parentWindow = new FakeParentWindow();
  const bridge = createIframeChildBridge(
    {},
    {
      childWindow,
      clearTimeout: (timer) => clearTimeout(timer),
      location: locationFromHref(
        `https://child.example/app?__iframeBridgeSessionId=${sessionId}&__iframeBridgeParentOrigin=${encodeURIComponent(parentOrigin)}`,
      ),
      parentWindow,
      setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    },
  );

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

function messageEvent(data: unknown, source: unknown, origin = parentOrigin): BridgeMessageEvent {
  return { data, origin, source };
}

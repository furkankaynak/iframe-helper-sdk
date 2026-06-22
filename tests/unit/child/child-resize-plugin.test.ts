import { afterEach, describe, expect, test } from 'vitest';

import { childResizePlugin } from '../../../src/child/resize';
import { createIframeChildBridge } from '../../../src/child/create-iframe-child-bridge';
import type { ChildBridgeWindowLike } from '../../../src/child/child-dependencies';
import type { BridgeMessageEvent } from '../../../src/messaging/post-message-transport';
import type { BridgeConnectedEnvelope } from '../../../src/types';

const parentOrigin = 'https://parent.example';
const sessionId = 'session-resize';
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ResizeObserver',
);

afterEach(() => {
  restoreGlobalProperty('document', originalDocumentDescriptor);
  restoreGlobalProperty('ResizeObserver', originalResizeObserverDescriptor);
});

describe('childResizePlugin', () => {
  test('sends an initial resize event after the child bridge connects', async () => {
    setDocumentSize(320, 240);
    restoreGlobalProperty('ResizeObserver', undefined);
    const { childWindow, parentWindow } = createBridgeWithResizePlugin();

    childWindow.dispatch(messageEvent(connectedEnvelope(), parentWindow));
    await Promise.resolve();

    expect(parentWindow.messages).toContainEqual({
      message: {
        name: 'iframe-bridge:resize',
        payload: { height: 240, width: 320 },
        protocol: 'iframe-bridge',
        sessionId,
        type: 'bridge:event',
        version: 1,
      },
      targetOrigin: parentOrigin,
    });
  });
});

class FakeChildWindow implements ChildBridgeWindowLike {
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

function createBridgeWithResizePlugin() {
  const childWindow = new FakeChildWindow();
  const parentWindow = new FakeParentWindow();
  const bridge = createIframeChildBridge(
    {},
    {
      childWindow,
      location: locationFromHref(
        `https://child.example/app?__iframeBridgeSessionId=${sessionId}&__iframeBridgeParentOrigin=${encodeURIComponent(parentOrigin)}`,
      ),
      parentWindow,
    },
    { plugins: [childResizePlugin({ axis: 'both' })] },
  );

  return { bridge, childWindow, parentWindow };
}

function setDocumentSize(width: number, height: number): void {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        getBoundingClientRect: () => ({ height, width }),
      },
    },
  });
}

function restoreGlobalProperty(
  property: 'document' | 'ResizeObserver',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, property);
    return;
  }

  Object.defineProperty(globalThis, property, descriptor);
}

function locationFromHref(href: string): Location {
  const url = new URL(href);

  return {
    hash: url.hash,
    href: url.href,
    search: url.search,
  } as Location;
}

function connectedEnvelope(): BridgeConnectedEnvelope {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:connected',
    version: 1,
  };
}

function messageEvent(data: unknown, source: unknown): BridgeMessageEvent {
  return { data, origin: parentOrigin, source };
}

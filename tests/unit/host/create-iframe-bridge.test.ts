import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createIframeBridge,
  type BridgeLifecycleQueue,
  type BridgeLifecycleTransport,
} from '../../../src/host/create-iframe-bridge';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';
import type {
  BridgeMessageEvent,
  BridgeTransportOptions,
  BridgeTransportWindowLike,
} from '../../../src/messaging/post-message-transport';
import type { BridgeEnvelope, BridgeReadyEnvelope } from '../../../src/types';

const parentOrigin = 'https://host.example';
const childOrigin = 'https://child.example';
const sessionId = 'session-1';

const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

afterEach(() => {
  vi.useRealTimers();
  restoreGlobalProperty('location', originalLocationDescriptor);
});

describe('createIframeBridge', () => {
  test('creates and mounts an iframe after installing the listener, then accepts ready first', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    expect(harness.bridge.state).toBe('waiting_for_handshake');
    expect(harness.document.createdIframes).toEqual([harness.iframe]);
    expect(harness.container.children).toEqual([harness.iframe]);
    expect(harness.events.indexOf('transport:start')).toBeLessThan(
      harness.events.indexOf('container:append'),
    );
    expect(harness.iframe.src).toBe(
      'https://child.example/app?__iframeBridgeSessionId=session-1&__iframeBridgeParentOrigin=https%3A%2F%2Fhost.example',
    );
    expect(harness.transport.options).toMatchObject({
      expectedOrigin: childOrigin,
      sessionId,
      targetOrigin: childOrigin,
    });
    expect(resolveSourceWindow(harness.transport.options)).toBe(harness.iframe.contentWindow);
    expect(resolveTargetWindow(harness.transport.options)).toBe(harness.iframe.contentWindow);
    expect(harness.queue.flushCalls).toBe(0);

    harness.transport.ready();

    expect(harness.bridge.state).toBe('ready');
    expect(harness.transport.posts).toEqual([
      {
        protocol: 'iframe-bridge',
        sessionId,
        type: 'bridge:connected',
        version: 1,
      },
    ]);
    expect(harness.queue.flushCalls).toBe(1);
    expect(harness.queue.closeErrors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('mounts when iframe contentWindow is only available after append', () => {
    vi.useFakeTimers();
    const harness = createHarness({ contentWindowBeforeAppend: false });

    expect(harness.bridge.state).toBe('waiting_for_handshake');
    expect(harness.events.indexOf('transport:start')).toBeLessThan(
      harness.events.indexOf('container:append'),
    );
    expect(resolveSourceWindow(harness.transport.options)).toBe(
      harness.iframe.mountedContentWindow,
    );
    expect(resolveTargetWindow(harness.transport.options)).toBe(
      harness.iframe.mountedContentWindow,
    );

    harness.transport.ready();

    expect(harness.bridge.state).toBe('ready');
    expect(harness.transport.posts).toHaveLength(1);
    expect(harness.queue.flushCalls).toBe(1);
  });

  test('routes ready through the real transport using the mounted iframe window as source', () => {
    vi.useFakeTimers();
    const harness = createRealTransportHarness({ contentWindowBeforeAppend: false });
    const childWindow = harness.iframe.mountedContentWindow;

    expect(harness.bridge.state).toBe('waiting_for_handshake');
    expect(harness.events.indexOf('parent:add')).toBeLessThan(
      harness.events.indexOf('container:append'),
    );

    harness.parentWindow.dispatch(messageEvent(readyEnvelope(), new FakeTargetWindow()));
    harness.parentWindow.dispatch(
      messageEvent(readyEnvelope(), childWindow, 'https://attacker.example'),
    );
    harness.parentWindow.dispatch(
      messageEvent(readyEnvelope({ sessionId: 'other-session' }), childWindow),
    );
    harness.parentWindow.dispatch(
      messageEvent({ ...readyEnvelope(), protocol: 'other-protocol' }, childWindow),
    );
    harness.parentWindow.dispatch(messageEvent({ ...readyEnvelope(), version: 2 }, childWindow));

    expect(harness.bridge.state).toBe('waiting_for_handshake');
    expect(childWindow.messages).toEqual([]);
    expect(harness.queue.flushCalls).toBe(0);

    harness.parentWindow.dispatch(messageEvent(readyEnvelope(), childWindow));

    expect(harness.bridge.state).toBe('ready');
    expect(childWindow.messages).toEqual([
      {
        message: {
          protocol: 'iframe-bridge',
          sessionId,
          type: 'bridge:connected',
          version: 1,
        },
        targetOrigin: childOrigin,
      },
    ]);
    expect(harness.queue.flushCalls).toBe(1);
  });

  test('ignores duplicate ready without duplicating connected messages or queue flushes', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.transport.ready();
    harness.transport.ready();

    expect(harness.bridge.state).toBe('ready');
    expect(harness.transport.posts).toHaveLength(1);
    expect(harness.transport.posts[0]?.type).toBe('bridge:connected');
    expect(harness.queue.flushCalls).toBe(1);
    expect(harness.queue.closeErrors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('resolves whenReady after accepting the first valid ready message', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    let resolved = false;

    const ready = harness.bridge.whenReady();
    ready.then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(resolved).toBe(false);

    harness.transport.ready();

    await expect(ready).resolves.toBeUndefined();
    expect(resolved).toBe(true);
  });

  test('resolves whenReady immediately after the bridge is ready', async () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.transport.ready();

    await expect(harness.bridge.whenReady()).resolves.toBeUndefined();
  });

  test('rejects whenReady when the handshake times out', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ handshakeTimeoutMs: 10 });
    const rejection = expectBridgeRejection(harness.bridge.whenReady(), 'HANDSHAKE_TIMEOUT');

    await vi.advanceTimersByTimeAsync(10);

    await rejection;
  });

  test('rejects whenReady when the bridge is destroyed before ready', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const rejection = expectBridgeRejection(harness.bridge.whenReady(), 'BRIDGE_DESTROYED');

    harness.bridge.destroy();

    await rejection;
  });

  test('transitions to handshake_failed on timeout and closes the pre-ready queue', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ handshakeTimeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(24);

    expect(harness.bridge.state).toBe('waiting_for_handshake');
    expect(harness.queue.closeErrors).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(harness.bridge.state).toBe('handshake_failed');
    expect(harness.transport.stopCalls).toBe(1);
    expect(harness.transport.posts).toEqual([]);
    expect(harness.queue.flushCalls).toBe(0);
    expect(harness.queue.closeErrors).toHaveLength(1);
    expectBridgeError(harness.queue.closeErrors[0], 'HANDSHAKE_TIMEOUT');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('ignores late ready after handshake timeout', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ handshakeTimeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    harness.transport.ready();

    expect(harness.bridge.state).toBe('handshake_failed');
    expect(harness.transport.posts).toEqual([]);
    expect(harness.queue.flushCalls).toBe(0);
    expect(harness.queue.closeErrors).toHaveLength(1);
  });

  test('destroy stops transport, clears timeout, closes queue, detaches iframe, and is idempotent', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.bridge.destroy();
    harness.bridge.destroy();
    harness.transport.ready();

    expect(harness.bridge.state).toBe('destroyed');
    expect(harness.transport.stopCalls).toBe(1);
    expect(harness.transport.posts).toEqual([]);
    expect(harness.queue.flushCalls).toBe(0);
    expect(harness.queue.closeErrors).toHaveLength(1);
    expectBridgeError(harness.queue.closeErrors[0], 'BRIDGE_DESTROYED');
    expect(harness.container.children).toEqual([]);
    expect(harness.events.filter((event) => event === 'container:remove')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('remount destroys the current bridge and returns a fresh bridge instance', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    const nextBridge = harness.bridge.remount();

    expect(harness.bridge.state).toBe('destroyed');
    expect(nextBridge.state).toBe('waiting_for_handshake');
    expect(nextBridge).not.toBe(harness.bridge);
    expect(harness.transport.stopCalls).toBe(1);
    expect(harness.document.createdIframes).toHaveLength(2);
    expect(harness.container.children).toEqual([harness.document.createdIframes[1]]);
    expect(harness.events.filter((event) => event === 'transport:start')).toHaveLength(2);
    expect(harness.events.filter((event) => event === 'container:append')).toHaveLength(2);
  });

  test('does not remount automatically after handshake timeout', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ handshakeTimeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);

    expect(harness.bridge.state).toBe('handshake_failed');
    expect(harness.document.createdIframes).toHaveLength(1);
    expect(harness.container.children).toEqual([harness.iframe]);

    const nextBridge = harness.bridge.remount();

    expect(nextBridge.state).toBe('waiting_for_handshake');
    expect(harness.document.createdIframes).toHaveLength(2);
    expect(harness.container.children).toEqual([harness.document.createdIframes[1]]);
  });

  test('cleans up listener, timer, and queue when mounting fails', () => {
    vi.useFakeTimers();
    setLocationOrigin(parentOrigin);

    const events: string[] = [];
    const container = new FailingContainer(events);
    const document = new FakeDocument({ contentWindowBeforeAppend: true });
    const parentWindow = new FakeParentWindow(events);
    const queue = new FakeQueue();
    let transport: FakeTransport | undefined;

    expect(() =>
      createIframeBridge(
        {
          bootstrap: {
            session: {
              paramValue: sessionId,
            },
          },
          container: container as unknown as Element,
          src: 'https://child.example/app',
        },
        {
          document: document as unknown as Document,
          parentWindow,
          queueFactory: () => queue,
          transportFactory: (transportOptions) => {
            transport = new FakeTransport(transportOptions, events);
            return transport;
          },
        },
      ),
    ).toThrow(IframeBridgeError);

    expect(events).toContain('transport:start');
    expect(transport?.stopCalls).toBe(1);
    expect(queue.closeErrors).toHaveLength(1);
    expectBridgeError(queue.closeErrors[0], 'CONFIG_INVALID_CONTAINER');
    expect(vi.getTimerCount()).toBe(0);
  });
});

type CreateHarnessOptions = {
  readonly contentWindowBeforeAppend?: boolean;
  readonly handshakeTimeoutMs?: number;
};

function createHarness(options: CreateHarnessOptions = {}) {
  setLocationOrigin(parentOrigin);

  const events: string[] = [];
  const container = new FakeContainer(events);
  const document = new FakeDocument({
    contentWindowBeforeAppend: options.contentWindowBeforeAppend ?? true,
  });
  const parentWindow = new FakeParentWindow(events);
  const queue = new FakeQueue();
  let transport: FakeTransport | undefined;

  const bridge = createIframeBridge(
    {
      bootstrap: {
        ...(options.handshakeTimeoutMs === undefined
          ? {}
          : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
        session: {
          paramValue: sessionId,
        },
      },
      container: container as unknown as Element,
      iframeAttributes: {
        title: 'Embedded child',
      },
      src: 'https://child.example/app',
    },
    {
      document: document as unknown as Document,
      parentWindow,
      queueFactory: () => queue,
      transportFactory: (transportOptions) => {
        transport = new FakeTransport(transportOptions, events);
        return transport;
      },
    },
  );

  if (transport === undefined) {
    throw new Error('Expected bridge to create a transport.');
  }

  const iframe = document.createdIframes[0];

  if (iframe === undefined) {
    throw new Error('Expected bridge to create an iframe.');
  }

  return { bridge, container, document, events, iframe, parentWindow, queue, transport };
}

function createRealTransportHarness(options: CreateHarnessOptions = {}) {
  setLocationOrigin(parentOrigin);

  const events: string[] = [];
  const container = new FakeContainer(events);
  const document = new FakeDocument({
    contentWindowBeforeAppend: options.contentWindowBeforeAppend ?? true,
  });
  const parentWindow = new FakeParentWindow(events);
  const queue = new FakeQueue();

  const bridge = createIframeBridge(
    {
      bootstrap: {
        ...(options.handshakeTimeoutMs === undefined
          ? {}
          : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
        session: {
          paramValue: sessionId,
        },
      },
      container: container as unknown as Element,
      src: 'https://child.example/app',
    },
    {
      document: document as unknown as Document,
      parentWindow,
      queueFactory: () => queue,
    },
  );

  const iframe = document.createdIframes[0];

  if (iframe === undefined) {
    throw new Error('Expected bridge to create an iframe.');
  }

  return { bridge, container, document, events, iframe, parentWindow, queue };
}

type FakeDocumentOptions = {
  readonly contentWindowBeforeAppend: boolean;
};

class FakeDocument {
  readonly createdIframes: FakeIframe[] = [];

  constructor(private readonly options: FakeDocumentOptions) {}

  createElement(tagName: string): HTMLIFrameElement {
    if (tagName !== 'iframe') {
      throw new Error(`Expected iframe element, received ${tagName}.`);
    }

    const iframe = new FakeIframe({
      contentWindowBeforeAppend: this.options.contentWindowBeforeAppend,
    });
    this.createdIframes.push(iframe);
    return iframe as unknown as HTMLIFrameElement;
  }
}

type FakeIframeOptions = {
  readonly contentWindowBeforeAppend: boolean;
};

class FakeIframe {
  readonly #contentWindow = new FakeTargetWindow();
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

  constructor(private readonly options: FakeIframeOptions) {}

  get contentWindow(): FakeTargetWindow | null {
    if (!this.options.contentWindowBeforeAppend && this.parentNode === null) {
      return null;
    }

    return this.#contentWindow;
  }

  get mountedContentWindow(): FakeTargetWindow {
    return this.#contentWindow;
  }

  remove(): void {
    this.parentNode?.removeChild(this as unknown as Node);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeContainer {
  readonly children: FakeIframe[] = [];

  constructor(private readonly events: string[]) {}

  appendChild(node: Node): Node {
    this.events.push('container:append');
    const iframe = node as unknown as FakeIframe;
    iframe.parentNode = this;
    this.children.push(iframe);
    return node;
  }

  removeChild(node: Node): Node {
    this.events.push('container:remove');
    const iframe = node as unknown as FakeIframe;
    this.children.splice(this.children.indexOf(iframe), 1);
    iframe.parentNode = null;
    return node;
  }

  replaceChildren(...nodes: Node[]): void {
    this.events.push('container:replace');
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

class FailingContainer extends FakeContainer {
  override appendChild(): Node {
    throw new Error('append failed');
  }
}

class FakeParentWindow implements BridgeTransportWindowLike {
  readonly #listeners = new Set<(event: BridgeMessageEvent) => void>();
  readonly #messageErrorListeners = new Set<(event: BridgeMessageEvent) => void>();

  constructor(private readonly events: string[]) {}

  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: BridgeMessageEvent) => void,
  ): void {
    this.events.push('parent:add');

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
    this.events.push('parent:remove');

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
}

class FakeTargetWindow {
  readonly messages: Array<{ readonly message: unknown; readonly targetOrigin: string }> = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.messages.push({ message, targetOrigin });
  }
}

class FakeTransport implements BridgeLifecycleTransport {
  readonly posts: BridgeEnvelope[] = [];
  startCalls = 0;
  stopCalls = 0;

  constructor(
    readonly options: BridgeTransportOptions,
    private readonly events: string[],
  ) {}

  post(envelope: BridgeEnvelope): void {
    this.events.push(`transport:post:${envelope.type}`);
    this.posts.push(envelope);
  }

  ready(overrides: Partial<BridgeReadyEnvelope> = {}): void {
    this.options.onReady?.(readyEnvelope(overrides));
  }

  start(): void {
    this.startCalls += 1;
    this.events.push('transport:start');
  }

  stop(): void {
    this.stopCalls += 1;
    this.events.push('transport:stop');
  }
}

class FakeQueue implements BridgeLifecycleQueue {
  readonly closeErrors: unknown[] = [];
  flushCalls = 0;

  close(error?: unknown): void {
    this.closeErrors.push(error);
  }

  flush(): void {
    this.flushCalls += 1;
  }
}

function setLocationOrigin(origin: string): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin },
  });
}

function restoreGlobalProperty(
  property: 'location',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, property, descriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, property);
}

function expectBridgeError(error: unknown, code: IframeBridgeErrorCode): IframeBridgeError {
  expect(error).toBeInstanceOf(IframeBridgeError);
  expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
  return error as IframeBridgeError;
}

async function expectBridgeRejection(
  promise: Promise<unknown>,
  code: IframeBridgeErrorCode,
): Promise<IframeBridgeError> {
  try {
    await promise;
  } catch (error: unknown) {
    return expectBridgeError(error, code);
  }

  throw new Error(`Expected ${code}`);
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

function messageEvent(data: unknown, source: unknown, origin = childOrigin): BridgeMessageEvent {
  return { data, origin, source };
}

function resolveSourceWindow(options: BridgeTransportOptions): unknown {
  if ('resolveSourceWindow' in options && typeof options.resolveSourceWindow === 'function') {
    return options.resolveSourceWindow();
  }

  return options.sourceWindow;
}

function resolveTargetWindow(options: BridgeTransportOptions): unknown {
  if ('resolveTargetWindow' in options && typeof options.resolveTargetWindow === 'function') {
    return options.resolveTargetWindow();
  }

  return options.targetWindow;
}

import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import * as publicApi from '../../src/index';
import { createIframeBridge as createIframeBridgeInternal } from '../../src/host/create-iframe-bridge';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../src/index';
import type {
  BridgeEnvelope,
  BridgeEventEnvelope,
  BridgePlugin,
  BridgePluginContext,
  BridgeReadyEnvelope,
  BridgeRequestEnvelope,
  BridgeResponseEnvelope,
  DiagnosticEvent,
  IframeBridge,
  IframeBridgeConfig,
  IframeBridgeContract,
  IframeBridgeOptions,
  IframeBridgeResizeCallback,
  IframeBridgeResizeAxis,
  IframeBridgeResizeConfig,
  IframeBridgeResizeEvent,
  IframeBridgeResizePayload,
  OperationOptions,
  TypedIframeBridge,
} from '../../src/index';
import type {
  BridgeMessageEvent,
  BridgeTransportWindowLike,
} from '../../src/messaging/post-message-transport';

const parentOrigin = 'https://host.example';
const childOrigin = 'https://child.example';
const sessionId = 'session-public-api';

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

afterEach(() => {
  vi.useRealTimers();
  restoreGlobalProperty('document', originalDocumentDescriptor);
  restoreGlobalProperty('location', originalLocationDescriptor);
});

describe('public bridge API', () => {
  test('exposes typed public bridge methods through the entrypoint', () => {
    type ExpectedRequest = <TPayload = unknown, TResponse = unknown>(
      method: string,
      payload: TPayload,
      options?: OperationOptions,
    ) => Promise<TResponse>;
    type ExpectedSendEvent = <TPayload = unknown>(
      name: string,
      payload: TPayload,
      options?: OperationOptions,
    ) => Promise<void>;
    type ExpectedWaitForEvent = <TPayload = unknown>(
      name: string,
      options?: OperationOptions,
    ) => Promise<TPayload>;
    type ExpectedOn = <TPayload = unknown>(
      name: string,
      handler: (payload: TPayload) => void,
    ) => () => void;
    type ExpectedWhenReady = () => Promise<void>;
    type ExpectedRemount = () => IframeBridge;

    expectTypeOf<
      Parameters<typeof publicApi.createIframeBridge>[0]
    >().toEqualTypeOf<IframeBridgeConfig>();
    expectTypeOf<Parameters<typeof publicApi.createIframeBridge>[1]>().toEqualTypeOf<
      IframeBridgeOptions | undefined
    >();
    expectTypeOf<IframeBridge['request']>().toEqualTypeOf<ExpectedRequest>();
    expectTypeOf<IframeBridge['sendEvent']>().toEqualTypeOf<ExpectedSendEvent>();
    expectTypeOf<IframeBridge['waitForEvent']>().toEqualTypeOf<ExpectedWaitForEvent>();
    expectTypeOf<IframeBridge['on']>().toEqualTypeOf<ExpectedOn>();
    expectTypeOf<IframeBridge['whenReady']>().toEqualTypeOf<ExpectedWhenReady>();
    expectTypeOf<IframeBridge['remount']>().toEqualTypeOf<ExpectedRemount>();

    const signalOnlyOptions = { signal: new AbortController().signal } satisfies OperationOptions;
    const resizeAxis = 'both' satisfies IframeBridgeResizeAxis;
    const resizePayload = { height: 640, width: 800 } satisfies IframeBridgeResizePayload;
    const resizeHeightOnlyPayload = { height: 640 } satisfies IframeBridgeResizePayload;
    const resizeWidthOnlyPayload = { width: 800 } satisfies IframeBridgeResizePayload;
    const resizeEvent = {
      height: 640,
      requestedHeight: 620,
      requestedWidth: 780,
      width: 800,
    } satisfies IframeBridgeResizeEvent;
    const resizeCallback = ((event) => {
      expectTypeOf(event.height).toEqualTypeOf<number | undefined>();
      expectTypeOf(event.requestedHeight).toEqualTypeOf<number | undefined>();
      expectTypeOf(event.requestedWidth).toEqualTypeOf<number | undefined>();
      expectTypeOf(event.width).toEqualTypeOf<number | undefined>();
    }) satisfies IframeBridgeResizeCallback;
    const resizeConfig = {
      axis: resizeAxis,
      maxHeightPx: 900,
      maxWidthPx: 1200,
      minHeightPx: 240,
      minWidthPx: 320,
      offsetHeightPx: 12,
      offsetWidthPx: -8,
      onResize: resizeCallback,
    } satisfies IframeBridgeResizeConfig;

    expectTypeOf(signalOnlyOptions.signal).toEqualTypeOf<AbortSignal>();
    expectTypeOf(resizePayload.height).toEqualTypeOf<number>();
    expectTypeOf(resizeEvent.width).toEqualTypeOf<number>();
    expectTypeOf(resizeHeightOnlyPayload.height).toEqualTypeOf<number>();
    expectTypeOf(resizeWidthOnlyPayload.width).toEqualTypeOf<number>();
    expectTypeOf(resizeConfig.axis).toMatchTypeOf<IframeBridgeResizeAxis>();

    // @ts-expect-error resize payloads must include at least one dimension
    const emptyResizePayload = {} satisfies IframeBridgeResizePayload;
    void emptyResizePayload;

    const invalidResizeConfig = {
      // @ts-expect-error resize offsets must be numbers
      offsetWidthPx: '12',
      // @ts-expect-error resize callbacks must be functions
      onResize: 'not-a-function',
    } satisfies IframeBridgeResizeConfig;
    void invalidResizeConfig;

    // IframeBridgeConfig must no longer carry a `resize` field; sizing is opt-in via plugins.
    type ConfigKeys = keyof IframeBridgeConfig;
    type ResizeNotInConfig = 'resize' extends ConfigKeys ? false : true;
    expectTypeOf<ResizeNotInConfig>().toEqualTypeOf<true>();

    // IframeBridgeOptions.plugins accepts a readonly tuple of BridgePlugin factories.
    expectTypeOf<Required<IframeBridgeOptions>['plugins']>().toEqualTypeOf<
      readonly BridgePlugin[]
    >();
    expectTypeOf<BridgePluginContext['warn']>().toEqualTypeOf<(event: DiagnosticEvent) => void>();
    void resizeConfig;
  });

  test('exposes a contract typed bridge factory through the entrypoint', () => {
    type AppContract = {
      requests: {
        'user:get': {
          payload: { id: string };
          response: { name: string };
        };
      };
      outboundEvents: {
        'analytics:track': { action: string };
      };
      inboundEvents: {
        'cart:changed': { itemCount: number };
      };
    };
    type ContractAssignable = AppContract extends IframeBridgeContract ? true : false;

    expectTypeOf<ContractAssignable>().toEqualTypeOf<true>();
    expectTypeOf<
      Parameters<typeof publicApi.createTypedIframeBridge<AppContract>>[0]
    >().toEqualTypeOf<IframeBridgeConfig>();
    expectTypeOf<
      Parameters<typeof publicApi.createTypedIframeBridge<AppContract>>[1]
    >().toEqualTypeOf<IframeBridgeOptions | undefined>();
    expectTypeOf<typeof publicApi.createTypedIframeBridge<AppContract>>().returns.toEqualTypeOf<
      TypedIframeBridge<AppContract>
    >();

    function assertTypedBridge(bridge: TypedIframeBridge<AppContract>): void {
      expectTypeOf(bridge.request('user:get', { id: '123' })).toEqualTypeOf<
        Promise<{ name: string }>
      >();
      expectTypeOf(bridge.sendEvent('analytics:track', { action: 'opened' })).toEqualTypeOf<
        Promise<void>
      >();
      expectTypeOf(bridge.waitForEvent('cart:changed')).toEqualTypeOf<
        Promise<{ itemCount: number }>
      >();
      expectTypeOf(bridge.remount()).toEqualTypeOf<TypedIframeBridge<AppContract>>();

      bridge.on('cart:changed', (payload) => {
        expectTypeOf(payload).toEqualTypeOf<{ itemCount: number }>();
      });

      // @ts-expect-error unknown request name is not part of the contract
      bridge.request('user:missing', { id: '123' });
      // @ts-expect-error request payload must match the contract
      bridge.request('user:get', { userId: '123' });
      // @ts-expect-error inbound events cannot be sent as outbound events
      bridge.sendEvent('cart:changed', { itemCount: 1 });
    }

    expectTypeOf(assertTypedBridge).parameter(0).toEqualTypeOf<TypedIframeBridge<AppContract>>();
  });

  test('root createIframeBridge ignores internal dependency injection arguments', () => {
    Reflect.deleteProperty(globalThis, 'document');
    const document = new FakeDocument();
    const parentWindow = new FakeParentWindow();
    const createIframeBridgeFromUntypedCaller = publicApi.createIframeBridge as unknown as (
      config: IframeBridgeConfig,
      dependencies: unknown,
    ) => IframeBridge;

    expectBridgeThrow(
      () =>
        createIframeBridgeFromUntypedCaller(
          {
            container: createElement(),
            src: 'https://child.example/app',
          },
          { document: document as unknown as Document, parentWindow },
        ),
      'CONFIG_INVALID_CONTAINER',
    );
    expect(document.createdIframes).toEqual([]);
  });

  test('queues request before ready and resolves it with a generic response', async () => {
    vi.useFakeTimers();
    const harness = createHarness();

    const response = harness.bridge.request<{ userId: string }, { displayName: string }>(
      'user:get',
      { userId: 'user-1' },
    );

    expect(harness.childWindow.messages).toEqual([]);

    await vi.advanceTimersByTimeAsync(100);

    expect(harness.childWindow.messages).toEqual([]);

    harness.ready();

    const request = postedRequest<{ userId: string }>(harness.childWindow, 1);
    expect(harness.childWindow.messages.map((message) => message.message.type)).toEqual([
      'bridge:connected',
      'bridge:request',
    ]);
    expect(request).toMatchObject({
      name: 'user:get',
      payload: { userId: 'user-1' },
      sessionId,
      type: 'bridge:request',
    });

    harness.dispatch(
      responseEnvelope<{ displayName: string }>({
        payload: { displayName: 'Ada Lovelace' },
        requestId: request.requestId,
      }),
    );

    await expect(response).resolves.toEqual({ displayName: 'Ada Lovelace' });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('queues sendEvent before ready and resolves after posting without waiting for an ack', async () => {
    vi.useFakeTimers();
    const harness = createHarness();

    const sent = harness.bridge.sendEvent('analytics:track', { action: 'opened' });

    expect(harness.childWindow.messages).toEqual([]);

    harness.ready();

    await expect(sent).resolves.toBeUndefined();
    expect(postedEvent<{ action: string }>(harness.childWindow, 1)).toMatchObject({
      name: 'analytics:track',
      payload: { action: 'opened' },
      sessionId,
      type: 'bridge:event',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('queues waitForEvent before ready and resolves on the next matching inbound event', async () => {
    vi.useFakeTimers();
    const harness = createHarness();

    const payload = harness.bridge.waitForEvent<{ status: string }>('status:changed', {
      timeoutMs: 25,
    });
    let settled = false;
    payload.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(settled).toBe(false);

    harness.dispatch(eventEnvelope('status:changed', { status: 'too-early' }));
    harness.ready();
    harness.dispatch(eventEnvelope('other:event', { status: 'ignored' }));
    harness.dispatch(eventEnvelope('status:changed', { status: 'ready' }));

    await expect(payload).resolves.toEqual({ status: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('on registers a continuous listener and unsubscribe removes it', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const handler = vi.fn<(payload: { count: number }) => void>();

    const unsubscribe = harness.bridge.on<{ count: number }>('counter:changed', handler);

    harness.ready();
    harness.dispatch(eventEnvelope('counter:changed', { count: 1 }));
    unsubscribe();
    harness.dispatch(eventEnvelope('counter:changed', { count: 2 }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ count: 1 });
  });

  test('uses the default operation timeout after a queued request begins execution', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ operationTimeoutMs: 30 });
    let rejected = false;

    const response = harness.bridge.request('slow:default-timeout', undefined);
    response.catch(() => {
      rejected = true;
    });
    const rejection = expectBridgeRejection(response, 'REQUEST_TIMEOUT');

    await vi.advanceTimersByTimeAsync(100);

    expect(rejected).toBe(false);

    harness.ready();

    await vi.advanceTimersByTimeAsync(29);

    expect(rejected).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    const error = await rejection;

    expect(error.details).toEqual({ requestId: 'request-1', timeoutMs: 30 });
  });

  test('uses an override timeout after a queued event waiter becomes active', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ operationTimeoutMs: 1000 });
    let rejected = false;

    const payload = harness.bridge.waitForEvent('never:arrives', { timeoutMs: 12 });
    payload.catch(() => {
      rejected = true;
    });
    const rejection = expectBridgeRejection(payload, 'EVENT_WAIT_TIMEOUT');

    await vi.advanceTimersByTimeAsync(100);

    expect(rejected).toBe(false);

    harness.ready();

    await vi.advanceTimersByTimeAsync(11);

    expect(rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await rejection;

    expect(error.details).toEqual({ name: 'never:arrives', timeoutMs: 12 });
  });

  test('rejects an already aborted operation without posting a bridge request', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const controller = new AbortController();

    harness.ready();
    controller.abort();

    await expectBridgeRejection(
      harness.bridge.request('already:aborted', undefined, {
        signal: controller.signal,
        timeoutMs: 100,
      }),
      'OPERATION_ABORTED',
    );
    expect(harness.childWindow.messages.map((message) => message.message.type)).toEqual([
      'bridge:connected',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('rejects and removes a queued request when its signal aborts before ready', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const controller = new AbortController();

    const request = harness.bridge.request('queued:aborted', undefined, {
      signal: controller.signal,
      timeoutMs: 100,
    });
    const rejection = expectBridgeRejection(request, 'OPERATION_ABORTED');

    controller.abort();

    await rejection;

    harness.ready();

    expect(harness.childWindow.messages.map((message) => message.message.type)).toEqual([
      'bridge:connected',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('aborts active request and event wait operations with timer cleanup', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const requestController = new AbortController();
    const eventController = new AbortController();

    harness.ready();

    const request = harness.bridge.request('active:aborted', undefined, {
      signal: requestController.signal,
      timeoutMs: 1000,
    });
    const event = harness.bridge.waitForEvent('active:event-aborted', {
      signal: eventController.signal,
      timeoutMs: 1000,
    });
    const requestRejection = expectBridgeRejection(request, 'OPERATION_ABORTED');
    const eventRejection = expectBridgeRejection(event, 'OPERATION_ABORTED');

    expect(vi.getTimerCount()).toBe(2);

    requestController.abort();
    eventController.abort();

    await Promise.all([requestRejection, eventRejection]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('destroy rejects active public operations and removes continuous listeners', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const handler = vi.fn<(payload: { value: number }) => void>();

    harness.ready();

    const request = harness.bridge.request('pending:request', undefined);
    const event = harness.bridge.waitForEvent('pending:event');
    const requestRejection = expectBridgeRejection(request, 'BRIDGE_DESTROYED');
    const eventRejection = expectBridgeRejection(event, 'BRIDGE_DESTROYED');
    harness.bridge.on('after:destroy', handler);

    harness.bridge.destroy();
    harness.dispatch(eventEnvelope('after:destroy', { value: 1 }));

    await Promise.all([requestRejection, eventRejection]);
    expect(handler).not.toHaveBeenCalled();
    expect(harness.bridge.state).toBe('destroyed');
  });

  test('resolves event waiters when a continuous listener for the same event throws', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const throwingHandler = vi.fn<() => void>(() => {
      throw new Error('listener failed');
    });
    const followingHandler = vi.fn<(payload: { ready: boolean }) => void>();

    harness.ready();
    harness.bridge.on('status:changed', throwingHandler);
    harness.bridge.on<{ ready: boolean }>('status:changed', followingHandler);
    const event = harness.bridge.waitForEvent<{ ready: boolean }>('status:changed');

    expect(() => harness.dispatch(eventEnvelope('status:changed', { ready: true }))).not.toThrow();

    await expect(event).resolves.toEqual({ ready: true });
    expect(throwingHandler).toHaveBeenCalledTimes(1);
    expect(followingHandler).toHaveBeenCalledWith({ ready: true });
  });
});

type CreateHarnessOptions = {
  readonly operationTimeoutMs?: number;
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

  if (options.operationTimeoutMs !== undefined) {
    config.timeouts = { operationTimeoutMs: options.operationTimeoutMs };
  }

  const bridge = createIframeBridgeInternal(config, {
    document: document as unknown as Document,
    parentWindow,
  });

  const iframe = document.createdIframes[0];

  if (iframe === undefined) {
    throw new Error('Expected bridge to create an iframe.');
  }

  return {
    bridge,
    childWindow: iframe.contentWindow,
    dispatch(envelope: BridgeEnvelope): void {
      parentWindow.dispatch(messageEvent(envelope, iframe.contentWindow));
    },
    ready(): void {
      parentWindow.dispatch(messageEvent(readyEnvelope(), iframe.contentWindow));
    },
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
}

class FakeTargetWindow {
  readonly messages: Array<{ readonly message: BridgeEnvelope; readonly targetOrigin: string }> =
    [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.messages.push({ message: message as BridgeEnvelope, targetOrigin });
  }
}

function postedRequest<TPayload>(
  childWindow: FakeTargetWindow,
  index: number,
): BridgeRequestEnvelope<TPayload> {
  return childWindow.messages[index]?.message as BridgeRequestEnvelope<TPayload>;
}

function postedEvent<TPayload>(
  childWindow: FakeTargetWindow,
  index: number,
): BridgeEventEnvelope<TPayload> {
  return childWindow.messages[index]?.message as BridgeEventEnvelope<TPayload>;
}

function readyEnvelope(): BridgeReadyEnvelope {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:ready',
    version: 1,
  };
}

function createElement(): Element {
  return { nodeType: 1 } as Element;
}

function responseEnvelope<TPayload>(
  overrides: Pick<BridgeResponseEnvelope<TPayload>, 'payload' | 'requestId'>,
): BridgeResponseEnvelope<TPayload> {
  return {
    protocol: 'iframe-bridge',
    sessionId,
    type: 'bridge:response',
    version: 1,
    ...overrides,
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

function messageEvent(data: unknown, source: unknown): BridgeMessageEvent {
  return { data, origin: childOrigin, source };
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

async function expectBridgeRejection(
  promise: Promise<unknown>,
  code: IframeBridgeErrorCode,
): Promise<IframeBridgeError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
    return error as IframeBridgeError;
  }

  throw new Error(`Expected ${code}`);
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

import { createDiagnostics, type BridgeDiagnostics } from '../diagnostics/diagnostics.js';
import {
  BridgeTransport,
  type BridgeTransportOptions,
  type BridgeTransportInvalidMessage,
} from '../messaging/post-message-transport.js';
import { BRIDGE_PROTOCOL_NAME, BRIDGE_PROTOCOL_VERSION } from '../protocol/envelope.js';
import { IframeBridgeError } from '../shared/errors.js';
import type {
  BridgeEnvelope,
  BridgeEventEnvelope,
  IframeChildBridge,
  IframeChildBridgeConfig,
  IframeChildBridgeEventHandler,
  IframeChildBridgeOptions,
  IframeChildBridgePluginHandle,
  IframeChildBridgeRequestHandler,
  ChildLifecycleState,
} from '../types/index.js';
import {
  getCurrentChildWindow,
  getCurrentParentWindow,
  type ChildBridgeParentWindowLike,
  type ChildBridgeTransport,
  type ChildBridgeWindowLike,
  type CreateIframeChildBridgeDependencies,
} from './child-dependencies.js';
import { normalizeChildConfig, type NormalizedIframeChildBridgeConfig } from './child-config.js';

export type { CreateIframeChildBridgeDependencies } from './child-dependencies.js';

type ConnectedWaiter = {
  readonly reject: (reason: unknown) => void;
  readonly resolve: () => void;
};

export function createIframeChildBridge(
  config: IframeChildBridgeConfig = {},
  dependencies: CreateIframeChildBridgeDependencies = {},
  options: IframeChildBridgeOptions = {},
): IframeChildBridge {
  const normalizedConfig = normalizeChildConfig(config, dependencies.location);
  const diagnostics = dependencies.diagnostics ?? createDiagnostics(config.diagnostics);
  const childWindow = dependencies.childWindow ?? getCurrentChildWindow();
  const parentWindow = dependencies.parentWindow ?? getCurrentParentWindow();
  const bridge = new IframeChildBridgeLifecycle({
    childWindow,
    clearTimeout: dependencies.clearTimeout ?? ((timer) => clearTimeout(timer)),
    config: normalizedConfig,
    diagnostics,
    options,
    parentWindow,
    setTimeout: dependencies.setTimeout ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs)),
    transportFactory: dependencies.transportFactory ?? ((options) => new BridgeTransport(options)),
  });

  bridge.start();

  return bridge;
}

type IframeChildBridgeLifecycleOptions = {
  readonly childWindow: ChildBridgeWindowLike;
  readonly clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  readonly config: NormalizedIframeChildBridgeConfig;
  readonly diagnostics: BridgeDiagnostics;
  readonly options: IframeChildBridgeOptions;
  readonly parentWindow: ChildBridgeParentWindowLike;
  readonly setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  readonly transportFactory: (options: BridgeTransportOptions) => ChildBridgeTransport;
};

class IframeChildBridgeLifecycle implements IframeChildBridge {
  readonly #clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  readonly #config: NormalizedIframeChildBridgeConfig;
  readonly #connectedWaiters = new Set<ConnectedWaiter>();
  readonly #diagnostics: BridgeDiagnostics;
  readonly #pluginHandles: IframeChildBridgePluginHandle[];
  readonly #setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  readonly #transport: ChildBridgeTransport;
  #connectionTimer: ReturnType<typeof setTimeout> | undefined;
  #state: ChildLifecycleState = 'created';
  #terminalError: IframeBridgeError | undefined;

  constructor(options: IframeChildBridgeLifecycleOptions) {
    this.#clearTimeout = options.clearTimeout;
    this.#config = options.config;
    this.#diagnostics = options.diagnostics;
    this.#pluginHandles = this.#setupPlugins(options.options);
    this.#setTimeout = options.setTimeout;
    this.#transport = options.transportFactory({
      expectedOrigin: options.config.parentOrigin,
      onConnected: this.#acceptConnected,
      onEvent: this.#handleEvent,
      onInvalidMessage: this.#handleInvalidMessage,
      parentWindow: options.childWindow,
      sessionId: options.config.sessionId,
      sourceWindow: options.parentWindow,
      targetOrigin: options.config.parentOrigin,
      targetWindow: options.parentWindow,
    });
  }

  get parentOrigin(): string {
    return this.#config.parentOrigin;
  }

  get sessionId(): string {
    return this.#config.sessionId;
  }

  get state(): ChildLifecycleState {
    return this.#state;
  }

  start(): void {
    if (this.#state !== 'created') {
      return;
    }

    this.#state = 'connecting';
    this.#transport.start();
    this.#connectionTimer = this.#setTimeout(
      this.#failConnection,
      this.#config.connectionTimeoutMs,
    );
    this.#post({
      protocol: BRIDGE_PROTOCOL_NAME,
      sessionId: this.#config.sessionId,
      type: 'bridge:ready',
      version: BRIDGE_PROTOCOL_VERSION,
    });
  }

  destroy(): void {
    if (this.#state === 'destroyed') {
      return;
    }

    const error = new IframeBridgeError('BRIDGE_DESTROYED', 'Bridge destroyed.');
    this.#terminalError = error;
    this.#clearConnectionTimer();
    this.#transport.stop();
    this.#destroyPlugins();
    this.#rejectConnectedWaiters(error);
    this.#state = 'destroyed';
  }

  sendEvent<TPayload = unknown>(name: string, payload: TPayload): Promise<void> {
    if (this.#state !== 'connected') {
      return Promise.reject(this.#createUnavailableError());
    }

    try {
      this.#post({
        name,
        payload,
        protocol: BRIDGE_PROTOCOL_NAME,
        sessionId: this.#config.sessionId,
        type: 'bridge:event',
        version: BRIDGE_PROTOCOL_VERSION,
      });
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  on<TPayload = unknown>(
    _name: string,
    _handler: IframeChildBridgeEventHandler<TPayload>,
  ): () => void {
    void _name;
    void _handler;

    if (this.#state === 'destroyed' || this.#state === 'connection_failed') {
      throw this.#createUnavailableError();
    }

    return () => undefined;
  }

  handleRequest<TPayload = unknown, TResponse = unknown>(
    _name: string,
    _handler: IframeChildBridgeRequestHandler<TPayload, TResponse>,
  ): () => void {
    void _name;
    void _handler;

    if (this.#state === 'destroyed' || this.#state === 'connection_failed') {
      throw this.#createUnavailableError();
    }

    return () => undefined;
  }

  whenConnected(): Promise<void> {
    if (this.#state === 'connected') {
      return Promise.resolve();
    }

    if (this.#state === 'destroyed' || this.#state === 'connection_failed') {
      return Promise.reject(this.#createUnavailableError());
    }

    return new Promise<void>((resolve, reject) => {
      this.#connectedWaiters.add({ reject, resolve });
    });
  }

  readonly #acceptConnected = (): void => {
    if (this.#state !== 'connecting') {
      return;
    }

    this.#clearConnectionTimer();
    this.#state = 'connected';
    this.#resolveConnectedWaiters();
    this.#notifyPluginsConnected();
  };

  readonly #handleEvent = (envelope: BridgeEventEnvelope): void => {
    for (const handle of this.#pluginHandles) {
      handle.onEvent?.(envelope, this);
    }
  };

  readonly #failConnection = (): void => {
    if (this.#state !== 'connecting') {
      return;
    }

    const error = new IframeBridgeError('HANDSHAKE_TIMEOUT', 'Child bridge connection timed out.', {
      details: { timeoutMs: this.#config.connectionTimeoutMs },
    });

    this.#connectionTimer = undefined;
    this.#terminalError = error;
    this.#transport.stop();
    this.#destroyPlugins();
    this.#state = 'connection_failed';
    this.#rejectConnectedWaiters(error);
  };

  readonly #handleInvalidMessage = (message: BridgeTransportInvalidMessage): void => {
    this.#diagnostics.warn({
      code: `MESSAGE_${message.code.toUpperCase()}`,
      details: { reason: message.reason, sessionId: this.#config.sessionId },
      message: 'Child bridge ignored an invalid message.',
      sessionId: this.#config.sessionId,
    });
  };

  #post(envelope: BridgeEnvelope): void {
    this.#transport.post(envelope);
  }

  #setupPlugins(options: IframeChildBridgeOptions): IframeChildBridgePluginHandle[] {
    const handles: IframeChildBridgePluginHandle[] = [];

    for (const plugin of options.plugins ?? []) {
      const handle = plugin({
        bridge: this,
        parentOrigin: this.#config.parentOrigin,
        sessionId: this.#config.sessionId,
        warn: this.#diagnostics.warn,
      });

      if (handle !== undefined) {
        handles.push(handle);
      }
    }

    return handles;
  }

  #notifyPluginsConnected(): void {
    for (const handle of this.#pluginHandles) {
      handle.onConnected?.();
    }
  }

  #destroyPlugins(): void {
    for (const handle of this.#pluginHandles.splice(0)) {
      handle.destroy?.();
    }
  }

  #resolveConnectedWaiters(): void {
    const waiters = Array.from(this.#connectedWaiters);
    this.#connectedWaiters.clear();

    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  #rejectConnectedWaiters(error: unknown): void {
    const waiters = Array.from(this.#connectedWaiters);
    this.#connectedWaiters.clear();

    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  #clearConnectionTimer(): void {
    if (this.#connectionTimer === undefined) {
      return;
    }

    this.#clearTimeout(this.#connectionTimer);
    this.#connectionTimer = undefined;
  }

  #createUnavailableError(): IframeBridgeError {
    if (this.#terminalError !== undefined) {
      return this.#terminalError;
    }

    if (this.#state === 'destroyed') {
      return new IframeBridgeError('BRIDGE_DESTROYED', 'Bridge destroyed.');
    }

    return new IframeBridgeError('BRIDGE_NOT_READY', 'Child bridge is not connected.');
  }
}

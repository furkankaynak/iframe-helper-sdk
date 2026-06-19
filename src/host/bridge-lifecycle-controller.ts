import type { BridgeDiagnostics } from '../diagnostics/diagnostics.js';
import { RequestCoordinator } from '../messaging/request-coordinator.js';
import type {
  BridgeTransportInvalidMessage,
  BridgeTransportOptions,
  BridgeTransportWindowLike,
} from '../messaging/post-message-transport.js';
import { BRIDGE_PROTOCOL_NAME, BRIDGE_PROTOCOL_VERSION } from '../protocol/envelope.js';
import { IframeBridgeError, createOperationAbortedError } from '../shared/errors.js';
import type {
  BridgeEnvelope,
  BridgeEventEnvelope,
  BridgeResponseEnvelope,
  IframeBridge,
  IframeBridgeEventHandler,
  LifecycleState,
  OperationOptions,
} from '../types/index.js';
import type { BridgeLifecycleQueue, BridgeLifecycleTransport } from './bridge-dependencies.js';
import { isOperationQueue, runOperation } from './bridge-dependencies.js';
import { createInvalidMessageDiagnostic } from './bridge-diagnostics.js';
import { BridgeEventRegistry } from './bridge-events.js';
import type { NormalizedIframeBridgeConfig } from './config.js';

export type IframeBridgeLifecycleControllerOptions = {
  readonly clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  readonly config: NormalizedIframeBridgeConfig;
  readonly diagnostics: BridgeDiagnostics;
  readonly iframe: HTMLIFrameElement;
  readonly parentWindow: BridgeTransportWindowLike;
  readonly queue: BridgeLifecycleQueue | undefined;
  readonly remount: () => IframeBridge;
  readonly setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  readonly transportFactory: (options: BridgeTransportOptions) => BridgeLifecycleTransport;
};

type ReadyWaiter = {
  readonly reject: (reason: unknown) => void;
  readonly resolve: () => void;
};

export class IframeBridgeLifecycleController implements IframeBridge {
  readonly #clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  readonly #config: NormalizedIframeBridgeConfig;
  readonly #diagnostics: BridgeDiagnostics;
  readonly #eventRegistry: BridgeEventRegistry;
  readonly #iframe: HTMLIFrameElement;
  readonly #parentWindow: BridgeTransportWindowLike;
  readonly #queue: BridgeLifecycleQueue | undefined;
  readonly #readyWaiters = new Set<ReadyWaiter>();
  readonly #remount: () => IframeBridge;
  readonly #requestCoordinator = new RequestCoordinator();
  readonly #setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  readonly #transportFactory: (options: BridgeTransportOptions) => BridgeLifecycleTransport;
  #handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  #isQueueClosed = false;
  #isTransportStopped = false;
  #state: LifecycleState = 'created';
  #terminalError: IframeBridgeError | undefined;
  #transport: BridgeLifecycleTransport | undefined;

  constructor(options: IframeBridgeLifecycleControllerOptions) {
    this.#clearTimeout = options.clearTimeout;
    this.#config = options.config;
    this.#diagnostics = options.diagnostics;
    this.#iframe = options.iframe;
    this.#parentWindow = options.parentWindow;
    this.#queue = options.queue;
    this.#remount = options.remount;
    this.#setTimeout = options.setTimeout;
    this.#transportFactory = options.transportFactory;
    this.#eventRegistry = new BridgeEventRegistry({
      clearTimeout: options.clearTimeout,
      diagnostics: options.diagnostics,
      getOperationTimeout: (operationOptions) => this.#getOperationTimeout(operationOptions),
      sessionId: options.config.bootstrap.session.paramValue,
      setTimeout: options.setTimeout,
    });
  }

  get iframe(): HTMLIFrameElement {
    return this.#iframe;
  }

  get state(): LifecycleState {
    return this.#state;
  }

  mount(): void {
    if (this.#state !== 'created') {
      return;
    }

    this.#state = 'mounting';

    this.#transport = this.#transportFactory({
      expectedOrigin: this.#config.allowedOrigin,
      onEvent: this.#handleEvent,
      onInvalidMessage: this.#handleInvalidMessage,
      onReady: this.#acceptReady,
      onResponse: this.#handleResponse,
      parentWindow: this.#parentWindow,
      resolveSourceWindow: this.#getTargetWindow,
      resolveTargetWindow: this.#getTargetWindow,
      sessionId: this.#config.bootstrap.session.paramValue,
      targetOrigin: this.#config.targetOrigin,
    });

    this.#state = 'waiting_for_handshake';
    this.#handshakeTimer = this.#setTimeout(
      this.#failHandshake,
      this.#config.bootstrap.handshakeTimeoutMs,
    );
    this.#transport.start();

    try {
      this.#mountIframe();
    } catch (cause: unknown) {
      throw this.#failMount(cause);
    }
  }

  destroy(): void {
    if (this.#state === 'destroyed') {
      return;
    }

    const error = new IframeBridgeError('BRIDGE_DESTROYED', 'Bridge destroyed.');
    this.#terminalError = error;
    this.#clearHandshakeTimer();
    this.#stopTransport();
    this.#closeQueue(error);
    this.#requestCoordinator.rejectAll(error);
    this.#eventRegistry.rejectWaiters(error);
    this.#rejectReadyWaiters(error);
    this.#eventRegistry.clearListeners();
    this.#iframe.remove();
    this.#state = 'destroyed';
  }

  request<TPayload = unknown, TResponse = unknown>(
    method: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<TResponse> {
    return this.#runWhenReady(
      () => this.#executeRequest<TPayload, TResponse>(method, payload, options),
      options,
    );
  }

  sendEvent<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<void> {
    return this.#runWhenReady(() => this.#executeSendEvent(name, payload, options), options);
  }

  waitForEvent<TPayload = unknown>(name: string, options?: OperationOptions): Promise<TPayload> {
    return this.#runWhenReady(
      () => this.#eventRegistry.waitForEvent<TPayload>(name, options),
      options,
    );
  }

  on<TPayload = unknown>(name: string, handler: IframeBridgeEventHandler<TPayload>): () => void {
    if (this.#state === 'destroyed' || this.#state === 'handshake_failed') {
      throw this.#createUnavailableError();
    }

    return this.#eventRegistry.on(name, handler);
  }

  whenReady(): Promise<void> {
    if (this.#state === 'ready') {
      return Promise.resolve();
    }

    if (this.#state === 'destroyed' || this.#state === 'handshake_failed') {
      return Promise.reject(this.#createUnavailableError());
    }

    return new Promise<void>((resolve, reject) => {
      this.#readyWaiters.add({ reject, resolve });
    });
  }

  remount(): IframeBridge {
    this.destroy();
    return this.#remount();
  }

  readonly #acceptReady = (): void => {
    if (this.#state !== 'waiting_for_handshake') {
      return;
    }

    this.#clearHandshakeTimer();
    this.#state = 'ready';
    this.#transport?.post({
      protocol: BRIDGE_PROTOCOL_NAME,
      sessionId: this.#config.bootstrap.session.paramValue,
      type: 'bridge:connected',
      version: BRIDGE_PROTOCOL_VERSION,
    });
    this.#queue?.flush();
    this.#resolveReadyWaiters();
  };

  readonly #failHandshake = (): void => {
    if (this.#state !== 'waiting_for_handshake') {
      return;
    }

    const error = new IframeBridgeError('HANDSHAKE_TIMEOUT', 'Bridge handshake timed out.', {
      details: { timeoutMs: this.#config.bootstrap.handshakeTimeoutMs },
    });

    this.#handshakeTimer = undefined;
    this.#state = 'handshake_failed';
    this.#terminalError = error;
    this.#stopTransport();
    this.#closeQueue(error);
    this.#requestCoordinator.rejectAll(error);
    this.#eventRegistry.rejectWaiters(error);
    this.#rejectReadyWaiters(error);
    this.#eventRegistry.clearListeners();
  };

  #executeRequest<TPayload, TResponse>(
    method: string,
    payload: TPayload,
    options: OperationOptions | undefined,
  ): Promise<TResponse> {
    this.#throwIfAborted(options);
    const timeoutMs = this.#getOperationTimeout(options);
    const request =
      options?.signal === undefined
        ? this.#requestCoordinator.createRequest<TResponse>(timeoutMs)
        : this.#requestCoordinator.createRequest<TResponse>(timeoutMs, { signal: options.signal });

    try {
      this.#post({
        name: method,
        payload,
        protocol: BRIDGE_PROTOCOL_NAME,
        requestId: request.requestId,
        sessionId: this.#config.bootstrap.session.paramValue,
        type: 'bridge:request',
        version: BRIDGE_PROTOCOL_VERSION,
      });
    } catch (error: unknown) {
      this.#requestCoordinator.discard(request.requestId);
      throw error;
    }

    return request.promise;
  }

  #executeSendEvent<TPayload>(
    name: string,
    payload: TPayload,
    options: OperationOptions | undefined,
  ): void {
    this.#throwIfAborted(options);
    this.#getOperationTimeout(options);
    this.#post({
      name,
      payload,
      protocol: BRIDGE_PROTOCOL_NAME,
      sessionId: this.#config.bootstrap.session.paramValue,
      type: 'bridge:event',
      version: BRIDGE_PROTOCOL_VERSION,
    });
  }

  readonly #handleEvent = (envelope: BridgeEventEnvelope): void => {
    if (this.#state !== 'ready') {
      return;
    }

    this.#eventRegistry.handleEvent(envelope);
  };

  readonly #handleResponse = (envelope: BridgeResponseEnvelope): void => {
    if (this.#state !== 'ready') {
      return;
    }

    if (envelope.error !== undefined) {
      this.#requestCoordinator.rejectRemote(envelope.requestId, envelope.error);
      return;
    }

    this.#requestCoordinator.resolve(envelope.requestId, envelope.payload);
  };

  readonly #handleInvalidMessage = (message: BridgeTransportInvalidMessage): void => {
    this.#diagnostics.warn(
      createInvalidMessageDiagnostic(message, this.#config.bootstrap.session.paramValue),
    );
  };

  #resolveReadyWaiters(): void {
    const waiters = Array.from(this.#readyWaiters);
    this.#readyWaiters.clear();

    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  #rejectReadyWaiters(error: unknown): void {
    const waiters = Array.from(this.#readyWaiters);
    this.#readyWaiters.clear();

    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  #runWhenReady<T>(operation: () => Promise<T> | T, options?: OperationOptions): Promise<T> {
    if (options?.signal?.aborted) {
      return Promise.reject(createOperationAbortedError());
    }

    if (this.#state === 'ready') {
      return runOperation(operation);
    }

    if (
      this.#state === 'created' ||
      this.#state === 'mounting' ||
      this.#state === 'waiting_for_handshake'
    ) {
      if (isOperationQueue(this.#queue)) {
        return options?.signal === undefined
          ? this.#queue.enqueue(operation)
          : this.#queue.enqueue(operation, { signal: options.signal });
      }

      return Promise.reject(new IframeBridgeError('BRIDGE_NOT_READY', 'Bridge is not ready.'));
    }

    return Promise.reject(this.#createUnavailableError());
  }

  #throwIfAborted(options: OperationOptions | undefined): void {
    if (options?.signal?.aborted) {
      throw createOperationAbortedError();
    }
  }

  #getOperationTimeout(options: OperationOptions | undefined): number {
    const timeoutMs = options?.timeoutMs ?? this.#config.timeouts.operationTimeoutMs;

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new IframeBridgeError(
        'OPERATION_INVALID_TIMEOUT',
        'Operation timeout must be a finite positive integer.',
        { details: { timeoutMs } },
      );
    }

    return timeoutMs;
  }

  #post(envelope: BridgeEnvelope): void {
    if (this.#transport === undefined) {
      throw new IframeBridgeError('BRIDGE_NOT_READY', 'Bridge transport is not available.');
    }

    this.#transport.post(envelope);
  }

  #createUnavailableError(): IframeBridgeError {
    if (this.#terminalError !== undefined) {
      return this.#terminalError;
    }

    if (this.#state === 'destroyed') {
      return new IframeBridgeError('BRIDGE_DESTROYED', 'Bridge destroyed.');
    }

    return new IframeBridgeError('BRIDGE_NOT_READY', 'Bridge is not ready.');
  }

  #clearHandshakeTimer(): void {
    if (this.#handshakeTimer === undefined) {
      return;
    }

    this.#clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = undefined;
  }

  #closeQueue(error: IframeBridgeError): void {
    if (this.#isQueueClosed) {
      return;
    }

    this.#queue?.close(error);
    this.#isQueueClosed = true;
  }

  readonly #getTargetWindow = (): Window | null => {
    return this.#iframe.contentWindow;
  };

  #mountIframe(): void {
    if (this.#config.replaceContainerContent) {
      this.#config.container.replaceChildren(this.#iframe);
      return;
    }

    this.#config.container.appendChild(this.#iframe);
  }

  #failMount(cause: unknown): IframeBridgeError {
    const error =
      cause instanceof IframeBridgeError
        ? cause
        : new IframeBridgeError('CONFIG_INVALID_CONTAINER', 'Failed to mount iframe.', {
            cause,
          });

    this.#terminalError = error;
    this.#clearHandshakeTimer();
    this.#stopTransport();
    this.#closeQueue(error);
    this.#requestCoordinator.rejectAll(error);
    this.#eventRegistry.rejectWaiters(error);
    this.#rejectReadyWaiters(error);
    this.#eventRegistry.clearListeners();
    this.#iframe.remove();
    this.#state = 'destroyed';
    return error;
  }

  #stopTransport(): void {
    if (this.#transport === undefined || this.#isTransportStopped) {
      return;
    }

    this.#transport.stop();
    this.#isTransportStopped = true;
  }
}

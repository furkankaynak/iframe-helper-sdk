import type { BridgeDiagnostics } from '../diagnostics/diagnostics.js';
import { IframeBridgeError, createOperationAbortedError } from '../shared/errors.js';
import type {
  BridgeEventEnvelope,
  IframeBridgeEventHandler,
  OperationOptions,
} from '../types/index.js';
import { createEventListenerErrorDiagnostic } from './bridge-diagnostics.js';

type EventWaiter = {
  cleanup?: () => void;
  readonly name: string;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly timeoutMs: number;
};

export type BridgeEventRegistryOptions = {
  readonly clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  readonly diagnostics: BridgeDiagnostics;
  readonly getOperationTimeout: (options: OperationOptions | undefined) => number;
  readonly sessionId: string;
  readonly setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
};

export class BridgeEventRegistry {
  readonly #clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  readonly #diagnostics: BridgeDiagnostics;
  readonly #eventListeners = new Map<string, Set<IframeBridgeEventHandler<unknown>>>();
  readonly #eventWaiters = new Set<EventWaiter>();
  readonly #getOperationTimeout: (options: OperationOptions | undefined) => number;
  readonly #sessionId: string;
  readonly #setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;

  constructor(options: BridgeEventRegistryOptions) {
    this.#clearTimeout = options.clearTimeout;
    this.#diagnostics = options.diagnostics;
    this.#getOperationTimeout = options.getOperationTimeout;
    this.#sessionId = options.sessionId;
    this.#setTimeout = options.setTimeout;
  }

  on<TPayload = unknown>(name: string, handler: IframeBridgeEventHandler<TPayload>): () => void {
    let listeners = this.#eventListeners.get(name);

    if (listeners === undefined) {
      listeners = new Set();
      this.#eventListeners.set(name, listeners);
    }

    // Event payload schemas are caller-defined; runtime dispatch receives unknown payloads.
    const listener = handler as IframeBridgeEventHandler<unknown>;
    listeners.add(listener);

    return () => {
      const currentListeners = this.#eventListeners.get(name);

      if (currentListeners === undefined) {
        return;
      }

      currentListeners.delete(listener);

      if (currentListeners.size === 0) {
        this.#eventListeners.delete(name);
      }
    };
  }

  waitForEvent<TPayload = unknown>(
    name: string,
    options: OperationOptions | undefined,
  ): Promise<TPayload> {
    this.#throwIfAborted(options);
    const timeoutMs = this.#getOperationTimeout(options);

    return new Promise<TPayload>((resolve, reject) => {
      const waiter: EventWaiter = {
        name,
        reject,
        resolve: (payload) => {
          // The typed bridge contract defines payload shape; transport validation keeps it unknown.
          resolve(payload as TPayload);
        },
        timer: this.#setTimeout(() => {
          this.#eventWaiters.delete(waiter);
          waiter.cleanup?.();
          reject(
            new IframeBridgeError('EVENT_WAIT_TIMEOUT', 'Timed out waiting for bridge event.', {
              details: { name, timeoutMs },
            }),
          );
        }, timeoutMs),
        timeoutMs,
      };

      if (options?.signal !== undefined) {
        const abort = (): void => {
          if (!this.#eventWaiters.delete(waiter)) {
            return;
          }

          this.#clearTimeout(waiter.timer);
          waiter.cleanup?.();
          reject(createOperationAbortedError({ name }));
        };

        options.signal.addEventListener('abort', abort, { once: true });
        waiter.cleanup = () => {
          options.signal?.removeEventListener('abort', abort);
        };
      }

      this.#eventWaiters.add(waiter);
    });
  }

  handleEvent(envelope: BridgeEventEnvelope): void {
    const listeners = this.#eventListeners.get(envelope.name);

    if (listeners !== undefined) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(envelope.payload);
        } catch (error: unknown) {
          this.#diagnostics.error(
            createEventListenerErrorDiagnostic(error, envelope.name, this.#sessionId),
          );
          // User handlers must not prevent other bridge routes from observing the event.
        }
      }
    }

    for (const waiter of Array.from(this.#eventWaiters)) {
      if (waiter.name === envelope.name) {
        this.#resolveWaiter(waiter, envelope.payload);
      }
    }
  }

  clearListeners(): void {
    this.#eventListeners.clear();
  }

  rejectWaiters(error: unknown): void {
    const waiters = Array.from(this.#eventWaiters);
    this.#eventWaiters.clear();

    for (const waiter of waiters) {
      this.#clearTimeout(waiter.timer);
      waiter.cleanup?.();
      waiter.reject(error);
    }
  }

  #resolveWaiter(waiter: EventWaiter, payload: unknown): void {
    if (!this.#eventWaiters.delete(waiter)) {
      return;
    }

    this.#clearTimeout(waiter.timer);
    waiter.cleanup?.();
    waiter.resolve(payload);
  }

  #throwIfAborted(options: OperationOptions | undefined): void {
    if (options?.signal?.aborted) {
      throw createOperationAbortedError();
    }
  }
}

import { IframeBridgeError, createOperationAbortedError } from '../shared/errors.js';
import type { BridgeEnvelopeError } from '../types/index.js';

export type RequestCoordinatorOptions = {
  readonly createRequestId?: () => string;
};

export type RequestCoordinatorRequest<T = unknown> = {
  readonly requestId: string;
  readonly promise: Promise<T>;
};

type PendingRequest = {
  cleanup?: () => void;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly timeoutMs: number;
};

export type RequestCoordinatorCreateOptions = {
  readonly signal?: AbortSignal;
};

export class RequestCoordinator {
  readonly #createRequestId: (() => string) | undefined;
  readonly #pending = new Map<string, PendingRequest>();
  #nextRequestId = 1;

  constructor(options: RequestCoordinatorOptions = {}) {
    this.#createRequestId = options.createRequestId;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  createRequest<T = unknown>(
    timeoutMs: number,
    options: RequestCoordinatorCreateOptions = {},
  ): RequestCoordinatorRequest<T> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new IframeBridgeError(
        'OPERATION_INVALID_TIMEOUT',
        'Request timeout must be a finite positive integer.',
        { details: { timeoutMs } },
      );
    }

    if (options.signal?.aborted) {
      throw createOperationAbortedError();
    }

    const requestId = this.#generateRequestId();
    let resolveRequest: (value: unknown) => void = () => {
      throw new Error('Request resolver was not initialized.');
    };
    let rejectRequest: (reason: unknown) => void = () => {
      throw new Error('Request rejecter was not initialized.');
    };
    const promise = new Promise<T>((resolve, reject) => {
      resolveRequest = (value: unknown) => {
        // Request response payloads are app-defined; callers choose T at the bridge contract boundary.
        resolve(value as T);
      };
      rejectRequest = reject;
    });
    const timer = setTimeout(() => {
      const pending = this.#pending.get(requestId);

      if (pending === undefined) {
        return;
      }

      this.#pending.delete(requestId);
      pending.reject(
        new IframeBridgeError('REQUEST_TIMEOUT', 'Request timed out.', {
          details: { requestId, timeoutMs: pending.timeoutMs },
        }),
      );
    }, timeoutMs);

    const pendingRequest: PendingRequest = {
      reject: rejectRequest,
      resolve: resolveRequest,
      timer,
      timeoutMs,
    };

    if (options.signal !== undefined) {
      const abort = (): void => {
        const pending = this.#takePending(requestId);

        if (pending === undefined) {
          return;
        }

        pending.reject(createOperationAbortedError({ requestId }));
      };

      options.signal.addEventListener('abort', abort, { once: true });
      pendingRequest.cleanup = () => {
        options.signal?.removeEventListener('abort', abort);
      };
    }

    this.#pending.set(requestId, pendingRequest);

    return { requestId, promise };
  }

  resolve(requestId: string, payload: unknown): boolean {
    const pending = this.#takePending(requestId);

    if (pending === undefined) {
      return false;
    }

    pending.resolve(payload);
    return true;
  }

  rejectRemote(requestId: string, remoteError: BridgeEnvelopeError): boolean {
    const pending = this.#takePending(requestId);

    if (pending === undefined) {
      return false;
    }

    pending.reject(
      new IframeBridgeError('REQUEST_REMOTE_ERROR', remoteError.message, {
        details: { requestId, remoteError },
      }),
    );
    return true;
  }

  discard(requestId: string): boolean {
    return this.#takePending(requestId) !== undefined;
  }

  rejectAll(error: unknown = new IframeBridgeError('BRIDGE_DESTROYED', 'Bridge destroyed.')): void {
    const pendingRequests = Array.from(this.#pending.values());
    this.#pending.clear();

    for (const pending of pendingRequests) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
  }

  #takePending(requestId: string): PendingRequest | undefined {
    const pending = this.#pending.get(requestId);

    if (pending === undefined) {
      return undefined;
    }

    this.#pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.cleanup?.();
    return pending;
  }

  #generateRequestId(): string {
    if (this.#createRequestId !== undefined) {
      return this.#createRequestId();
    }

    const requestId = `request-${this.#nextRequestId}`;
    this.#nextRequestId += 1;
    return requestId;
  }
}

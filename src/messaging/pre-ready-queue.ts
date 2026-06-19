import { IframeBridgeError, createOperationAbortedError } from '../shared/errors.js';

type QueuedOperation<T> = {
  cleanup?: () => void;
  readonly operation: () => Promise<T> | T;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

export type PreReadyQueueEnqueueOptions = {
  readonly signal?: AbortSignal;
};

export type PreReadyQueueOptions = {
  readonly maxSize: number;
};

export class PreReadyQueue<T> {
  readonly #maxSize: number;
  #closedError: unknown;
  #isClosed = false;
  #isFlushed = false;
  #queue: QueuedOperation<T>[] = [];

  constructor(options: PreReadyQueueOptions) {
    if (!Number.isInteger(options.maxSize) || options.maxSize < 1) {
      throw new IframeBridgeError(
        'CONFIG_INVALID_QUEUE',
        'Pre-ready queue maxSize must be an integer greater than or equal to 1.',
        { details: { maxSize: options.maxSize } },
      );
    }

    this.#maxSize = options.maxSize;
  }

  get size(): number {
    return this.#queue.length;
  }

  enqueue(operation: () => Promise<T> | T, options: PreReadyQueueEnqueueOptions = {}): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(createOperationAbortedError());
    }

    if (this.#isClosed) {
      return Promise.reject(this.#closedError);
    }

    if (this.#isFlushed) {
      return runOperation(operation);
    }

    if (this.#queue.length >= this.#maxSize) {
      return Promise.reject(
        new IframeBridgeError('QUEUE_LIMIT_EXCEEDED', 'Pre-ready queue limit exceeded.', {
          details: { maxSize: this.#maxSize },
        }),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const queuedOperation: QueuedOperation<T> = { operation, reject, resolve };
      const abort = (): void => {
        if (!this.#removeQueuedOperation(queuedOperation)) {
          return;
        }

        reject(createOperationAbortedError());
      };

      if (options.signal !== undefined) {
        options.signal.addEventListener('abort', abort, { once: true });
        queuedOperation.cleanup = () => {
          options.signal?.removeEventListener('abort', abort);
        };
      }

      this.#queue.push(queuedOperation);
    });
  }

  flush(): void {
    if (this.#isClosed || this.#isFlushed) {
      return;
    }

    this.#isFlushed = true;
    const queue = this.#queue;
    this.#queue = [];

    for (const item of queue) {
      item.cleanup?.();
      runOperation(item.operation).then(item.resolve, item.reject);
    }
  }

  close(error: unknown = createQueueClosedError()): void {
    if (this.#isClosed) {
      return;
    }

    this.#isClosed = true;
    this.#closedError = error;
    const queue = this.#queue;
    this.#queue = [];

    for (const item of queue) {
      item.cleanup?.();
      item.reject(error);
    }
  }

  #removeQueuedOperation(operation: QueuedOperation<T>): boolean {
    const index = this.#queue.indexOf(operation);

    if (index === -1) {
      return false;
    }

    this.#queue.splice(index, 1);
    operation.cleanup?.();
    return true;
  }
}

function runOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}

function createQueueClosedError(): IframeBridgeError {
  return new IframeBridgeError('QUEUE_CLOSED', 'Pre-ready queue is closed.');
}

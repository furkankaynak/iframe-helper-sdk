import { PreReadyQueue } from '../messaging/pre-ready-queue.js';
import type {
  BridgeTransport,
  BridgeTransportOptions,
  BridgeTransportWindowLike,
} from '../messaging/post-message-transport.js';
import { IframeBridgeError } from '../shared/errors.js';
import type { NormalizedIframeBridgeConfig } from './config.js';

export type BridgeLifecycleTransport = Pick<BridgeTransport, 'post' | 'start' | 'stop'>;

export type BridgeLifecycleQueue = Pick<PreReadyQueue<unknown>, 'close' | 'flush'>;

export type BridgeOperationQueue = BridgeLifecycleQueue & {
  enqueue<T>(
    operation: () => Promise<T> | T,
    options?: { readonly signal?: AbortSignal },
  ): Promise<T>;
};

export type BridgeLifecycleQueueFactoryOptions = {
  readonly maxSize: number;
};

export type BridgeDocumentLike = {
  createElement(tagName: 'iframe'): HTMLIFrameElement;
};

export type CreateIframeBridgeDependencies = {
  readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly document?: BridgeDocumentLike;
  readonly parentWindow?: BridgeTransportWindowLike;
  readonly queueFactory?: (options: BridgeLifecycleQueueFactoryOptions) => BridgeLifecycleQueue;
  readonly setTimeout?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  readonly transportFactory?: (options: BridgeTransportOptions) => BridgeLifecycleTransport;
};

export function createQueue(
  config: NormalizedIframeBridgeConfig,
  queueFactory: ((options: BridgeLifecycleQueueFactoryOptions) => BridgeLifecycleQueue) | undefined,
): BridgeLifecycleQueue | undefined {
  if (!config.queue.enabled) {
    return undefined;
  }

  return (
    queueFactory?.({ maxSize: config.queue.maxSize }) ?? new PreReadyQueue<unknown>(config.queue)
  );
}

export function isOperationQueue(
  queue: BridgeLifecycleQueue | undefined,
): queue is BridgeOperationQueue {
  return queue !== undefined && 'enqueue' in queue && typeof queue.enqueue === 'function';
}

export function runOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}

export function getCurrentDocument(): BridgeDocumentLike {
  if (typeof document === 'undefined') {
    throw new IframeBridgeError(
      'CONFIG_INVALID_CONTAINER',
      'Document is required to create iframe.',
    );
  }

  return document;
}

export function getCurrentParentWindow(): BridgeTransportWindowLike {
  if (typeof window === 'undefined') {
    throw new IframeBridgeError(
      'CONFIG_INVALID_CONTAINER',
      'Window is required to listen for bridge messages.',
    );
  }

  return {
    addEventListener(type, listener) {
      window.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      window.removeEventListener(type, listener);
    },
  };
}

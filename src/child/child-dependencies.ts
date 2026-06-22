import type { BridgeDiagnostics } from '../diagnostics/diagnostics.js';
import type {
  BridgeTransport,
  BridgeTransportOptions,
  BridgeTransportTargetWindowLike,
  BridgeTransportWindowLike,
} from '../messaging/post-message-transport.js';
import { IframeBridgeError } from '../shared/errors.js';
import type { ChildConfigLocation } from './child-config.js';

export type ChildBridgeWindowLike = BridgeTransportWindowLike;

export type ChildBridgeParentWindowLike = BridgeTransportTargetWindowLike;

export type ChildBridgeTransport = Pick<BridgeTransport, 'post' | 'start' | 'stop'>;

export type CreateIframeChildBridgeDependencies = {
  readonly childWindow?: ChildBridgeWindowLike;
  readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly diagnostics?: BridgeDiagnostics;
  readonly location?: ChildConfigLocation;
  readonly parentWindow?: ChildBridgeParentWindowLike;
  readonly setTimeout?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  readonly transportFactory?: (options: BridgeTransportOptions) => ChildBridgeTransport;
};

export function getCurrentChildWindow(): ChildBridgeWindowLike {
  if (typeof window === 'undefined') {
    throw new IframeBridgeError('CONFIG_INVALID_CONTAINER', 'Window is required for child bridge.');
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

export function getCurrentParentWindow(): ChildBridgeParentWindowLike {
  if (typeof window === 'undefined' || window.parent === undefined) {
    throw new IframeBridgeError(
      'CONFIG_INVALID_CONTAINER',
      'Parent window is required for child bridge.',
    );
  }

  return window.parent;
}

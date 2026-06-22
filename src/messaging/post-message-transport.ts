import { validateBridgeEnvelope } from '../protocol/envelope.js';
import { IframeBridgeError } from '../shared/errors.js';
import type {
  BridgeEnvelope,
  BridgeConnectedEnvelope,
  BridgeEventEnvelope,
  BridgeReadyEnvelope,
  BridgeRequestEnvelope,
  BridgeResponseEnvelope,
} from '../types/index.js';

export type BridgeMessageEvent = {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
};

export type BridgeMessageListener = (event: BridgeMessageEvent) => void;

export type BridgeMessageErrorEvent = {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
};

export type BridgeMessageErrorListener = (event: BridgeMessageErrorEvent) => void;

export type BridgeTransportWindowLike = {
  addEventListener(type: 'message', listener: BridgeMessageListener): void;
  addEventListener(type: 'messageerror', listener: BridgeMessageErrorListener): void;
  removeEventListener(type: 'message', listener: BridgeMessageListener): void;
  removeEventListener(type: 'messageerror', listener: BridgeMessageErrorListener): void;
};

export type BridgeTransportTargetWindowLike = {
  postMessage(message: unknown, targetOrigin: string): void;
};

export type BridgeTransportSourceWindowResolver = () => unknown;

export type BridgeTransportTargetWindowResolver = () => BridgeTransportTargetWindowLike | null;

export type BridgeTransportInvalidMessageCode =
  | 'invalid_envelope'
  | 'message_error'
  | 'origin_mismatch'
  | 'session_mismatch'
  | 'source_mismatch';

export type BridgeTransportInvalidMessage =
  | {
      readonly actualOrigin: string;
      readonly code: 'origin_mismatch';
      readonly event: BridgeMessageEvent;
      readonly expectedOrigin: string;
      readonly reason: 'origin_mismatch';
    }
  | {
      readonly actualSource: unknown;
      readonly code: 'source_mismatch';
      readonly event: BridgeMessageEvent;
      readonly expectedSource: unknown;
      readonly reason: 'source_mismatch';
    }
  | {
      readonly code: 'invalid_envelope';
      readonly error: IframeBridgeError;
      readonly event: BridgeMessageEvent;
      readonly reason: 'invalid_envelope';
    }
  | {
      readonly actualOrigin: string;
      readonly code: 'message_error';
      readonly expectedOrigin: string;
      readonly expectedSourceAvailable: boolean;
      readonly originMatches: boolean;
      readonly reason: 'message_error';
      readonly sourceMatches: boolean;
    }
  | {
      readonly actualSessionId: string;
      readonly code: 'session_mismatch';
      readonly envelope: BridgeEnvelope;
      readonly event: BridgeMessageEvent;
      readonly expectedSessionId: string;
      readonly reason: 'session_mismatch';
    };

type BridgeTransportCommonOptions = {
  readonly expectedOrigin: string;
  readonly onConnected?: (envelope: BridgeConnectedEnvelope) => void;
  readonly onEvent?: (envelope: BridgeEventEnvelope) => void;
  readonly onInvalidMessage?: (message: BridgeTransportInvalidMessage) => void;
  readonly onReady?: (envelope: BridgeReadyEnvelope) => void;
  readonly onRequest?: (envelope: BridgeRequestEnvelope) => void;
  readonly onResponse?: (envelope: BridgeResponseEnvelope) => void;
  readonly parentWindow: BridgeTransportWindowLike;
  readonly sessionId: string;
  readonly targetOrigin: string;
};

type BridgeTransportStaticWindowOptions = {
  readonly resolveSourceWindow?: never;
  readonly resolveTargetWindow?: never;
  readonly sourceWindow: unknown;
  readonly targetWindow: BridgeTransportTargetWindowLike;
};

type BridgeTransportLazyWindowOptions = {
  readonly resolveSourceWindow: BridgeTransportSourceWindowResolver;
  readonly resolveTargetWindow: BridgeTransportTargetWindowResolver;
  readonly sourceWindow?: never;
  readonly targetWindow?: never;
};

export type BridgeTransportOptions = BridgeTransportCommonOptions &
  (BridgeTransportStaticWindowOptions | BridgeTransportLazyWindowOptions);

export class BridgeTransport {
  readonly #expectedOrigin: string;
  readonly #onConnected: ((envelope: BridgeConnectedEnvelope) => void) | undefined;
  readonly #onEvent: ((envelope: BridgeEventEnvelope) => void) | undefined;
  readonly #onInvalidMessage: ((message: BridgeTransportInvalidMessage) => void) | undefined;
  readonly #onReady: ((envelope: BridgeReadyEnvelope) => void) | undefined;
  readonly #onRequest: ((envelope: BridgeRequestEnvelope) => void) | undefined;
  readonly #onResponse: ((envelope: BridgeResponseEnvelope) => void) | undefined;
  readonly #parentWindow: BridgeTransportWindowLike;
  readonly #resolveSourceWindow: BridgeTransportSourceWindowResolver;
  readonly #resolveTargetWindow: BridgeTransportTargetWindowResolver;
  readonly #sessionId: string;
  readonly #targetOrigin: string;
  #isStarted = false;

  constructor(options: BridgeTransportOptions) {
    this.#expectedOrigin = options.expectedOrigin;
    this.#onConnected = options.onConnected;
    this.#onEvent = options.onEvent;
    this.#onInvalidMessage = options.onInvalidMessage;
    this.#onReady = options.onReady;
    this.#onRequest = options.onRequest;
    this.#onResponse = options.onResponse;
    this.#parentWindow = options.parentWindow;
    this.#resolveSourceWindow = createSourceWindowResolver(options);
    this.#resolveTargetWindow = createTargetWindowResolver(options);
    this.#sessionId = options.sessionId;
    this.#targetOrigin = options.targetOrigin;
  }

  start(): void {
    if (this.#isStarted) {
      return;
    }

    this.#parentWindow.addEventListener('message', this.#handleMessage);
    this.#parentWindow.addEventListener('messageerror', this.#handleMessageError);
    this.#isStarted = true;
  }

  stop(): void {
    if (!this.#isStarted) {
      return;
    }

    this.#parentWindow.removeEventListener('message', this.#handleMessage);
    this.#parentWindow.removeEventListener('messageerror', this.#handleMessageError);
    this.#isStarted = false;
  }

  post(envelope: BridgeEnvelope): void {
    if (this.#targetOrigin === '*') {
      throw new IframeBridgeError(
        'MESSAGE_TARGET_MISMATCH',
        'Bridge transport target origin must be exact.',
        { details: { targetOrigin: this.#targetOrigin } },
      );
    }

    const targetWindow = this.#resolveTargetWindow();

    if (targetWindow === null) {
      throw new IframeBridgeError(
        'MESSAGE_TARGET_MISMATCH',
        'Bridge transport target window is unavailable.',
        { details: { targetOrigin: this.#targetOrigin } },
      );
    }

    targetWindow.postMessage(validateBridgeEnvelope(envelope), this.#targetOrigin);
  }

  readonly #handleMessage = (event: BridgeMessageEvent): void => {
    if (event.origin !== this.#expectedOrigin) {
      this.#emitInvalidMessage({
        actualOrigin: event.origin,
        code: 'origin_mismatch',
        event,
        expectedOrigin: this.#expectedOrigin,
        reason: 'origin_mismatch',
      });
      return;
    }

    const expectedSource = this.#resolveSourceWindow();

    if (expectedSource == null || event.source !== expectedSource) {
      this.#emitInvalidMessage({
        actualSource: event.source,
        code: 'source_mismatch',
        event,
        expectedSource,
        reason: 'source_mismatch',
      });
      return;
    }

    const envelope = this.#validateEnvelope(event);

    if (envelope === undefined) {
      return;
    }

    if (envelope.sessionId !== this.#sessionId) {
      this.#emitInvalidMessage({
        actualSessionId: envelope.sessionId,
        code: 'session_mismatch',
        envelope,
        event,
        expectedSessionId: this.#sessionId,
        reason: 'session_mismatch',
      });
      return;
    }

    switch (envelope.type) {
      case 'bridge:ready':
        this.#onReady?.(envelope);
        return;
      case 'bridge:event':
        this.#onEvent?.(envelope);
        return;
      case 'bridge:request':
        this.#onRequest?.(envelope);
        return;
      case 'bridge:response':
        this.#onResponse?.(envelope);
        return;
      case 'bridge:connected':
        this.#onConnected?.(envelope);
        return;
      default:
        assertNever(envelope);
    }
  };

  readonly #handleMessageError = (event: BridgeMessageErrorEvent): void => {
    const expectedSource = this.#resolveSourceWindow();

    this.#emitInvalidMessage({
      actualOrigin: event.origin,
      code: 'message_error',
      expectedOrigin: this.#expectedOrigin,
      expectedSourceAvailable: expectedSource != null,
      originMatches: event.origin === this.#expectedOrigin,
      reason: 'message_error',
      sourceMatches: expectedSource != null && event.source === expectedSource,
    });
  };

  #validateEnvelope(event: BridgeMessageEvent): BridgeEnvelope | undefined {
    try {
      return validateBridgeEnvelope(event.data);
    } catch (error: unknown) {
      this.#emitInvalidMessage({
        code: 'invalid_envelope',
        error: toIframeBridgeError(error),
        event,
        reason: 'invalid_envelope',
      });
      return undefined;
    }
  }

  #emitInvalidMessage(message: BridgeTransportInvalidMessage): void {
    try {
      this.#onInvalidMessage?.(message);
    } catch {
      // Diagnostics must never turn ignored cross-origin noise into listener failures.
    }
  }
}

function createSourceWindowResolver(
  options: BridgeTransportOptions,
): BridgeTransportSourceWindowResolver {
  if ('resolveSourceWindow' in options) {
    return options.resolveSourceWindow;
  }

  return () => options.sourceWindow;
}

function createTargetWindowResolver(
  options: BridgeTransportOptions,
): BridgeTransportTargetWindowResolver {
  if ('resolveTargetWindow' in options) {
    return options.resolveTargetWindow;
  }

  return () => options.targetWindow;
}

function toIframeBridgeError(error: unknown): IframeBridgeError {
  if (error instanceof IframeBridgeError) {
    return error;
  }

  return new IframeBridgeError('MESSAGE_INVALID_ENVELOPE', 'Bridge message envelope is invalid.', {
    cause: error,
  });
}

function assertNever(value: never): never {
  throw new IframeBridgeError('MESSAGE_INVALID_ENVELOPE', 'Bridge message type is not handled.', {
    details: { value },
  });
}

export type IframeBridgeErrorCode =
  | 'CONFIG_INVALID_CONTAINER'
  | 'CONFIG_INVALID_SRC'
  | 'CONFIG_INVALID_QUEUE'
  | 'CONFIG_INVALID_RESIZE'
  | 'CONFIG_INVALID_SECURITY_PROFILE'
  | 'CONFIG_INVALID_TIMEOUT'
  | 'CONFIG_UNSAFE_ORIGIN'
  | 'CONFIG_UNSAFE_PERMISSIONS_POLICY'
  | 'CONFIG_UNSAFE_SANDBOX'
  | 'DIAGNOSTICS_INVALID_MAX_ENTRIES'
  | 'HANDSHAKE_TIMEOUT'
  | 'HANDSHAKE_ORIGIN_MISMATCH'
  | 'HANDSHAKE_SOURCE_MISMATCH'
  | 'HANDSHAKE_SESSION_MISMATCH'
  | 'HANDSHAKE_PROTOCOL_MISMATCH'
  | 'HANDSHAKE_VERSION_MISMATCH'
  | 'BRIDGE_NOT_READY'
  | 'BRIDGE_DESTROYED'
  | 'QUEUE_LIMIT_EXCEEDED'
  | 'QUEUE_CLOSED'
  | 'OPERATION_INVALID_TIMEOUT'
  | 'OPERATION_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_REMOTE_ERROR'
  | 'EVENT_WAIT_TIMEOUT'
  | 'MESSAGE_INVALID_ENVELOPE'
  | 'MESSAGE_TARGET_MISMATCH';

export type IframeBridgeErrorOptions = {
  details?: unknown;
  cause?: unknown;
};

export class IframeBridgeError extends Error {
  readonly code: IframeBridgeErrorCode;
  readonly details?: unknown;

  constructor(code: IframeBridgeErrorCode, message: string, options?: IframeBridgeErrorOptions) {
    super(message, options && 'cause' in options ? { cause: options.cause } : undefined);

    this.name = 'IframeBridgeError';
    this.code = code;

    if (options && 'details' in options) {
      this.details = options.details;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function createOperationAbortedError(details?: unknown): IframeBridgeError {
  return new IframeBridgeError('OPERATION_ABORTED', 'Bridge operation aborted.', {
    ...(details === undefined ? {} : { details }),
  });
}

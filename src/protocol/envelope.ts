import { IframeBridgeError } from '../shared/errors.js';
import type {
  BridgeEnvelope,
  BridgeEnvelopeError,
  BridgeMessageType,
  BridgeProtocolName,
  BridgeProtocolVersion,
} from '../types/index.js';

export const BRIDGE_PROTOCOL_NAME: BridgeProtocolName = 'iframe-bridge';
export const BRIDGE_PROTOCOL_VERSION: BridgeProtocolVersion = 1;
export const BRIDGE_MESSAGE_TYPES = [
  'bridge:ready',
  'bridge:connected',
  'bridge:event',
  'bridge:request',
  'bridge:response',
] as const satisfies readonly BridgeMessageType[];

const bridgeMessageTypes = new Set<string>(BRIDGE_MESSAGE_TYPES);

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  try {
    validateBridgeEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export function validateBridgeEnvelope(value: unknown): BridgeEnvelope {
  if (!isRecord(value)) {
    throw invalidEnvelope('Bridge message must be an object.', { value });
  }

  if (value.protocol !== BRIDGE_PROTOCOL_NAME) {
    throw invalidEnvelope('Bridge message protocol is invalid.', { protocol: value.protocol });
  }

  if (value.version !== BRIDGE_PROTOCOL_VERSION) {
    throw invalidEnvelope('Bridge message version is invalid.', { version: value.version });
  }

  if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') {
    throw invalidEnvelope('Bridge message session id is required.', { sessionId: value.sessionId });
  }

  if (!isBridgeMessageType(value.type)) {
    throw invalidEnvelope('Bridge message type is invalid.', { type: value.type });
  }

  switch (value.type) {
    case 'bridge:event':
      requireNonEmptyString(value.name, 'name');
      break;
    case 'bridge:request':
      requireNonEmptyString(value.requestId, 'requestId');
      requireNonEmptyString(value.name, 'name');
      break;
    case 'bridge:response':
      requireNonEmptyString(value.requestId, 'requestId');
      break;
    case 'bridge:connected':
    case 'bridge:ready':
      break;
    default:
      assertNever(value.type);
  }

  if (value.type === 'bridge:response' && hasOwn(value, 'error')) {
    // The envelope discriminator and required wire fields are validated above;
    // payload stays unknown by design because this SDK does not own app schemas.
    return {
      ...value,
      error: normalizeBridgeRemoteError(value.error),
    } as BridgeEnvelope;
  }

  // The envelope discriminator and required wire fields are validated above;
  // payload stays unknown by design because this SDK does not own app schemas.
  return value as BridgeEnvelope;
}

function requireNonEmptyString(value: unknown, field: string): void {
  if (typeof value === 'string' && value.trim() !== '') {
    return;
  }

  throw invalidEnvelope(`Bridge message ${field} is required.`, { [field]: value });
}

export function normalizeBridgeRemoteError(error: unknown): BridgeEnvelopeError {
  if (!isRecord(error)) {
    throw invalidEnvelope('Bridge remote error must be an object.', { error });
  }

  if (typeof error.code !== 'string' || error.code.trim() === '') {
    throw invalidEnvelope('Bridge remote error code is required.', { error });
  }

  if (typeof error.message !== 'string' || error.message.trim() === '') {
    throw invalidEnvelope('Bridge remote error message is required.', { error });
  }

  const normalized: BridgeEnvelopeError = {
    code: error.code,
    message: error.message,
  };

  if (hasOwn(error, 'data')) {
    normalized.data = error.data;
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBridgeMessageType(value: unknown): value is BridgeMessageType {
  return typeof value === 'string' && bridgeMessageTypes.has(value);
}

function hasOwn(value: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function invalidEnvelope(message: string, details: unknown): IframeBridgeError {
  return new IframeBridgeError('MESSAGE_INVALID_ENVELOPE', message, { details });
}

function assertNever(value: never): never {
  throw invalidEnvelope('Bridge message type is not handled.', { type: value });
}

import type { BridgeDiagnostics } from '../diagnostics/diagnostics.js';
import type { BridgeTransportInvalidMessage } from '../messaging/post-message-transport.js';
import { IframeBridgeError } from '../shared/errors.js';
import type { DiagnosticEvent } from '../types/index.js';
import type { NormalizedIframeBridgeConfig } from './config.js';

export function emitConfigWarnings(
  config: NormalizedIframeBridgeConfig,
  diagnostics: BridgeDiagnostics,
): void {
  for (const warning of config.warnings) {
    diagnostics.warn({ ...warning, sessionId: config.bootstrap.session.paramValue });
  }
}

export function createInvalidMessageDiagnostic(
  message: BridgeTransportInvalidMessage,
  sessionId: string,
): DiagnosticEvent {
  switch (message.reason) {
    case 'invalid_envelope':
      return {
        code: message.error.code,
        details: {
          errorCode: message.error.code,
          errorMessage: message.error.message,
          reason: message.reason,
        },
        message: 'Ignored invalid bridge message.',
        sessionId,
      };
    case 'message_error':
      return {
        code: 'MESSAGE_DESERIALIZATION_ERROR',
        details: {
          actualOrigin: message.actualOrigin,
          expectedOrigin: message.expectedOrigin,
          expectedSourceAvailable: message.expectedSourceAvailable,
          originMatches: message.originMatches,
          reason: message.reason,
          sourceMatches: message.sourceMatches,
        },
        message: 'Ignored browser messageerror event for a bridge message.',
        sessionId,
      };
    case 'origin_mismatch':
      return {
        code: 'MESSAGE_ORIGIN_MISMATCH',
        details: {
          actualOrigin: message.actualOrigin,
          expectedOrigin: message.expectedOrigin,
          reason: message.reason,
        },
        message: 'Ignored bridge message from an unexpected origin.',
        sessionId,
      };
    case 'session_mismatch':
      return {
        code: 'MESSAGE_SESSION_MISMATCH',
        details: {
          messageType: message.envelope.type,
          reason: message.reason,
        },
        message: 'Ignored bridge message for a different session.',
        sessionId,
      };
    case 'source_mismatch':
      return {
        code: 'MESSAGE_SOURCE_MISMATCH',
        details: {
          expectedSourceAvailable: message.expectedSource != null,
          reason: message.reason,
        },
        message: 'Ignored bridge message from an unexpected source window.',
        sessionId,
      };
    default:
      assertNever(message);
  }
}

export function createEventListenerErrorDiagnostic(
  error: unknown,
  name: string,
  sessionId: string,
): DiagnosticEvent {
  return {
    code: 'EVENT_LISTENER_ERROR',
    details: { errorName: getErrorName(error), name },
    message: 'Bridge event listener threw.',
    sessionId,
  };
}

function assertNever(value: never): never {
  throw new IframeBridgeError(
    'MESSAGE_INVALID_ENVELOPE',
    'Bridge diagnostic reason is not handled.',
    {
      details: { value },
    },
  );
}

function getErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== '') {
    return error.name;
  }

  return typeof error;
}

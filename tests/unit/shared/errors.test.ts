import { describe, expect, expectTypeOf, test } from 'vitest';

import {
  IframeBridgeError,
  type BridgeEnvelope,
  type BridgeMessageType,
  type IframeBridgeConfig,
  type IframeBridgeErrorCode,
  type LifecycleState,
  type OperationOptions,
} from '../../../src/index';

describe('IframeBridgeError', () => {
  test('preserves code, message, details, cause, and Error identity', () => {
    const cause = new Error('timer fired');
    const details = { timeoutMs: 1000 };

    const error = new IframeBridgeError('HANDSHAKE_TIMEOUT', 'Handshake timed out', {
      cause,
      details,
    });

    expect(error).toBeInstanceOf(IframeBridgeError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('IframeBridgeError');
    expect(error.message).toBe('Handshake timed out');
    expect(error.code).toBe('HANDSHAKE_TIMEOUT');
    expect(error.details).toBe(details);
    expect(error.cause).toBe(cause);
  });

  test('preserves the literal code when caught as an unknown error', () => {
    const code: IframeBridgeErrorCode = 'REQUEST_REMOTE_ERROR';

    try {
      throw new IframeBridgeError(code, 'Remote request failed');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IframeBridgeError);
      expect((error as IframeBridgeError).code).toBe('REQUEST_REMOTE_ERROR');
    }
  });

  test('exposes the public type contracts through the entrypoint', () => {
    expectTypeOf<LifecycleState>().toEqualTypeOf<
      'created' | 'mounting' | 'waiting_for_handshake' | 'ready' | 'handshake_failed' | 'destroyed'
    >();
    expectTypeOf<OperationOptions>().toEqualTypeOf<{ signal?: AbortSignal; timeoutMs?: number }>();
    expectTypeOf<BridgeMessageType>().toEqualTypeOf<
      'bridge:ready' | 'bridge:connected' | 'bridge:event' | 'bridge:request' | 'bridge:response'
    >();

    const config: IframeBridgeConfig = {
      container: '#frame-root',
      src: 'https://partner.example/app',
    };
    const envelope: BridgeEnvelope = {
      protocol: 'iframe-bridge',
      sessionId: 'session-1',
      type: 'bridge:ready',
      version: 1,
    };

    expectTypeOf(config).toMatchTypeOf<IframeBridgeConfig>();
    expectTypeOf(envelope).toMatchTypeOf<BridgeEnvelope>();
  });
});

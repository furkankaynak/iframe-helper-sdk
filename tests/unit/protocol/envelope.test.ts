import { describe, expect, test } from 'vitest';

import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';
import {
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_PROTOCOL_NAME,
  BRIDGE_PROTOCOL_VERSION,
  isBridgeEnvelope,
  normalizeBridgeRemoteError,
  validateBridgeEnvelope,
} from '../../../src/protocol/envelope';
import type { BridgeEnvelope, BridgeResponseEnvelope } from '../../../src/types';

const validReadyEnvelope = {
  protocol: 'iframe-bridge',
  sessionId: 'session-1',
  type: 'bridge:ready',
  version: 1,
} satisfies BridgeEnvelope;

describe('protocol constants', () => {
  test('defines the protocol name, version, and ready-first message types', () => {
    expect(BRIDGE_PROTOCOL_NAME).toBe('iframe-bridge');
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1);
    expect(BRIDGE_MESSAGE_TYPES).toEqual([
      'bridge:ready',
      'bridge:connected',
      'bridge:event',
      'bridge:request',
      'bridge:response',
    ]);
  });
});

describe('validateBridgeEnvelope', () => {
  test('accepts a valid minimal envelope', () => {
    expect(validateBridgeEnvelope(validReadyEnvelope)).toEqual(validReadyEnvelope);
    expect(isBridgeEnvelope(validReadyEnvelope)).toBe(true);
  });

  test.each([
    ['bridge:ready', {}],
    ['bridge:connected', {}],
    ['bridge:event', { name: 'event:name' }],
    ['bridge:request', { name: 'request:name', requestId: 'request-1' }],
    ['bridge:response', { requestId: 'request-1' }],
  ] as const)('accepts a valid %s envelope', (type, fields) => {
    expect(
      validateBridgeEnvelope({
        ...validReadyEnvelope,
        payload: { unvalidated: true },
        ...fields,
        type,
      }),
    ).toMatchObject({ type });
  });

  test.each([
    ['event missing name', { type: 'bridge:event' }],
    ['event empty name', { name: '', type: 'bridge:event' }],
    ['event blank name', { name: '   ', type: 'bridge:event' }],
    ['request missing request id', { name: 'request:name', type: 'bridge:request' }],
    ['request empty request id', { name: 'request:name', requestId: '', type: 'bridge:request' }],
    ['request missing name', { requestId: 'request-1', type: 'bridge:request' }],
    ['request empty name', { name: '', requestId: 'request-1', type: 'bridge:request' }],
    ['response missing request id', { type: 'bridge:response' }],
    ['response empty request id', { requestId: '', type: 'bridge:response' }],
  ])('rejects a %s', (_label, fields) => {
    expectInvalidEnvelope({
      ...validReadyEnvelope,
      ...fields,
    });
  });

  test('rejects the wrong protocol', () => {
    expectInvalidEnvelope({
      ...validReadyEnvelope,
      protocol: 'other-protocol',
    });
  });

  test('rejects the wrong version', () => {
    expectInvalidEnvelope({
      ...validReadyEnvelope,
      version: 2,
    });
  });

  test.each([undefined, '', '   '])('rejects a missing session id %s', (sessionId) => {
    expectInvalidEnvelope({
      ...validReadyEnvelope,
      sessionId,
    });
  });

  test('rejects unknown message types', () => {
    expectInvalidEnvelope({
      ...validReadyEnvelope,
      type: 'bridge:unknown',
    });
  });

  test.each([
    undefined,
    null,
    'remote failed',
    { code: 'REMOTE_FAILED' },
    { message: 'Remote failed' },
    { code: '', message: 'Remote failed' },
    { code: 'REMOTE_FAILED', message: '' },
  ])('rejects malformed remote errors when present: %s', (error) => {
    expectInvalidEnvelope({
      ...validReadyEnvelope,
      error,
      requestId: 'request-1',
      type: 'bridge:response',
    });
  });

  test('returns a stable remote error shape on bridge responses', () => {
    const envelope = validateBridgeEnvelope({
      ...validReadyEnvelope,
      error: {
        code: 'REMOTE_FAILED',
        data: { reason: 'denied' },
        message: 'Remote failed',
        stack: 'not part of the wire contract',
      },
      requestId: 'request-1',
      type: 'bridge:response',
    }) as BridgeResponseEnvelope;

    expect(envelope).toMatchObject({
      error: {
        code: 'REMOTE_FAILED',
        data: { reason: 'denied' },
        message: 'Remote failed',
      },
    });
    expect(envelope.error).not.toHaveProperty('stack');
  });
});

describe('normalizeBridgeRemoteError', () => {
  test('normalizes code, message, and optional data', () => {
    expect(
      normalizeBridgeRemoteError({
        code: 'REMOTE_FAILED',
        data: ['detail'],
        message: 'Remote failed',
        name: 'IgnoredErrorName',
      }),
    ).toEqual({
      code: 'REMOTE_FAILED',
      data: ['detail'],
      message: 'Remote failed',
    });
  });
});

function expectInvalidEnvelope(value: unknown): void {
  try {
    validateBridgeEnvelope(value);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(
      'MESSAGE_INVALID_ENVELOPE',
    );
    expect(isBridgeEnvelope(value)).toBe(false);
    return;
  }

  throw new Error('Expected MESSAGE_INVALID_ENVELOPE');
}

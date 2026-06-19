import { afterEach, describe, expect, test, vi } from 'vitest';

import { RequestCoordinator } from '../../../src/messaging/request-coordinator';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';
import type { BridgeEnvelopeError } from '../../../src/types';

describe('RequestCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('generates request ids and tracks pending requests', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-a', 'request-b']),
    });

    const first = coordinator.createRequest<string>(1000);
    const second = coordinator.createRequest<string>(1000);

    expect(first.requestId).toBe('request-a');
    expect(second.requestId).toBe('request-b');
    expect(coordinator.pendingCount).toBe(2);
    expect(vi.getTimerCount()).toBe(2);

    expect(coordinator.resolve(first.requestId, 'one')).toBe(true);
    expect(coordinator.resolve(second.requestId, 'two')).toBe(true);

    await expect(first.promise).resolves.toBe('one');
    await expect(second.promise).resolves.toBe('two');
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('resolves a pending request with the first success response', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-1']),
    });
    const request = coordinator.createRequest<{ ok: boolean }>(1000);

    expect(coordinator.resolve(request.requestId, { ok: true })).toBe(true);
    expect(coordinator.resolve(request.requestId, { ok: false })).toBe(false);

    await expect(request.promise).resolves.toEqual({ ok: true });
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('rejects a pending request when its timeout elapses', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-timeout']),
    });
    const request = coordinator.createRequest(50);
    const rejection = expectBridgeRejection(request.promise, 'REQUEST_TIMEOUT');

    await vi.advanceTimersByTimeAsync(49);

    expect(coordinator.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    const error = await rejection;
    expect(error.details).toEqual({ requestId: 'request-timeout', timeoutMs: 50 });
    expect(coordinator.pendingCount).toBe(0);
    expect(coordinator.resolve(request.requestId, 'late')).toBe(false);
  });

  test('rejects an active request when its signal aborts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-abort']),
    });
    const request = coordinator.createRequest(1000, { signal: controller.signal });
    const rejection = expectBridgeRejection(request.promise, 'OPERATION_ABORTED');

    expect(coordinator.pendingCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();

    const error = await rejection;

    expect(error.details).toEqual({ requestId: 'request-abort' });
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(coordinator.resolve(request.requestId, 'late')).toBe(false);
  });

  test('throws OPERATION_ABORTED without creating a pending request for an already aborted signal', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const coordinator = new RequestCoordinator();

    controller.abort();

    expectBridgeThrow(
      () => coordinator.createRequest(1000, { signal: controller.signal }),
      'OPERATION_ABORTED',
    );
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('rejects a pending request with a typed remote error', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-remote-error']),
    });
    const remoteError = {
      code: 'REMOTE_DENIED',
      data: { reason: 'denied' },
      message: 'Remote denied the request',
    } satisfies BridgeEnvelopeError;
    const request = coordinator.createRequest(1000);
    const rejection = expectBridgeRejection(request.promise, 'REQUEST_REMOTE_ERROR');

    expect(coordinator.rejectRemote(request.requestId, remoteError)).toBe(true);

    const error = await rejection;
    expect(error.message).toBe('Remote denied the request');
    expect(error.details).toEqual({ requestId: 'request-remote-error', remoteError });
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('ignores duplicate and late responses after the first response wins', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-duplicate']),
    });
    const request = coordinator.createRequest<string>(1000);

    expect(coordinator.resolve(request.requestId, 'first')).toBe(true);
    expect(coordinator.resolve(request.requestId, 'second')).toBe(false);
    expect(
      coordinator.rejectRemote(request.requestId, {
        code: 'REMOTE_TOO_LATE',
        message: 'Remote response arrived too late',
      }),
    ).toBe(false);

    await expect(request.promise).resolves.toBe('first');
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('ignores duplicate and late responses after a remote error wins first', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-remote-wins']),
    });
    const remoteError = {
      code: 'REMOTE_FAILED',
      message: 'Remote failed first',
    } satisfies BridgeEnvelopeError;
    const request = coordinator.createRequest<string>(1000);
    const rejection = expectBridgeRejection(request.promise, 'REQUEST_REMOTE_ERROR');

    expect(coordinator.rejectRemote(request.requestId, remoteError)).toBe(true);
    expect(coordinator.resolve(request.requestId, 'late success')).toBe(false);
    expect(
      coordinator.rejectRemote(request.requestId, {
        code: 'REMOTE_TOO_LATE',
        message: 'Remote response arrived too late',
      }),
    ).toBe(false);

    const error = await rejection;
    expect(error.message).toBe('Remote failed first');
    expect(error.details).toEqual({ requestId: 'request-remote-wins', remoteError });
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('rejects all pending requests on destroy and ignores later responses', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-one', 'request-two']),
    });
    const first = coordinator.createRequest(1000);
    const second = coordinator.createRequest(1000);
    const firstRejection = expectBridgeRejection(first.promise, 'BRIDGE_DESTROYED');
    const secondRejection = expectBridgeRejection(second.promise, 'BRIDGE_DESTROYED');

    coordinator.rejectAll();

    await Promise.all([firstRejection, secondRejection]);
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(coordinator.resolve(first.requestId, 'late')).toBe(false);
    expect(
      coordinator.rejectRemote(second.requestId, {
        code: 'REMOTE_TOO_LATE',
        message: 'Remote response arrived too late',
      }),
    ).toBe(false);
  });

  test('discards a pending request without settling its promise', async () => {
    vi.useFakeTimers();
    const coordinator = new RequestCoordinator({
      createRequestId: createRequestIdSequence(['request-discard']),
    });
    const request = coordinator.createRequest<string>(1000);
    let didSettle = false;

    request.promise.then(
      () => {
        didSettle = true;
      },
      () => {
        didSettle = true;
      },
    );

    expect(coordinator.discard(request.requestId)).toBe(true);

    await Promise.resolve();

    expect(didSettle).toBe(false);
    expect(coordinator.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(coordinator.resolve(request.requestId, 'late')).toBe(false);
    expect(coordinator.discard(request.requestId)).toBe(false);
  });

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects an invalid %s timeout', (_label, timeoutMs) => {
    const coordinator = new RequestCoordinator();

    expectBridgeThrow(() => coordinator.createRequest(timeoutMs), 'OPERATION_INVALID_TIMEOUT');
  });
});

function createRequestIdSequence(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    if (id === undefined) {
      throw new Error('No request id configured for test.');
    }

    index += 1;
    return id;
  };
}

async function expectBridgeRejection(
  promise: Promise<unknown>,
  code: IframeBridgeErrorCode,
): Promise<IframeBridgeError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
    return error as IframeBridgeError;
  }

  throw new Error(`Expected ${code}`);
}

function expectBridgeThrow(run: () => unknown, code: IframeBridgeErrorCode): IframeBridgeError {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
    return error as IframeBridgeError;
  }

  throw new Error(`Expected ${code}`);
}

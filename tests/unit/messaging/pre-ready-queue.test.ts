import { describe, expect, test } from 'vitest';

import { PreReadyQueue } from '../../../src/messaging/pre-ready-queue';
import { IframeBridgeError, type IframeBridgeErrorCode } from '../../../src/shared/errors';

describe('PreReadyQueue', () => {
  test.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects an invalid %s max size', (_label, maxSize) => {
    expectBridgeThrow(() => new PreReadyQueue<string>({ maxSize }), 'CONFIG_INVALID_QUEUE');
  });

  test('does not run operations until flush and flushes them in FIFO order', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 3 });
    const calls: string[] = [];

    const first = queue.enqueue(() => {
      calls.push('first');
      return 'one';
    });
    const second = queue.enqueue(() => {
      calls.push('second');
      return Promise.resolve('two');
    });

    expect(queue.size).toBe(2);
    expect(calls).toEqual([]);

    queue.flush();

    await expect(first).resolves.toBe('one');
    await expect(second).resolves.toBe('two');
    expect(calls).toEqual(['first', 'second']);
    expect(queue.size).toBe(0);
  });

  test('rejects overflow with QUEUE_LIMIT_EXCEEDED without running the operation', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 1 });
    let overflowRan = false;

    const queued = queue.enqueue(() => 'queued');
    const overflow = queue.enqueue(() => {
      overflowRan = true;
      return 'overflow';
    });

    await expectBridgeRejection(overflow, 'QUEUE_LIMIT_EXCEEDED');
    expect(queue.size).toBe(1);

    queue.flush();

    await expect(queued).resolves.toBe('queued');
    expect(overflowRan).toBe(false);
  });

  test('rejects and removes a queued operation when its signal aborts before flush', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 2 });
    const controller = new AbortController();
    const calls: string[] = [];

    const cancelled = queue.enqueue(
      () => {
        calls.push('cancelled');
        return 'cancelled';
      },
      { signal: controller.signal },
    );
    const retained = queue.enqueue(() => {
      calls.push('retained');
      return 'retained';
    });

    controller.abort();

    await expectBridgeRejection(cancelled, 'OPERATION_ABORTED');
    expect(queue.size).toBe(1);

    queue.flush();

    await expect(retained).resolves.toBe('retained');
    expect(calls).toEqual(['retained']);
  });

  test('rejects all queued operations with the close error without running them', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 2 });
    const closeError = new IframeBridgeError('BRIDGE_DESTROYED', 'Bridge destroyed before ready');
    const calls: string[] = [];

    const first = queue.enqueue(() => {
      calls.push('first');
      return 'one';
    });
    const second = queue.enqueue(() => {
      calls.push('second');
      return 'two';
    });

    queue.close(closeError);

    await Promise.all([
      expect(first).rejects.toBe(closeError),
      expect(second).rejects.toBe(closeError),
    ]);
    expect(calls).toEqual([]);
    expect(queue.size).toBe(0);
  });

  test('rejects new operations after close with QUEUE_CLOSED by default', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 1 });

    queue.close();

    await expectBridgeRejection(
      queue.enqueue(() => 'late'),
      'QUEUE_CLOSED',
    );
  });

  test('rejects new operations after close with the provided close error', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 1 });
    const closeError = new IframeBridgeError('HANDSHAKE_TIMEOUT', 'Handshake timed out');

    queue.close(closeError);

    await expect(queue.enqueue(() => 'late')).rejects.toBe(closeError);
  });

  test('does not rerun operations on a second flush', async () => {
    const queue = new PreReadyQueue<number>({ maxSize: 1 });
    let runs = 0;

    const result = queue.enqueue(() => {
      runs += 1;
      return runs;
    });

    queue.flush();
    queue.flush();

    await expect(result).resolves.toBe(1);
    expect(runs).toBe(1);
  });

  test('runs operations enqueued after flush immediately', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 1 });
    const calls: string[] = [];

    queue.flush();

    const result = queue.enqueue(() => {
      calls.push('late');
      return 'ready';
    });

    expect(calls).toEqual(['late']);
    await expect(result).resolves.toBe('ready');
    expect(queue.size).toBe(0);
  });

  test('rejects the queued promise when a flushed operation throws', async () => {
    const queue = new PreReadyQueue<string>({ maxSize: 1 });
    const operationError = new Error('operation failed');

    const result = queue.enqueue(() => {
      throw operationError;
    });

    queue.flush();

    await expect(result).rejects.toBe(operationError);
  });
});

function expectBridgeThrow(run: () => unknown, code: IframeBridgeErrorCode): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
    return;
  }

  throw new Error(`Expected ${code}`);
}

async function expectBridgeRejection(
  promise: Promise<unknown>,
  code: IframeBridgeErrorCode,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(IframeBridgeError);
    expect((error as IframeBridgeError).code satisfies IframeBridgeErrorCode).toBe(code);
    return;
  }

  throw new Error(`Expected ${code}`);
}

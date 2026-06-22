import { describe, expect, test, vi } from 'vitest';

import type {
  BridgeEventEnvelope,
  BridgePluginContext,
  BridgePluginHandle,
  IframeBridgeResizeEvent,
} from '../../../src/types';
import { resizePlugin } from '../../../src/host/resize-plugin';
import { IframeBridgeError } from '../../../src/shared/errors';

const resizeEventName = 'iframe-bridge:resize';

describe('resizePlugin', () => {
  test('claims the reserved resize event name', () => {
    const handle = makeHandle({});

    expect(handle.events).toEqual([resizeEventName]);
  });

  test('applies valid width and height after ready when resize is enabled by default', () => {
    const iframe = createFakeIframe();
    const handle = makeHandle({});

    handle.onEvent(eventEnvelope({ height: 480, width: 720 }), pluginContext(iframe));

    expect(iframe.style.width).toBe('720px');
    expect(iframe.style.height).toBe('480px');
  });

  test('honors axis by applying only the requested dimension', () => {
    const iframe = createFakeIframe();
    const handle = makeHandle({ axis: 'height' });

    handle.onEvent(eventEnvelope({ height: 480, width: 720 }), pluginContext(iframe));

    expect(iframe.style.width).toBe('');
    expect(iframe.style.height).toBe('480px');
  });

  test('clamps width and height against min and max bounds with offsets', () => {
    const iframe = createFakeIframe();
    const handle = makeHandle({
      maxHeightPx: 900,
      maxWidthPx: 1200,
      minHeightPx: 240,
      minWidthPx: 320,
      offsetHeightPx: 50,
      offsetWidthPx: -100,
    });

    handle.onEvent(eventEnvelope({ height: 880, width: 350 }), pluginContext(iframe));

    expect(iframe.style.width).toBe('320px');
    expect(iframe.style.height).toBe('900px');
  });

  test('invokes onResize with requested and applied dimensions', () => {
    const iframe = createFakeIframe();
    const onResize = vi.fn();
    const handle = makeHandle({
      maxHeightPx: 900,
      minWidthPx: 320,
      offsetHeightPx: 50,
      offsetWidthPx: -100,
      onResize,
    });

    handle.onEvent(eventEnvelope({ height: 880, width: 350 }), pluginContext(iframe));

    expect(onResize).toHaveBeenCalledWith({
      height: 900,
      requestedHeight: 880,
      requestedWidth: 350,
      width: 320,
    } satisfies IframeBridgeResizeEvent);
  });

  test('skips applying dimensions when resize is disabled', () => {
    const iframe = createFakeIframe();
    const onResize = vi.fn();
    const handle = makeHandle({ enabled: false, onResize });

    handle.onEvent(eventEnvelope({ height: 480, width: 720 }), pluginContext(iframe));

    expect(iframe.style.width).toBe('');
    expect(iframe.style.height).toBe('');
    expect(onResize).not.toHaveBeenCalled();
  });

  test('warns and leaves styles unchanged when the payload is invalid', () => {
    const iframe = createFakeIframe();
    const warnings: WarningsSink = [];
    const ctx = pluginContext(iframe, { warn: (event) => warnings.push(event) });
    const handle = makeHandle({});

    handle.onEvent(eventEnvelope({ width: '720' }), ctx);

    expect(iframe.style.width).toBe('');
    expect(iframe.style.height).toBe('');
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'RESIZE_INVALID_PAYLOAD',
        sessionId: 'session-1',
      }),
    ]);
  });

  test('warns but still applies dimensions when onResize throws', () => {
    const iframe = createFakeIframe();
    const warnings: WarningsSink = [];
    const ctx = pluginContext(iframe, { warn: (event) => warnings.push(event) });
    const handle = makeHandle({
      onResize() {
        throw new Error('consumer callback failed');
      },
    });

    expect(() => {
      handle.onEvent(eventEnvelope({ height: 480, width: 720 }), ctx);
    }).not.toThrow();

    expect(iframe.style.width).toBe('720px');
    expect(iframe.style.height).toBe('480px');
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'RESIZE_CALLBACK_ERROR',
        sessionId: 'session-1',
      }),
    ]);
  });

  test('rejects an invalid axis during plugin creation', () => {
    expect(() => resizePlugin({ axis: 'diagonal' as never })).toThrow(IframeBridgeError);
  });

  test('rejects an invalid resize bound during plugin creation', () => {
    expect(() => resizePlugin({ maxWidthPx: 1.5 })).toThrow(IframeBridgeError);
  });

  test('rejects an invalid resize offset during plugin creation', () => {
    expect(() => resizePlugin({ offsetWidthPx: Number.NaN })).toThrow(IframeBridgeError);
  });

  test('rejects a non-function onResize during plugin creation', () => {
    expect(() => resizePlugin({ onResize: 'not-a-function' as never })).toThrow(IframeBridgeError);
  });

  test('rejects min greater than max bounds during plugin creation', () => {
    expect(() => resizePlugin({ axis: 'width', maxWidthPx: 320, minWidthPx: 640 })).toThrow(
      IframeBridgeError,
    );
  });

  test('throws for an object payload of the wrong shape without mutating styles', () => {
    const iframe = createFakeIframe();
    const warnings: WarningsSink = [];
    const ctx = pluginContext(iframe, { warn: (event) => warnings.push(event) });
    const handle = makeHandle({});

    handle.onEvent(eventEnvelope('not-an-object-payload'), ctx);

    expect(iframe.style.width).toBe('');
    expect(iframe.style.height).toBe('');
    expect(warnings).toEqual([expect.objectContaining({ code: 'RESIZE_INVALID_PAYLOAD' })]);
  });
});

type WarningsSink = { code?: string; details?: unknown; sessionId?: string }[];

function makeHandle(config: Parameters<typeof resizePlugin>[0] = {}): BridgePluginHandle {
  return resizePlugin(config)();
}

function createFakeIframe(): HTMLIFrameElement {
  return new FakeIframe() as unknown as HTMLIFrameElement;
}

function pluginContext(
  iframe: HTMLIFrameElement,
  overrides?: Partial<BridgePluginContext>,
): BridgePluginContext {
  return {
    iframe,
    sessionId: 'session-1',
    warn: () => undefined,
    ...overrides,
  };
}

function eventEnvelope(payload: unknown, name = resizeEventName): BridgeEventEnvelope {
  return {
    name,
    payload,
    protocol: 'iframe-bridge',
    sessionId: 'session-1',
    type: 'bridge:event',
    version: 1,
  };
}

class FakeIframe {
  readonly style: { width: string; height: string } = { width: '', height: '' };
}

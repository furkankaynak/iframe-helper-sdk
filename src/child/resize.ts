import type {
  IframeBridgeResizeAxis,
  IframeBridgeResizePayload,
  IframeChildBridgePlugin,
} from '../types/index.js';

const IFRAME_BRIDGE_RESIZE_EVENT = 'iframe-bridge:resize';

export type IframeChildResizeConfig = {
  readonly axis?: IframeBridgeResizeAxis;
  readonly element?: Element;
};

export function childResizePlugin(config: IframeChildResizeConfig = {}): IframeChildBridgePlugin {
  const axis = normalizeResizeAxis(config.axis);
  const configuredElement = config.element;

  return ({ bridge, sessionId, warn }) => {
    let observer: ResizeObserver | undefined;
    let lastPayload: IframeBridgeResizePayload | undefined;

    const readElement = () => configuredElement ?? globalThis.document?.documentElement;
    const sendResize = () => {
      const element = readElement();

      if (element === undefined) {
        warn({
          code: 'RESIZE_TARGET_UNAVAILABLE',
          message: 'Child resize target element is unavailable.',
          sessionId,
        });
        return;
      }

      const payload = readResizePayload(element, axis);

      if (lastPayload !== undefined && isSamePayload(lastPayload, payload)) {
        return;
      }

      lastPayload = payload;
      void bridge.sendEvent(IFRAME_BRIDGE_RESIZE_EVENT, payload).catch((error: unknown) => {
        warn({
          code: 'RESIZE_SEND_FAILED',
          details: error,
          message: 'Child resize event failed.',
          sessionId,
        });
      });
    };

    return {
      onConnected() {
        sendResize();

        const element = readElement();

        if (element === undefined || typeof globalThis.ResizeObserver !== 'function') {
          return;
        }

        observer = new globalThis.ResizeObserver(sendResize);
        observer.observe(element);
      },
      destroy() {
        observer?.disconnect();
        observer = undefined;
      },
    };
  };
}

function normalizeResizeAxis(axis: IframeBridgeResizeAxis | undefined): IframeBridgeResizeAxis {
  if (axis === undefined || axis === 'both' || axis === 'height' || axis === 'width') {
    return axis ?? 'both';
  }

  throw new TypeError('Child resize axis must be width, height, or both.');
}

function readResizePayload(
  element: Element,
  axis: IframeBridgeResizeAxis,
): IframeBridgeResizePayload {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  if (axis === 'width') {
    return { width };
  }

  if (axis === 'height') {
    return { height };
  }

  return { height, width };
}

function isSamePayload(
  previous: IframeBridgeResizePayload,
  next: IframeBridgeResizePayload,
): boolean {
  return previous.height === next.height && previous.width === next.width;
}

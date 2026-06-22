import { IframeBridgeError } from '../shared/errors.js';
import type {
  BridgePlugin,
  BridgePluginContext,
  IframeBridgeResizeAxis,
  IframeBridgeResizeConfig,
  IframeBridgeResizeEvent,
} from '../types/index.js';

const IFRAME_BRIDGE_RESIZE_EVENT = 'iframe-bridge:resize';

type NormalizedResize = {
  readonly axis: IframeBridgeResizeAxis;
  readonly enabled: boolean;
  readonly maxHeightPx: number | undefined;
  readonly maxWidthPx: number | undefined;
  readonly minHeightPx: number | undefined;
  readonly minWidthPx: number | undefined;
  readonly offsetHeightPx: number;
  readonly offsetWidthPx: number;
  readonly onResize: IframeBridgeResizeConfig['onResize'];
};

export function resizePlugin(config: IframeBridgeResizeConfig): BridgePlugin {
  const normalized = normalizeResizeConfig(config);

  return () => ({
    events: [IFRAME_BRIDGE_RESIZE_EVENT],
    onEvent(envelope, ctx) {
      applyResize(envelope.payload, ctx, normalized);
    },
  });
}

function applyResize(payload: unknown, ctx: BridgePluginContext, resize: NormalizedResize): void {
  if (!resize.enabled) {
    return;
  }

  const dimensions = readResizeDimensions(payload, resize.axis);

  if (dimensions === undefined) {
    ctx.warn({
      code: 'RESIZE_INVALID_PAYLOAD',
      details: createInvalidPayloadDetails(payload, resize.axis),
      message: 'Iframe resize event payload is invalid.',
      sessionId: ctx.sessionId,
    });
    return;
  }

  const event: IframeBridgeResizeEvent = {
    ...(dimensions.height === undefined
      ? {}
      : {
          height: applyResizeTransform(
            dimensions.height,
            resize.offsetHeightPx,
            resize.minHeightPx,
            resize.maxHeightPx,
          ),
          requestedHeight: dimensions.height,
        }),
    ...(dimensions.width === undefined
      ? {}
      : {
          requestedWidth: dimensions.width,
          width: applyResizeTransform(
            dimensions.width,
            resize.offsetWidthPx,
            resize.minWidthPx,
            resize.maxWidthPx,
          ),
        }),
  };

  if (event.width !== undefined) {
    ctx.iframe.style.width = `${event.width}px`;
  }

  if (event.height !== undefined) {
    ctx.iframe.style.height = `${event.height}px`;
  }

  const callbackErrorDetails = callResizeCallback(resize.onResize, event);

  if (callbackErrorDetails !== undefined) {
    ctx.warn({
      code: 'RESIZE_CALLBACK_ERROR',
      details: callbackErrorDetails,
      message: 'Iframe resize callback failed.',
      sessionId: ctx.sessionId,
    });
  }
}

function normalizeResizeConfig(resize: IframeBridgeResizeConfig): NormalizedResize {
  const normalized = {
    axis: normalizeResizeAxis(resize.axis),
    enabled: resize.enabled ?? true,
    maxHeightPx: normalizeResizeBound(resize.maxHeightPx, 'maxHeightPx'),
    maxWidthPx: normalizeResizeBound(resize.maxWidthPx, 'maxWidthPx'),
    minHeightPx: normalizeResizeBound(resize.minHeightPx, 'minHeightPx'),
    minWidthPx: normalizeResizeBound(resize.minWidthPx, 'minWidthPx'),
    offsetHeightPx: normalizeResizeOffset(resize.offsetHeightPx, 'offsetHeightPx'),
    offsetWidthPx: normalizeResizeOffset(resize.offsetWidthPx, 'offsetWidthPx'),
    onResize: normalizeResizeCallback(resize.onResize),
  };

  validateResizeBounds(normalized.minWidthPx, normalized.maxWidthPx, 'width');
  validateResizeBounds(normalized.minHeightPx, normalized.maxHeightPx, 'height');

  return Object.freeze(normalized);
}

function normalizeResizeAxis(axis: IframeBridgeResizeAxis | undefined): IframeBridgeResizeAxis {
  if (axis === undefined || axis === 'both' || axis === 'height' || axis === 'width') {
    return axis ?? 'both';
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_RESIZE',
    'Resize axis must be width, height, or both.',
    { details: { axis } },
  );
}

function normalizeResizeBound(bound: number | undefined, name: string): number | undefined {
  if (bound === undefined) {
    return undefined;
  }

  if (Number.isInteger(bound) && bound >= 0) {
    return bound;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_RESIZE',
    'Resize bounds must be non-negative integers.',
    { details: { bound, name } },
  );
}

function validateResizeBounds(
  min: number | undefined,
  max: number | undefined,
  axis: 'width' | 'height',
): void {
  if (min === undefined || max === undefined || min <= max) {
    return;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_RESIZE',
    'Resize minimum bound must be less than or equal to the maximum bound.',
    { details: { axis, max, min } },
  );
}

function normalizeResizeOffset(offset: number | undefined, name: string): number {
  if (offset === undefined) {
    return 0;
  }

  if (Number.isInteger(offset)) {
    return offset;
  }

  throw new IframeBridgeError('CONFIG_INVALID_RESIZE', 'Resize offsets must be finite integers.', {
    details: { name, offset },
  });
}

function normalizeResizeCallback(
  onResize: IframeBridgeResizeConfig['onResize'] | undefined,
): IframeBridgeResizeConfig['onResize'] {
  if (onResize === undefined || typeof onResize === 'function') {
    return onResize;
  }

  throw new IframeBridgeError(
    'CONFIG_INVALID_RESIZE',
    'Resize onResize callback must be a function.',
    { details: { onResizeType: typeof onResize } },
  );
}

type ResizeDimensions = {
  readonly height?: number;
  readonly width?: number;
};

type ResizeDimension = keyof ResizeDimensions;

function readResizeDimensions(
  payload: unknown,
  axis: IframeBridgeResizeAxis,
): ResizeDimensions | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const width = readResizeDimension(payload, 'width', axis);
  const height = readResizeDimension(payload, 'height', axis);

  if (width === null || height === null) {
    return undefined;
  }

  if (width === undefined && height === undefined) {
    return undefined;
  }

  return {
    ...(height === undefined ? {} : { height }),
    ...(width === undefined ? {} : { width }),
  };
}

function readResizeDimension(
  payload: Record<string, unknown>,
  dimension: ResizeDimension,
  axis: IframeBridgeResizeAxis,
): number | null | undefined {
  if (!isDimensionEnabled(dimension, axis)) {
    return undefined;
  }

  const value = payload[dimension];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return null;
}

function isDimensionEnabled(dimension: ResizeDimension, axis: IframeBridgeResizeAxis): boolean {
  return axis === 'both' || axis === dimension;
}

function applyResizeTransform(
  requested: number,
  offset: number,
  min: number | undefined,
  max: number | undefined,
): number {
  return clamp(requested + offset, min ?? 0, max);
}

function clamp(value: number, min: number, max: number | undefined): number {
  let clamped = Math.max(value, min);

  if (max !== undefined) {
    clamped = Math.min(clamped, max);
  }

  return clamped;
}

function callResizeCallback(
  onResize: IframeBridgeResizeConfig['onResize'] | undefined,
  event: IframeBridgeResizeEvent,
): unknown {
  if (onResize === undefined) {
    return undefined;
  }

  try {
    onResize(event);
    return undefined;
  } catch (error) {
    return createCallbackErrorDetails(error, event);
  }
}

function createCallbackErrorDetails(
  error: unknown,
  event: IframeBridgeResizeEvent,
): Record<string, unknown> {
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    ...event,
  };
}

function createInvalidPayloadDetails(
  payload: unknown,
  axis: IframeBridgeResizeAxis,
): Record<string, string> {
  return {
    axis,
    ...(isRecord(payload)
      ? {
          heightType: typeof payload.height,
          payloadType: 'object',
          widthType: typeof payload.width,
        }
      : { payloadType: typeof payload }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

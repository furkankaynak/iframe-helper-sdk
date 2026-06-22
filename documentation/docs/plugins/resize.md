---
slug: /plugins/resize
sidebar_label: Resize Plugin
toc_max_heading_level: 3
description: Configure the optional resize plugin so an iframe can request parent-applied width and height changes safely.
---

# Resize Plugin

The resize plugin lets the iframe request pixel width and height changes for the SDK-owned iframe
element. It is opt-in and tree-shakable: import it from `iframe-helper-sdk/resize`, then register it
through `options.plugins` on the parent bridge.

Use it when embedded content changes size after load, such as forms, dashboards, checkout flows, or
partner widgets with dynamic sections.

---

## Parent Setup

```ts
import { createIframeBridge } from 'iframe-helper-sdk';
import { resizePlugin } from 'iframe-helper-sdk/resize';

const bridge = createIframeBridge(
  {
    container: '#partner-frame',
    src: 'https://partner.example/app',
    securityProfile: 'strict',
  },
  {
    plugins: [
      resizePlugin({
        axis: 'both',
        minWidthPx: 320,
        maxWidthPx: 1200,
        minHeightPx: 240,
        maxHeightPx: 900,
        offsetHeightPx: 16,
        onResize({ width, height, requestedWidth, requestedHeight }) {
          console.log({ width, height, requestedWidth, requestedHeight });
        },
      }),
    ],
  },
);

await bridge.whenReady();
```

`resizePlugin()` or `resizePlugin({})` enables both axes with no bounds. That is useful for local
experiments, but production integrations should set max bounds for every active axis.

---

## Iframe Event

After the iframe receives `bridge:connected`, send a standard `bridge:event` named
`iframe-bridge:resize`. The snippets below use `postToParent()` from the
[Wire Protocol iframe integration guide](/wire-protocol#iframe-integration-guide); that
helper adds `protocol`, `version`, `sessionId`, and the exact parent target origin.

```js
postToParent({
  type: 'bridge:event',
  name: 'iframe-bridge:resize',
  payload: { width: 800, height: 640 },
});
```

Payload fields:

| Field    | Type     | Description                                  |
| -------- | -------- | -------------------------------------------- |
| `width`  | `number` | Requested iframe width in pixels. Optional.  |
| `height` | `number` | Requested iframe height in pixels. Optional. |

At least one active dimension must be present. Dimensions must be finite, non-negative numbers.
Invalid resize payloads are ignored and reported through diagnostics as `RESIZE_INVALID_PAYLOAD`
when diagnostics are configured.

Send one resize event immediately after `bridge:connected`, then send again whenever content
dimensions change.

---

## Iframe Example With ResizeObserver

```js
let connected = false;
let lastResize = '';

function sendResize() {
  if (!connected) return;

  const width = Math.ceil(
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  );
  const height = Math.ceil(
    Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  );
  const nextResize = `${width}x${height}`;

  if (nextResize === lastResize) return;
  lastResize = nextResize;

  postToParent({
    type: 'bridge:event',
    name: 'iframe-bridge:resize',
    payload: { width, height },
  });
}

const resizeObserver = new ResizeObserver(sendResize);
resizeObserver.observe(document.documentElement);

// In your bridge message handler:
if (envelope.type === 'bridge:connected') {
  connected = true;
  sendResize();
}
```

---

## Options

```ts
type IframeBridgeResizeConfig = {
  enabled?: boolean;
  axis?: 'width' | 'height' | 'both';
  minWidthPx?: number;
  maxWidthPx?: number;
  minHeightPx?: number;
  maxHeightPx?: number;
  offsetWidthPx?: number;
  offsetHeightPx?: number;
  onResize?: (event: IframeBridgeResizeEvent) => void;
};

type IframeBridgeResizeEvent = {
  readonly width?: number;
  readonly height?: number;
  readonly requestedWidth?: number;
  readonly requestedHeight?: number;
};
```

| Option           | Default                       | Description                                            |
| ---------------- | ----------------------------- | ------------------------------------------------------ |
| `resizePlugin()` | not registered (disabled)     | Resize is disabled unless the parent registers it.     |
| `enabled`        | `true` when plugin is present | Ignore resize events while keeping the event claimed.  |
| `axis`           | `'both'`                      | Active dimensions: `'width'`, `'height'`, or `'both'`. |
| `minWidthPx`     | `undefined`                   | Lower clamp for applied width.                         |
| `maxWidthPx`     | `undefined`                   | Upper clamp for applied width.                         |
| `minHeightPx`    | `undefined`                   | Lower clamp for applied height.                        |
| `maxHeightPx`    | `undefined`                   | Upper clamp for applied height.                        |
| `offsetWidthPx`  | `0`                           | Fixed pixels added to requested width before bounds.   |
| `offsetHeightPx` | `0`                           | Fixed pixels added to requested height before bounds.  |
| `onResize`       | `undefined`                   | Callback after final dimensions are applied.           |

Bounds must be non-negative integers. A minimum cannot be greater than its matching maximum. Offsets
may be positive, negative, or zero, but must be finite integers.

---

## Axis And Bounds

`axis` controls which payload fields can change iframe style:

- `'both'` applies `width` and `height`.
- `'width'` applies only `width` and ignores `height`.
- `'height'` applies only `height` and ignores `width`.

For production, set max bounds for every active axis:

| Axis       | Required production max bounds |
| ---------- | ------------------------------ |
| `'width'`  | `maxWidthPx`                   |
| `'height'` | `maxHeightPx`                  |
| `'both'`   | `maxWidthPx` and `maxHeightPx` |

The SDK applies dimensions in this order:

1. Validate payload dimensions.
2. Filter inactive axes.
3. Add `offsetWidthPx` and/or `offsetHeightPx`.
4. Clamp to configured min/max bounds.
5. Apply `iframe.style.width` and/or `iframe.style.height`.
6. Call `onResize` with final and requested dimensions.

If an offset would make a dimension negative, the final style value is clamped to `0px` unless you
configured a higher minimum bound.

---

## Security Behavior

The parent validates origin, source window, session id, protocol, version, and envelope shape before
the resize plugin sees the event. The plugin then validates the resize payload before changing iframe
styles.

Security profile behavior for missing active max bounds:

| Profile         | Behavior                                                             |
| --------------- | -------------------------------------------------------------------- |
| `'development'` | Emits `CONFIG_UNBOUNDED_RESIZE` through diagnostics when configured. |
| `'strict'`      | Throws `CONFIG_INVALID_RESIZE` during bridge creation.               |

Treat iframe dimensions as untrusted layout input. Bounds are a layout safety control, not an auth
or payload-validation boundary.

---

## Diagnostics

| Code                      | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `CONFIG_UNBOUNDED_RESIZE` | Resize is enabled without max bounds for every active dimension.          |
| `RESIZE_INVALID_PAYLOAD`  | The iframe sent an invalid `iframe-bridge:resize` payload; it is ignored. |
| `RESIZE_CALLBACK_ERROR`   | `onResize` threw; the resize remains applied.                             |

Use `createDiagnosticRecorder()` during integration if you want to inspect these warnings.

---

## Event Claiming

When `resizePlugin()` is registered, it claims the reserved `iframe-bridge:resize` event name. That
event is consumed by the plugin and is not delivered to `bridge.on()` or `bridge.waitForEvent()`.

This is true even for `resizePlugin({ enabled: false })`: the event remains reserved and suppressed,
but no dimensions are applied.

---

## Related Reference

- [Plugin Overview](/plugins)
- [Configuration](/configuration#plugin-options)
- [Wire Protocol](/wire-protocol#reserved-resize-event)
- [Security](/security#plugin-trust-boundary)
- [API Reference](/api-reference#resize-types)

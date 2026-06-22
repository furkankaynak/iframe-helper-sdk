---
slug: /child/resize
sidebar_label: Resize
toc_max_heading_level: 3
description: Tree-shakable child iframe resize plugin usage from iframe-helper-sdk/child/resize, paired with the parent resize plugin.
---

# Child Resize

The child resize plugin is a tree-shakable helper for iframe apps that want to report their content dimensions to a parent bridge. It is the child-side companion to the parent [Resize Plugin](/plugins/resize).

---

## Import Path

Child resize must be imported from `iframe-helper-sdk/child/resize`, not `iframe-helper-sdk/child`.

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';
import { childResizePlugin } from 'iframe-helper-sdk/child/resize';
```

Keeping resize on a dedicated subpath prevents the base child bridge from including resize behavior unless the iframe app opts in. The base `iframe-helper-sdk/child` import stays small and does not include the plugin's `ResizeObserver` code; consumers can audit whether resize is present by checking for the `iframe-helper-sdk/child/resize` import path.

---

## Basic Usage

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';
import { childResizePlugin } from 'iframe-helper-sdk/child/resize';

const bridge = createIframeChildBridge(
  { allowedParentOrigins: ['https://host.example'] },
  { plugins: [childResizePlugin({ axis: 'both' })] },
);
```

The plugin uses the established child bridge connection and posts resize events to the accepted parent origin. The parent must also register `resizePlugin()` from `iframe-helper-sdk/resize` to apply those dimensions to the iframe element.

---

## Parent Pairing

```ts
import { createIframeBridge } from 'iframe-helper-sdk';
import { resizePlugin } from 'iframe-helper-sdk/resize';

const bridge = createIframeBridge(
  {
    container: '#partner-frame',
    src: 'https://iframe.example/app',
    securityProfile: 'strict',
  },
  {
    plugins: [
      resizePlugin({
        axis: 'both',
        maxWidthPx: 1200,
        maxHeightPx: 900,
      }),
    ],
  },
);
```

Set parent-side bounds for every active axis before using resize with untrusted or partner iframes. The child reports requested dimensions; the parent decides what is actually applied.

---

## Protocol Behavior

Resize is implemented through the normal `bridge:event` path with the reserved `iframe-bridge:resize` event name. The raw wire protocol remains canonical for the event envelope and validation rules.

The child SDK still uses exact target origins. No wildcard target origin is used in normal operation, and the session id remains correlation metadata only.

---

## Runtime Behavior

The plugin waits for the child bridge connection before sending resize events. It does not post dimensions before `bridge:connected`, because the accepted parent origin and session-scoped bridge must be established first.

After connection:

1. It sends one initial `iframe-bridge:resize` event.
2. It observes content size changes with `ResizeObserver`.
3. It suppresses unchanged dimensions so the parent does not receive duplicate resize events.
4. It disconnects observers when the child bridge is destroyed.

The payload depends on the configured axis:

| Axis       | Payload shape       |
| ---------- | ------------------- |
| `'width'`  | `{ width }`         |
| `'height'` | `{ height }`        |
| `'both'`   | `{ width, height }` |

Use `'both'` for dynamic app shells, `'height'` for fixed-width embeds, and `'width'` only when parent layout allows child-driven width changes.

---

## ResizeObserver Example

The plugin owns the observer lifecycle; app code only registers it:

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';
import { childResizePlugin } from 'iframe-helper-sdk/child/resize';

const bridge = createIframeChildBridge(
  { allowedParentOrigins: ['https://host.example'] },
  {
    plugins: [
      childResizePlugin({
        axis: 'height',
      }),
    ],
  },
);

await bridge.whenConnected();
```

If your iframe app cannot install the child SDK, use the raw reserved resize event documented in [Wire Protocol](/wire-protocol#reserved-resize-event).

---

## When To Use It

Use the child resize plugin when:

- The iframe app can install `iframe-helper-sdk`.
- The parent wants child-driven width, height, or both.
- You want resize behavior to stay outside the base child bridge bundle.

Use the raw protocol instead when the iframe app cannot import the SDK. In that case, send the reserved `iframe-bridge:resize` event manually as described in [Wire Protocol](/wire-protocol#reserved-resize-event).

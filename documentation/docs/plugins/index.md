---
id: plugins
slug: /plugins
sidebar_label: Overview
toc_max_heading_level: 3
description: How iframe-helper-sdk plugins extend bridge behavior while keeping optional features tree-shakable and outside the core bundle.
---

# Plugins

Plugins let optional parent-side behavior subscribe to reserved iframe events without adding that
behavior to the core `iframe-helper-sdk` entry point. The first plugin shipped by the SDK is the
[Resize Plugin](/plugins/resize), exported from `iframe-helper-sdk/resize`.

Use plugins when a behavior is:

- Optional for most integrations.
- Triggered by iframe events after the bridge handshake.
- Better kept out of the core bundle for tree-shaking.
- Specific enough to deserve its own public subpath export.

---

## Registering Plugins

Plugins are passed as the optional second argument to `createIframeBridge()` or
`createTypedIframeBridge()`:

```ts
import { createIframeBridge } from 'iframe-helper-sdk';
import { resizePlugin } from 'iframe-helper-sdk/resize';

const bridge = createIframeBridge(
  {
    container: '#partner-frame',
    src: 'https://partner.example/app',
  },
  {
    plugins: [
      resizePlugin({
        maxWidthPx: 1200,
        maxHeightPx: 900,
      }),
    ],
  },
);
```

The core package import stays small. Optional runtime code is loaded only when you import a plugin
subpath such as `iframe-helper-sdk/resize`.

---

## How Plugin Events Work

Each plugin returns the event names it claims. When a validated `bridge:event` arrives from the
iframe, the SDK checks plugin claims before user listeners:

1. The parent validates the message origin, source window, session id, protocol, version, and
   envelope shape.
2. If a registered plugin claims the event name, that plugin receives the event.
3. Claimed plugin events are consumed and are not delivered to `bridge.on()` or
   `bridge.waitForEvent()` listeners.
4. Unclaimed events continue through the normal user listener flow.

This keeps reserved SDK behavior from accidentally reaching application event handlers.

---

## Trust Boundary

Plugins are trusted parent-side code. The SDK validates the transport and envelope before calling a
plugin, but each plugin owns its own payload semantics. Treat iframe-provided plugin payloads as
untrusted input until the plugin validates them.

For example, `resizePlugin()` treats iframe dimensions as child-controlled layout input. In
production, configure max bounds for every active resize axis so the iframe cannot force unreasonable
layout changes.

---

## Public API

The public plugin contract is exposed through `IframeBridgeOptions` and the `BridgePlugin*` types:

```ts
type IframeBridgeOptions = {
  plugins?: readonly BridgePlugin[];
};

type BridgePlugin = (ctx: BridgePluginSetupContext) => BridgePluginHandle;
```

Most integrations should use documented plugins instead of implementing custom plugins directly.
Custom plugins are possible, but the plugin type is a low-level extension point: prefer application
events (`bridge.on`, `bridge.sendEvent`, `bridge.request`) unless you need reserved SDK-level event
handling.

---

## Available Plugins

- **[Resize Plugin](/plugins/resize)** — lets the iframe request parent-applied width and height updates
  through the reserved `iframe-bridge:resize` event.

For the complete type reference, see [API Reference](/api-reference#full-type-reference).

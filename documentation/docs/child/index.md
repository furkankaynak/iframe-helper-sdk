---
slug: /child
sidebar_label: Overview
toc_max_heading_level: 3
description: Use the child iframe SDK from inside an embedded iframe application to complete the bridge handshake, send events, receive parent events, and handle parent requests.
---

# Child Iframe SDK

The child iframe SDK is an optional runtime for the application loaded **inside** the iframe. It wraps the same canonical [Wire Protocol](/wire-protocol) used by raw iframe integrations, but removes the boilerplate for reading bootstrap parameters, completing the handshake, validating the parent origin, routing events, and responding to parent requests.

Use it when your iframe app can install `iframe-helper-sdk`. If the iframe app cannot or should not import the package, keep implementing the [raw wire protocol](/wire-protocol#iframe-integration-guide) directly.

---

## Install And Import

The child SDK is exposed through a public subpath export:

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';
```

Do not import child APIs from the package root or internal `src`/`dist` paths.

---

## Opt-In Resize And Tree Shaking

The base `iframe-helper-sdk/child` import stays focused on the child bridge runtime: handshake, origin validation, events, and parent request handlers. Child resize behavior is split into `iframe-helper-sdk/child/resize`, so resize logic and `ResizeObserver` usage are not pulled in unless the iframe app imports that subpath.

This makes optional behavior explicit and easier to audit. Consumers can review bundle impact by import path: keep `iframe-helper-sdk/child` for the base bridge, and add `iframe-helper-sdk/child/resize` only when the child iframe needs to report content dimensions to the parent.

---

## Quick Start

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';

const bridge = createIframeChildBridge({
  allowedParentOrigins: ['https://host.example'],
});

await bridge.whenConnected();
await bridge.sendEvent('cart:changed', { itemCount: 3 });
bridge.on('theme:changed', (payload) => {});
bridge.handleRequest('user:get', async (payload) => ({ name: 'Ada' }));
bridge.destroy();
```

`whenConnected()` resolves after the child sends `bridge:ready` and receives the parent's `bridge:connected` acknowledgement. After that point, application events can flow in both directions and parent-initiated requests can be handled by the child.

---

## What It Does

The child bridge:

- Reads the session id and parent origin from the bootstrap URL parameters.
- Validates the parent origin against `allowedParentOrigins` when configured.
- Sends `bridge:ready` to the exact parent origin.
- Waits for `bridge:connected` from the same origin and session.
- Sends child-to-parent `bridge:event` messages with `sendEvent()`.
- Dispatches parent-to-child `bridge:event` messages to `on()` listeners.
- Responds to parent `bridge:request` messages registered with `handleRequest()`.
- Removes listeners and plugin resources when `destroy()` is called.

The child bridge does **not** create an iframe element. It runs inside an iframe that the parent already embedded.

---

## No Child-To-Parent RPC

The MVP child SDK does not expose `request()` and does not initiate `bridge:request` messages. Child request handlers respond to parent `bridge:request`; the child does not initiate `bridge:request`.

Use `sendEvent()` when the child needs to notify the parent. If the child needs a parent acknowledgement, model that as an application-level event flow for now rather than child-to-parent RPC.

---

## Security Defaults

```ts
createIframeChildBridge({
  allowedParentOrigins: ['https://host.example'],
});
```

`allowedParentOrigins?: readonly string[] | null` controls which parent origins the child SDK accepts:

- Omitted or `null` accepts the bootstrap parent origin.
- Non-empty arrays require exact origin match.
- Empty arrays are invalid.
- Omitted allowlist relies on server-side/browser embedding controls such as CSP `frame-ancestors`.

The SDK never uses wildcard target origins in normal operation. Once the parent origin is accepted, child-to-parent messages are posted back to that exact origin.

See [Child Security](/child/security) and the main [Security](/security) guide before shipping cross-domain iframe apps.

---

## Related Pages

- [Child Security](/child/security) covers `allowedParentOrigins`, CSP `frame-ancestors`, and session id boundaries.
- [Events And Requests](/child/events-and-requests) covers `sendEvent()`, `on()`, and `handleRequest()`.
- [Child Plugins](/child/plugins) explains the child-side plugin boundary.
- [Child Resize](/child/resize) covers `iframe-helper-sdk/child/resize`.
- [Wire Protocol](/wire-protocol) remains the canonical low-level protocol spec.

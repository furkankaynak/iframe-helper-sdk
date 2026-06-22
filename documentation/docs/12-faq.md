---
sidebar_position: 13
slug: faq
toc_max_heading_level: 3
description: Answers to the most common questions about iframe-helper-sdk — framework compatibility, SSR, sandboxing, security, bundle size, migration, and more.
---

# FAQ

Quick answers to the questions we hear most. If you don't see yours here, the [Troubleshooting](./troubleshooting) page covers diagnostic workflows, and [Error Codes](./error-codes) catalogs every error the SDK can throw.

---

## Can I use this with React, Vue, Svelte, or Angular?

Yes. The SDK is framework-agnostic. It only needs a DOM element (or selector) and a URL — you supply the container, the SDK creates the iframe, and you get back a plain `IframeBridge` object you can use from anywhere.

```ts
// Inside any framework lifecycle
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#partner-root',
  src: 'https://partner.example/app',
});
```

In React, call `createIframeBridge` inside a `useEffect` and store the bridge in a `useRef`. In Vue, call it in `onMounted`. In Svelte, call it in `onMount`. The pattern is the same: create the bridge once the DOM is ready, clean it up when the component unmounts.

The SDK does not wrap its API in React components, Vue composables, or Angular services — it stays a plain TypeScript library so it works everywhere.

---

## What if the iframe doesn't support the bridge protocol?

Nothing breaks. The iframe loads normally, and the bridge transitions to `handshake_failed` after `bootstrap.handshakeTimeoutMs` (default 10 seconds).

This is a normal integration outcome — not every iframe needs the bridge. The parent SDK detects the missing protocol by timeout, and you can handle it in your application:

```ts
try {
  await bridge.whenReady();
  // Bridge is active — communicate normally
} catch (error) {
  if (error instanceof IframeBridgeError && error.code === 'HANDSHAKE_TIMEOUT') {
    // Iframe doesn't support the bridge protocol — that's fine
    console.log('Bridge not supported, iframe is loaded as a static embed');
  }
}
```

The iframe stays mounted and visible. The bridge simply won't accept communication calls — `request` and `sendEvent` will fail with `BRIDGE_DESTROYED` if you let the handshake fail without a remount.

---

## How do I embed multiple iframes?

Call `createIframeBridge` once per iframe. Each call returns an independent bridge instance — they don't share state, listeners, or queues.

```ts
const partnerBridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

const chatBridge = createIframeBridge({
  container: '#chat-frame',
  src: 'https://chat.example/widget',
});

await partnerBridge.whenReady();
await chatBridge.whenReady();
```

Each bridge gets a unique session ID, so messages are routed to the correct instance. A `bridge:ready` from the partner iframe won't trigger the chat bridge, and an event from the chat iframe won't leak into the partner bridge.

There is no per-page limit — create as many as your containers and CSP allow. See [Configuration](./configuration) for the full options you can tune per iframe.

---

## Can I pass authentication tokens?

You can include any data in `request` and `sendEvent` payloads:

```ts
await bridge.request('user:get', {
  id: '123',
  token: sessionToken,
});
```

**However**, we strongly recommend handling authentication server-side instead:

- If the iframe app is on your domain, a `SameSite` cookie sent with the iframe request is the simplest approach.
- If the iframe app is cross-domain, use a server-to-server token exchange or a dedicated auth endpoint inside the iframe.
- The bridge session ID is **not** an auth token — it's correlation metadata only (see below).
- Client-side JavaScript cannot protect a token from XSS in either the parent or the iframe.

Treat any token you send through the bridge as observable by the iframe document, by any scripts running in the iframe, and by anyone inspecting the parent's memory.

---

## Does this work with sandboxed iframes?

Yes, with caveats. Sandbox tokens can change the iframe origin and break exact-origin message validation:

- **Without `allow-same-origin`**, a sandboxed iframe sends `event.origin === 'null'`. The SDK rejects this because `allowedOrigin` must be an exact HTTPS origin. You cannot use the bridge with a sandbox that omits `allow-same-origin`.
- **With `allow-scripts` + `allow-same-origin`**, the SDK emits a `CONFIG_UNSAFE_SANDBOX` diagnostics warning in `development` security profile. This combination removes most of the isolation sandboxing provides, but it's required if the iframe needs JavaScript and you want origin-based routing.

```ts
const bridge = createIframeBridge({
  container: '#sandboxed-frame',
  src: 'https://partner.example/app',
  targetOrigin: 'https://partner.example',
  allowedOrigin: 'https://partner.example',
  securityProfile: 'development', // Allows the reviewed combination
  sandbox: ['allow-scripts', 'allow-same-origin'],
  diagnostics: {
    logger: createDiagnosticRecorder({ maxEntries: 100 }).logger,
  },
});
```

In `strict` security profile, the `allow-scripts` + `allow-same-origin` combination throws `CONFIG_UNSAFE_SANDBOX`. Only use development profile when this combination has been reviewed and documented for your integration.

See the [Security](./security) page for the full security model and the [Configuration](./configuration#sandbox) page for sandbox details.

---

## Is the session ID a security token?

**No.** The session ID is correlation and routing metadata only.

It identifies one bridge attempt so the parent can match inbound messages to the correct bridge instance. It is:

- **Not** authentication
- **Not** authorization
- **Not** a CSRF token
- **Not** a secret
- **Not** proof that the iframe is trusted

Every message is still validated against exact origin, source window, protocol name, and protocol version — the session ID alone does not grant access. If you set a custom `bootstrap.session.paramValue`, treat it like any other URL parameter: observable, not confidential.

Real authentication belongs server-side, in your application layer, outside this generic transport bridge.

---

## What's the bundle size?

The current build produces:

| Format | Size   | Gzipped |
| ------ | ------ | ------- |
| ESM    | ~37 kB | ~9.5 kB |
| CJS    | ~28 kB | ~8.3 kB |

The SDK has zero runtime dependencies — you aren't pulling in a framework, a schema library, or a utility belt. The gzipped ESM payload (the one modern bundlers tree-shake) is under 10 kB.

The package publishes both ESM and CJS, with TypeScript declarations. Your bundler picks the right one automatically through the `exports` map in `package.json`.

---

## Does this work with SSR / Next.js?

The SDK is browser-only. It calls `document.querySelector`, creates `HTMLIFrameElement`, and listens for `message` events on `window` — none of these exist at build time or during server-side rendering.

**In Next.js (Pages Router):** Import and use the SDK inside a `useEffect` so it only runs on the client:

```tsx
import { useEffect, useRef } from 'react';
import type { IframeBridge } from 'iframe-helper-sdk';

export default function PartnerPage() {
  const bridgeRef = useRef<IframeBridge | null>(null);

  useEffect(() => {
    const { createIframeBridge } = require('iframe-helper-sdk');
    bridgeRef.current = createIframeBridge({
      container: '#partner-frame',
      src: 'https://partner.example/app',
    });
    return () => bridgeRef.current?.destroy();
  }, []);

  return <div id="partner-frame" />;
}
```

**In Next.js (App Router):** Mark the component with `'use client'` and follow the same pattern.

**In Nuxt / SvelteKit / other SSR frameworks:** Mount the bridge in a client-only lifecycle hook (`onMounted`, `onMount`, `browser` check, etc.). The principle is the same: delay `createIframeBridge` until `document` and `window` are available.

The import itself is side-effect-free — you can `import type` the types at the top of any file without triggering browser-only code.

---

## Can I resize the iframe?

Yes. For parent-controlled sizing, the SDK exposes the owned iframe element (`bridge.iframe`), so you can resize it directly:

```ts
await bridge.whenReady();
bridge.iframe.style.width = '800px';
bridge.iframe.style.height = '600px';
```

For child-driven cross-domain sizing, register `resizePlugin()` in the parent options and have the iframe send the reserved `iframe-bridge:resize` event:

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
        minHeightPx: 240,
        maxHeightPx: 900,
        offsetHeightPx: 16,
        onResize({ width, height }) {
          console.log('applied iframe size', width, height);
        },
      }),
    ],
  },
);
```

```js
postToParent({
  type: 'bridge:event',
  name: 'iframe-bridge:resize',
  payload: { width: 800, height: 640 },
});
```

The parent still validates the message through the normal bridge chain before applying dimensions. Use min/max bounds so the iframe cannot force unreasonable layout changes. Use `offsetWidthPx` and `offsetHeightPx` when the parent needs fixed extra pixels around iframe content, and use `onResize` to observe final applied dimensions.

The iframe should send one resize immediately after `bridge:connected`, then send again whenever content dimensions change.

---

## Does the SDK provide a focus trap?

No. Focus trapping is an advanced app-level accessibility concern, not a core bridge feature.

If an iframe is displayed inside a modal, drawer, or overlay, your parent app and iframe app should manage focus placement, `Escape` handling, ARIA state, and focus restoration. Cross-origin iframes usually require cooperation from both sides because the parent cannot inspect or control the iframe document's tabbable elements.

You can use the bridge's event/request APIs to coordinate focus-related lifecycle signals, but the SDK does not enforce keyboard behavior or guarantee WCAG conformance.

---

## Can I intercept or modify messages?

No. The SDK does not expose hooks for intercepting, modifying, filtering, or rewriting messages.

Diagnostics are **observation only** — the diagnostic recorder and logger hooks tell you what happened, but they don't change it:

```ts
const recorder = createDiagnosticRecorder({ maxEntries: 100 });

const bridge = createIframeBridge({
  container: '#frame-root',
  src: 'https://partner.example/app',
  diagnostics: {
    debug: true,
    logger: recorder.logger,
  },
});

// recorder.entries shows every diagnostic event — but you can't change messages through it
console.table(recorder.entries);
```

The recorder captures lifecycle events, rejected messages, configuration warnings, and listener errors. It does **not** include raw `postMessage` payloads or application event data — diagnostics are sanitized by default.

If you need message-level control (allowlists, rate limiting, validation), those are on the security roadmap for a future release. For now, the bridge is a transport — your application logic determines what to send and how to respond.

---

## How do I migrate from raw postMessage?

If you're already using `window.postMessage` directly, here's a step-by-step migration:

### Step 1: Create a bridge instead of managing the iframe by hand

Before (raw):

```ts
const iframe = document.createElement('iframe');
iframe.src = 'https://partner.example/app';
document.getElementById('frame-root')!.appendChild(iframe);

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://partner.example') return;
  // ... manual routing, session tracking, timeout handling
});
```

After:

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#frame-root',
  src: 'https://partner.example/app',
});

await bridge.whenReady();
```

The SDK handles iframe creation, origin validation, source-window checks, session routing, and duplicate rejection for you.

### Step 2: Replace manual request/response logic

Before (raw):

```ts
const requestId = crypto.randomUUID();
iframe.contentWindow.postMessage(
  { type: 'getUser', id: requestId, payload: { userId: '123' } },
  'https://partner.example',
);

// Manual pending-request map, timeout timer, response matching...
```

After:

```ts
const user = await bridge.request<{ userId: string }, { name: string }>('user:get', {
  userId: '123',
});
```

The SDK manages `requestId` generation, pending-request tracking, timeout timers, and first-response-only deduplication.

### Step 3: Replace manual event listeners

Before (raw):

```ts
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://partner.example') return;
  const data = JSON.parse(event.data);
  if (data.type === 'cartChanged') {
    handleCartChange(data.payload);
  }
});
```

After:

```ts
bridge.on<{ itemCount: number }>('cart:changed', (payload) => {
  console.log(payload.itemCount);
});
```

Continuous listeners get automatic cleanup on `bridge.destroy()`. One-shot waits use `bridge.waitForEvent`.

### Step 4: Adopt the iframe protocol in the iframe app

If your iframe app currently sends raw `postMessage` calls, update it to follow the [Wire Protocol](./wire-protocol) envelope format. The iframe does not need to import this SDK — it only needs to:

1. Read `__iframeBridgeSessionId` and `__iframeBridgeParentOrigin` from the URL
2. Send a `bridge:ready` envelope to the exact parent origin
3. Wait for `bridge:connected` before sending application messages
4. Use the documented envelope shape for events and request responses

### What you drop

After migration, you no longer need:

- Manual iframe element creation and lifecycle management
- `addEventListener('message', ...)` with manual origin/source/session filtering
- Custom `requestId` generation, pending-request maps, and timeout timers
- Duplicate-message guards
- Cleanup logic for timers, listeners, and pending operations
- Custom error types for timeout, abort, and destroyed states

All of that is handled by the SDK with a stable, tested implementation.

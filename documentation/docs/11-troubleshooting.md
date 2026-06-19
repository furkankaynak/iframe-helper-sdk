---
sidebar_position: 12
slug: troubleshooting
toc_max_heading_level: 3
description: Step-by-step diagnostic flows for common integration problems — handshake failures, origin mismatches, CSP issues, and communication errors.
---

# Troubleshooting

Something's not working. This page helps you figure out what — then fix it.

Start with the [diagnostic recorder](./debugging#using-the-diagnostic-recorder). It tells you exactly what the SDK sees: which handshake messages arrived, which were rejected, and why. Most problems become obvious once you read the diagnostic output.

Diagnostic approach, in order:

1. **Check bridge state** — `bridge.state` tells you where in the lifecycle things stopped.
2. **Check diagnostics** — `createDiagnosticRecorder` reveals every rejected message and why.
3. **Check your config** — compare against the [configuration reference](./configuration).
4. **Check the iframe integration** — the iframe must follow the [wire protocol](./wire-protocol).

For a reference of every error code and its recovery action, see [Error Codes](./error-codes).

---

## Bridge Never Becomes Ready

`bridge.whenReady()` stays pending. You never get past the handshake.

### Decision tree

1. **What is `bridge.state`?**
   - `'created'` or `'mounting'` → The iframe hasn't started loading yet. Wait briefly — if it stays here for more than a few seconds, the iframe URL may be unreachable.
   - `'waiting_for_handshake'` → The iframe is mounted but hasn't sent a valid `bridge:ready`. Proceed to step 2.
   - `'handshake_failed'` → The timer expired. Check diagnostics for rejection reasons (step 3).
   - `'ready'` → The bridge is ready. Your `await bridge.whenReady()` should have resolved — if not, check whether you're awaiting the same bridge instance.

2. **Is the iframe even loaded?**
   - Open the browser's Network tab and look for the iframe URL — a 404, CORS error, or navigation failure prevents the iframe from running.
   - Open the Elements tab and confirm the iframe element exists in the DOM. Check that `src` is populated.
   - If the iframe loads but doesn't send `bridge:ready`, the iframe app may not implement the bridge protocol. This is a normal outcome. The SDK detects it via `HANDSHAKE_TIMEOUT`.

3. **Enable diagnostics and look for rejection reasons.**

   ```ts
   import {
     createIframeBridge,
     createDiagnosticRecorder,
   } from '@furkankaynak/iframe-helper-sdk';

   const recorder = createDiagnosticRecorder({ maxEntries: 100 });

   const bridge = createIframeBridge({
     container: '#frame-root',
     src: 'https://partner.example/app',
     diagnostics: {
       debug: true,
       logger: recorder.logger,
     },
   });

   try {
     await bridge.whenReady();
   } catch {
     console.table(recorder.entries);
     // Look for MESSAGE_ORIGIN_MISMATCH, MESSAGE_SESSION_MISMATCH,
     // MESSAGE_INVALID_ENVELOPE, or complete absence of messages
   }
   ```

4. **Messages received but rejected?** Match the diagnostic code to the fix:

   | Diagnostic code | What happened | Fix |
   |---|---|---|
   | `MESSAGE_ORIGIN_MISMATCH` | Message came from an origin that doesn't match `allowedOrigin`. | See [Origin mismatch](#origin-mismatch) below. |
   | `MESSAGE_SESSION_MISMATCH` | Session id in the message doesn't match this bridge instance. | See [Handshake timeout](#handshake-timeout) — the iframe isn't echoing the correct session. |
   | `MESSAGE_SOURCE_MISMATCH` | Message came from a window that isn't the owned iframe. | Another iframe or script is posting messages. Check for multiple bridges or nested iframes. |
   | `MESSAGE_INVALID_ENVELOPE` | Message matched transport but envelope shape is wrong. | The iframe's envelope doesn't match the [wire protocol spec](./wire-protocol#envelope). Check `protocol`, `version`, `type`, and required fields. |

5. **No messages at all in diagnostics?**
   - The iframe never called `postMessage`. Verify it reads the bootstrap parameters and knows the parent origin.
   - The parent's CSP `frame-src` directive may be blocking the iframe from loading. Check the browser console for CSP violation reports.
   - `targetOrigin` on the iframe side may be wrong — the iframe must post to the exact parent origin (not `'*'`, not a substring match).

:::tip Start with the diagnostic recorder

Every troubleshooting path on this page becomes faster when you wire up `createDiagnosticRecorder`. You'll see exactly which messages the SDK received and exactly why each was accepted or rejected. See [Debugging & Diagnostics](./debugging) for setup.

:::

---

## Handshake Timeout

The bridge entered `handshake_failed` because no valid `bridge:ready` arrived within `bootstrap.handshakeTimeoutMs` (default: 10 seconds).

### Iframe-side checklist

If you control the iframe application, verify each of these in order:

1. **The iframe reads the bootstrap parameters.** The SDK appends `__iframeBridgeSessionId` and `__iframeBridgeParentOrigin` to the iframe URL by default. The iframe must extract them from `location.search` (or `location.hash` if configured). If you renamed the parameter keys via `bootstrap.session.paramName` or `bootstrap.parentOrigin.paramName`, the iframe must read the new names.

2. **The iframe knows the parent origin.** It gets this from the `__iframeBridgeParentOrigin` query parameter (or from its own trusted configuration). The parent origin is the URL origin of the page that embeds the iframe — e.g., `https://app.example.com`.

3. **The iframe sends `bridge:ready` to the correct target.** `postMessage` must target the exact parent origin:
   ```ts
   // Inside the iframe
   const parentOrigin = new URLSearchParams(location.search).get('__iframeBridgeParentOrigin');
   window.parent.postMessage({
     protocol: 'iframe-bridge',
     version: 1,
     sessionId: sessionId,
     type: 'bridge:ready',
   }, parentOrigin);
   ```
   The second argument to `postMessage` must be the exact parent origin string — never `'*'`.

4. **The session id is echoed correctly.** The `sessionId` field in the envelope must match the value from the URL parameter `__iframeBridgeSessionId`.

5. **The protocol name is `'iframe-bridge'`.** Any other value, including case variations, is rejected.

6. **The protocol version is `1`.** The SDK requires an exact version match.

7. **The message type is `'bridge:ready'`.** Sending `'bridge:connected'`, `'bridge:event'`, or any other type won't complete the handshake.

8. **The iframe URL is reachable.** Open the iframe URL directly in a browser tab to confirm it loads and returns HTML — not a 404, not an error page, not an opaque redirect that strips parameters.

### Handshake timeout vs operation timeout

These are separate timers:

| Timer | Configured via | Default | Controls |
|---|---|---|---|
| Handshake timeout | `bootstrap.handshakeTimeoutMs` | 10s | How long the parent waits for the first valid `bridge:ready`. |
| Operation timeout | `timeouts.operationTimeoutMs` or per-call `timeoutMs` | 5s | How long individual `request()` or `waitForEvent()` calls wait after the handshake. |

The operation timeout does **not** start during the handshake window. A request queued before readiness is only timed after the queue flushes and the request is sent. If the handshake fails, queued operations reject with `HANDSHAKE_TIMEOUT` — not `REQUEST_TIMEOUT`.

:::info Remount after timeout

`HANDSHAKE_TIMEOUT` is terminal for the current bridge attempt. To try again, call `bridge.remount()` — it destroys the existing bridge, detaches the iframe, and creates a fresh attempt from the same config. See [API Reference](./api-reference#bridgeremount) for `remount()` behavior.

:::

---

## Origin Mismatch

The SDK validates every inbound message against an exact origin. No wildcards. No substring matching. If the origin doesn't match `allowedOrigin`, the message is rejected — and if `bridge:ready` is rejected, the handshake eventually times out.

### How origins are validated

1. `allowedOrigin` is derived from `src.origin` by default, or set explicitly in config.
2. Every incoming message's `event.origin` is compared against `allowedOrigin` with **strict equality**.
3. If the iframe redirects to a different origin, `event.origin` will be the final origin — not the original `src` origin.

### Common origin mistakes

| Mistake | What happens | Fix |
|---|---|---|
| `src` uses `http://localhost` without `allowInsecureLocalhost` | `CONFIG_UNSAFE_ORIGIN` thrown synchronously. | Set `allowInsecureLocalhost: true` for local development. |
| Iframe redirects to a different origin | `allowedOrigin` derived from `src` doesn't match the redirect target. Inbound messages are rejected. | Set `allowedOrigin` and `targetOrigin` explicitly to the final origin. |
| `targetOrigin` doesn't match the iframe's actual window origin | Parent-to-iframe `postMessage` calls are silently dropped by the browser. Operations time out with no response. | Set `targetOrigin` to the exact iframe window origin, or leave it unset to derive from `src.origin`. |
| `allowedOrigin` and `targetOrigin` point to different origins | Inbound messages accepted from one origin, outbound sent to another. Communication is one-sided or broken. | In most cases, `allowedOrigin` and `targetOrigin` should be the same origin. Only set them to different values if you have a documented reason. |
| Iframe sandbox omits `allow-same-origin` | `event.origin` becomes `'null'` — it will never match any `allowedOrigin` value. | If you need the sandbox and bridge together, you must include `allow-same-origin`. Review the [security implications](./security#sandbox) first. |

:::warning Browser CSP can block messages

Even when origins are correct, the parent's Content Security Policy can interfere. If `frame-src` doesn't include the iframe's origin, the iframe won't load. If the parent's CSP restricts `script-src`, the iframe's JavaScript may not execute. Check the browser console for CSP violation reports with `Content-Security-Policy` in the message.

:::

### Diagnosing origin mismatches

Enable debug diagnostics and look for `MESSAGE_ORIGIN_MISMATCH` entries. Each entry includes the expected origin and the actual origin — compare them character by character:

```ts
const recorder = createDiagnosticRecorder();

const bridge = createIframeBridge({
  container: '#frame-root',
  src: 'https://partner.example/app',
  diagnostics: { debug: true, logger: recorder.logger },
});

try { await bridge.whenReady(); } catch {}

const mismatches = recorder.entries.filter(
  (e) => e.code === 'MESSAGE_ORIGIN_MISMATCH'
);
console.table(mismatches);
```

Look for trailing slashes, port differences, `www.` vs bare domain, and HTTP vs HTTPS.

---

## Requests Timing Out

A `bridge.request()` call rejects with `REQUEST_TIMEOUT`. The request was sent, but no response arrived.

### Decision tree

1. **Is the operation timeout too short?**
   - Default is 5 seconds. If the remote work legitimately takes longer, increase it:
     ```ts
     await bridge.request('heavy:computation', payload, { timeoutMs: 30000 });
     ```
   - Or raise the global default:
     ```ts
     const bridge = createIframeBridge({
       container: '#frame-root',
       src: 'https://partner.example/app',
       timeouts: { operationTimeoutMs: 15000 },
     });
     ```
   - If the timeout is reasonable and requests still fail, proceed to step 2.

2. **Does the iframe handle requests?**
   - The iframe must listen for `message` events, filter for `type: 'bridge:request'`, and send a `bridge:response` with the matching `requestId`.
   - Confirm the iframe's request handler is registered and not throwing before it can respond.
   - Check that the iframe sends the response to the correct `targetOrigin` (the parent origin, not `'*'`).

3. **Is the `requestId` echoed correctly?**
   - Every `bridge:request` carries a `requestId`. The iframe's `bridge:response` must include exactly the same `requestId`.
   - A mismatched or missing `requestId` means the parent never matches the response to the pending request.

4. **Are payloads structured-cloneable?**
   - The browser's structured clone algorithm rejects functions, DOM nodes, class instances, Symbols, and certain objects. If the iframe response contains non-cloneable data, `postMessage` throws — and no response reaches the parent.
   - Check the iframe browser console for `DataCloneError`.

5. **Did the operation time out from the queue?**
   - The operation timeout clock starts **after** the request leaves the pre-ready queue and is posted to the iframe. If the handshake takes 9 seconds and the operation timeout is 5 seconds, the request still gets the full 5 seconds after send.
   - If the handshake itself fails, the error is `HANDSHAKE_TIMEOUT` — not `REQUEST_TIMEOUT`.

### Request timeout recovery pattern

```ts
try {
  const result = await bridge.request('data:fetch', { id: 'abc' }, {
    timeoutMs: 8000,
  });
  console.log(result);
} catch (error) {
  if (error instanceof IframeBridgeError && error.code === 'REQUEST_TIMEOUT') {
    // Option 1: retry with longer timeout
    try {
      const result = await bridge.request('data:fetch', { id: 'abc' }, {
        timeoutMs: 20000,
      });
      console.log(result);
    } catch (retryError) {
      console.error('Request failed after retry:', retryError);
    }
  }
}
```

---

## Events Not Received

You registered a listener with `bridge.on()` or called `bridge.waitForEvent()`, but the expected event never fires.

### `on()` vs `waitForEvent()` behavior

| | `bridge.on(name, handler)` | `bridge.waitForEvent(name, opts?)` |
|---|---|---|
| **Fires** | Every time the event arrives | Only the next occurrence |
| **Duration** | Continuous — until unsubscribed | One-shot — resolves or times out once |
| **Timeout** | None | Per-operation timeout (default 5s) |
| **Registration timing** | Can register before ready | Can register before ready (queued) |
| **Dispatch** | Only when bridge is `'ready'` | Only when bridge is `'ready'` |
| **Returns** | Unsubscribe function | `Promise<TPayload>` |

### Common causes

1. **Event name mismatch.** Event names are case-sensitive. `'cart:Changed'` is not `'cart:changed'`. Compare the name in your listener against the name the iframe sends character for character.

2. **Listener registered too late.** If the iframe sends the event before your listener is registered, you miss it. For one-shot events, register the listener before triggering the remote action that produces the event.

3. **Bridge not ready.** Event listeners only dispatch inbound events when the bridge state is `'ready'`. If the bridge is still `'waiting_for_handshake'` or has entered `'handshake_failed'`, events are not delivered — even if the iframe sends them.

4. **`waitForEvent` timed out.** The default 5-second operation timeout may be too short. Increase it:
   ```ts
   await bridge.waitForEvent('slow:event', { timeoutMs: 15000 });
   ```

5. **Mixed up `on()` and `waitForEvent()`.** `on()` doesn't return a promise — it returns an unsubscribe function. Calling `await bridge.on(...)` does nothing useful. Use `waitForEvent()` when you need to await a single occurrence.

### Debugging event delivery

Enable debug diagnostics and listen for `MESSAGE_INVALID_ENVELOPE` — if the iframe's event envelope is missing the `name` field or uses the wrong `type`, it's rejected before reaching your listener.

```ts
const recorder = createDiagnosticRecorder({ maxEntries: 100 });

const bridge = createIframeBridge({
  container: '#frame-root',
  src: 'https://partner.example/app',
  diagnostics: { debug: true, logger: recorder.logger },
});

await bridge.whenReady();

// Check what the SDK is seeing
setInterval(() => {
  const events = recorder.entries.filter(
    (e) => e.message?.includes('event') || e.message?.includes('Event')
  );
  if (events.length) console.table(events);
}, 5000);
```

:::tip Verify the iframe is sending events

Open the browser's DevTools, go to the **Messages** tab (in Chromium: Application → Frames → top → postMessages), or use the **Monitor Events** feature. Filter for `postMessage` to confirm the iframe is posting messages with the expected event name and payload.

:::

---

## Multiple Bridges Interfering

You have two or more bridge instances on the same page, and messages seem to leak between them — or one bridge's failures affect another.

### Session isolation

Each bridge instance generates a unique session id and validates it on every inbound message. A message from iframe A (with session A's id) is rejected by bridge B (which expects session B's id). Under normal conditions, bridges don't interfere.

### Common mistakes

1. **Same container for multiple bridges.** If two bridge instances use the same `container` (e.g., `'#frame-root'`), the second iframe replaces or sits next to the first, depending on `replaceContainerContent`. Each bridge needs its own container element.
   ```html
   <div id="frame-1"></div>
   <div id="frame-2"></div>
   ```

2. **Container not cleared between remounts.** When calling `bridge.remount()`, the old iframe is detached. But if you don't use `replaceContainerContent: true`, the new iframe is appended alongside any leftover content. For dedicated mount points, set `replaceContainerContent: true`.

3. **Fixed session id shared across instances.** If you set `bootstrap.session.paramValue` to a fixed string, two bridges with the same config will share the same session id — and messages from either iframe will match either bridge. Let the SDK generate session ids per instance.

4. **Bootstrap parameter name collision.** If two bridge instances use custom `bootstrap.session.paramName` values that collide with existing iframe URL parameters, the iframe may read the wrong value or miss it entirely.

### Verifying isolation

```ts
import { createDiagnosticRecorder, createIframeBridge } from '@furkankaynak/iframe-helper-sdk';

const recA = createDiagnosticRecorder({ maxEntries: 50 });
const recB = createDiagnosticRecorder({ maxEntries: 50 });

const bridgeA = createIframeBridge({
  container: '#frame-a',
  src: 'https://one.example/app',
  diagnostics: { debug: true, logger: recA.logger },
});

const bridgeB = createIframeBridge({
  container: '#frame-b',
  src: 'https://two.example/app',
  diagnostics: { debug: true, logger: recB.logger },
});

// After both are ready, each recorder should show only its
// own session messages — no cross-bridge entries.
await Promise.all([bridgeA.whenReady(), bridgeB.whenReady()]);
console.log('Bridge A diagnostics:', recA.entries.length, 'entries');
console.log('Bridge B diagnostics:', recB.entries.length, 'entries');
```

---

## Browser Console Clues

When diagnostics aren't wired yet, the browser's built-in developer tools can still tell you a lot.

### Check the Network tab

| What to look for | What it means |
|---|---|
| Iframe URL returns **404** or **5xx** | The iframe app isn't reachable. Open the URL directly to confirm. |
| Iframe URL shows **(canceled)** | The navigation was blocked — likely by CSP `frame-src`. Check the Console tab for a CSP violation message. |
| Iframe URL redirects (301/302) | The final loaded origin may differ from `src.origin`. If the iframe redirects, set `allowedOrigin` and `targetOrigin` explicitly. |
| Request shows **(failed) net::ERR_BLOCKED_BY_RESPONSE** | The iframe's response headers block embedding (e.g., `X-Frame-Options: DENY` or `frame-ancestors 'none'`). The iframe server must allow your parent origin. |

### Check the Console tab

| What to look for | What it means |
|---|---|
| `Content-Security-Policy` violation | CSP is blocking the iframe load, script execution, or postMessage delivery. Add the necessary origins to your CSP directives. |
| `DataCloneError` | The iframe is sending non-structured-cloneable data (functions, DOM nodes, class instances). Fix the iframe's message payloads. |
| `Failed to execute 'postMessage'` | The SDK's `targetOrigin` doesn't match the iframe's window origin, or the iframe window is unavailable. |
| `iframe-helper-sdk` in log messages | Your diagnostic logger is wired — check the details on each event. |

### Check the Messages tab

In Chromium-based browsers: **Application** → **Frames** → select the top-level frame → **postMessages**. You'll see every `postMessage` sent and received on the page, including the SDK's protocol envelopes.

Look for:
- `bridge:ready` messages from iframes — if none appear, the iframe isn't sending the handshake.
- `bridge:connected` messages to iframes — if you see ready but no connected, the ready message was rejected.
- Repeated `bridge:ready` from the same iframe — duplicate messages are ignored after the first valid one.

### Check bridge state from the console

```ts
// Store a reference on window for console access
window.__bridge = bridge;

// Then in the console:
window.__bridge.state
// 'waiting_for_handshake' → 'ready' → or 'handshake_failed'
```

### Check the Elements tab

- Confirm the iframe element exists and has a populated `src` attribute.
- Check for `sandbox` attribute — if present, verify the iframe has the tokens it needs (e.g., `allow-scripts` is required for JavaScript execution).
- Check for `allow` attribute — if present, verify feature permissions needed by the iframe app.

:::tip The diagnostic recorder is faster

The eight checks above are useful for quick inspection, but they won't tell you _why_ a message was rejected. Wire up `createDiagnosticRecorder` (two lines of code) to get that answer directly. See [Debugging & Diagnostics](./debugging) for the full setup.

:::

---

## Next Steps

- **[Debugging & Diagnostics](./debugging)** — Set up the diagnostic recorder and logger hooks for fine-grained visibility.
- **[Error Codes](./error-codes)** — Reference for all 26 error codes with causes and recovery actions.
- **[Configuration](./configuration)** — Full reference for every `IframeBridgeConfig` option mentioned here.
- **[Wire Protocol](./wire-protocol)** — The envelope specification your iframe must follow.
- **[Security](./security)** — Security model, CSP configuration, and production hardening.
- **[API Reference](./api-reference)** — Hand-written reference for `bridge.state`, `whenReady()`, `remount()`, and all other methods.

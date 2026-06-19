---
sidebar_position: 11
slug: error-codes
toc_max_heading_level: 3
description: Complete reference for every error code in iframe-helper-sdk — IframeBridgeError, per-category tables with causes and recovery actions, and error handling patterns.
---

# Error Codes

Every error from the SDK is an instance of `IframeBridgeError` — a typed error class that carries a machine-readable `code`, a human-readable `message`, and optional `details`. This page catalogs all 26 error codes, explains what triggers each one, and what you should do about it.

If you're stuck on a specific problem, start with the [Troubleshooting](./troubleshooting) page for diagnostic flowcharts. For the config options that trigger validation errors, see [Configuration](./configuration).

---

## IframeBridgeError

```ts
import { IframeBridgeError } from 'iframe-helper-sdk';

class IframeBridgeError extends Error {
  readonly code: IframeBridgeErrorCode;
  readonly details?: unknown;
}
```

- **`name`** is always `'IframeBridgeError'` — you can `instanceof`-check it.
- **`code`** is a string from the `IframeBridgeErrorCode` union. Use it to programmatically branch your error handling.
- **`message`** is a human-readable description of what went wrong.
- **`details`** may carry extra context — for remote errors it includes the normalized `remoteError` object from the iframe, for config errors it may include the invalid value.

:::note Sync vs. async errors

Config validation errors are thrown **synchronously** by `createIframeBridge()`. They happen before the iframe is created, so wrapping the factory call in `try/catch` is sufficient.

Operation errors (timeouts, aborts, remote errors) and lifecycle errors (not ready, destroyed, handshake failed) are delivered as **rejected promises** from `request()`, `sendEvent()`, `waitForEvent()`, and `whenReady()`.

:::

---

## Config Errors

Config errors are thrown synchronously by `createIframeBridge()` and `createTypedIframeBridge()` when the provided configuration is invalid or unsafe. You won't have a bridge instance yet — fix the config and try again.

| Code                               | Typical cause                                                                                                                                                                                       | Recovery                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_INVALID_CONTAINER`         | `container` is missing, not an `Element`, is an invalid selector string, or the selector returned no match.                                                                                         | Pass a valid DOM element or a selector that resolves to an element in the document.                                        |
| `CONFIG_INVALID_SRC`               | `src` is missing, cannot be parsed as an absolute URL, contains embedded credentials, or uses an unsupported scheme (`javascript:`, `data:`, `blob:`).                                              | Use an absolute HTTPS URL without credentials. For localhost HTTP during development, enable `allowInsecureLocalhost`.     |
| `CONFIG_INVALID_QUEUE`             | `queue.maxSize` is not a positive integer.                                                                                                                                                          | Set `queue.maxSize` to an integer &ge; 1, or omit it to use the default of 50.                                             |
| `CONFIG_INVALID_SECURITY_PROFILE`  | `securityProfile` is set to a value other than `'development'` or `'strict'`.                                                                                                                       | Use `'strict'` for production fail-fast behavior, `'development'` for warnings, or omit the option entirely.               |
| `CONFIG_INVALID_TIMEOUT`           | `bootstrap.handshakeTimeoutMs` or `timeouts.operationTimeoutMs` is not a positive integer.                                                                                                          | Set timeout values to integers &ge; 1, or omit them to use the defaults (10000 and 5000 respectively).                     |
| `CONFIG_UNSAFE_ORIGIN`             | A configured origin (`src`, `targetOrigin`, `allowedOrigin`, or `bootstrap.parentOrigin.value`) is empty, wildcard-based, non-HTTPS (outside localhost development), or contains a path/query/hash. | Use exact HTTPS origins. For localhost HTTP during development, set `allowInsecureLocalhost: true`.                        |
| `CONFIG_UNSAFE_PERMISSIONS_POLICY` | `iframeAttributes.allow` uses a wildcard (`*`) grant in `securityProfile: 'strict'`.                                                                                                                | Replace `*` with an explicit feature list scoped to the features your iframe actually needs (e.g., `"fullscreen 'self'"`). |
| `CONFIG_UNSAFE_SANDBOX`            | `sandbox` combines `allow-scripts` with `allow-same-origin` in `securityProfile: 'strict'`. This combination effectively removes sandbox isolation.                                                 | Remove one of the conflicting tokens, or switch to `securityProfile: 'development'` after a documented security review.    |
| `DIAGNOSTICS_INVALID_MAX_ENTRIES`  | `maxEntries` passed to `createDiagnosticRecorder()` is not a positive integer.                                                                                                                      | Pass an integer &ge; 1, or omit the option to use the default of 100.                                                      |

:::warning Config errors are synchronous

These errors are thrown during config normalization, **before** any iframe is created or mounted. Your `createIframeBridge()` call itself is the throwing boundary — wrap it in `try/catch`.

:::

---

## Handshake Errors

Handshake errors occur during the bridge readiness phase — between iframe mount and the first valid `bridge:ready` message. For the full handshake sequence and protocol rules, see [Wire Protocol](./wire-protocol#handshake-sequence).

| Code                          | Typical cause                                                                                                                                               | Recovery                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDSHAKE_TIMEOUT`           | The iframe did not send a valid `bridge:ready` within `bootstrap.handshakeTimeoutMs` (default: 10 seconds).                                                 | Confirm the iframe reads the configured session and parent origin params, sends `bridge:ready` to the exact parent origin, and the iframe is loaded from the expected origin. Check that the iframe URL resolves and returns HTML. |
| `HANDSHAKE_ORIGIN_MISMATCH`   | An incoming message that looked like a handshake came from an unexpected origin. The SDK rejects it rather than processing a potentially deceptive message. | Verify `allowedOrigin` matches the iframe's actual origin. If the iframe redirects to a different origin, set `allowedOrigin` and `targetOrigin` explicitly.                                                                       |
| `HANDSHAKE_SOURCE_MISMATCH`   | An incoming message that looked like a handshake came from a window other than the owned iframe.                                                            | This usually indicates another window or iframe on the page is sending messages. Verify only one iframe is configured per bridge instance.                                                                                         |
| `HANDSHAKE_SESSION_MISMATCH`  | An incoming message that looked like a handshake carried a `sessionId` that doesn't match this bridge instance.                                             | Check that the iframe echoes the same session parameter the SDK appended to the URL. If you renamed `bootstrap.session.paramName`, make sure the iframe reads the new parameter name.                                              |
| `HANDSHAKE_PROTOCOL_MISMATCH` | An incoming message that looked like a handshake did not declare `protocol: 'iframe-bridge'`.                                                               | The iframe must include `protocol: 'iframe-bridge'` in every envelope. This is part of the wire protocol contract.                                                                                                                 |
| `HANDSHAKE_VERSION_MISMATCH`  | An incoming message that looked like a handshake declared a protocol `version` other than `1`.                                                              | The iframe must set `version: 1`. Future SDK versions may support version negotiation, but MVP requires exact match.                                                                                                               |

:::info Handshake mismatch errors and diagnostics

`HANDSHAKE_ORIGIN_MISMATCH`, `HANDSHAKE_SOURCE_MISMATCH`, `HANDSHAKE_SESSION_MISMATCH`, `HANDSHAKE_PROTOCOL_MISMATCH`, and `HANDSHAKE_VERSION_MISMATCH` are surfaced through diagnostics when logger hooks are configured. The lifecycle outcome when no valid ready message is accepted is always `HANDSHAKE_TIMEOUT`. Enable debug diagnostics with `createDiagnosticRecorder` to see detailed rejection reasons during integration. See [Debugging & Diagnostics](./debugging).

:::

---

## Operation Errors

Operation errors occur during active bridge communication — `request()`, `sendEvent()`, and `waitForEvent()` calls. These are delivered as rejected promises.

| Code                        | Typical cause                                                                                                               | Recovery                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPERATION_INVALID_TIMEOUT` | Per-operation `timeoutMs` is not a positive integer.                                                                        | Pass `timeoutMs` as an integer &ge; 1 in the `options` argument. Omit it to use the global `timeouts.operationTimeoutMs` default.                                             |
| `OPERATION_ABORTED`         | The `AbortSignal` passed in `options.signal` was already aborted, or was aborted while the operation was queued or pending. | This is caller-initiated cancellation, not an error condition. Create a new `AbortController` for a retry. Note: aborting a posted `sendEvent` cannot undo remote processing. |
| `REQUEST_TIMEOUT`           | A `request()` was sent but the iframe did not respond with a matching `bridge:response` before the operation timeout.       | Check that the iframe request handler is registered and responding. Increase the timeout only if the remote work legitimately takes longer than the default 5 seconds.        |
| `REQUEST_REMOTE_ERROR`      | The iframe returned a `bridge:response` with an `error` object.                                                             | Inspect the remote error via `error.details.remoteError` — it contains `code`, `message`, and optional `data` from the iframe.                                                |
| `EVENT_WAIT_TIMEOUT`        | `waitForEvent()` did not receive a matching inbound event before the operation timeout.                                     | Register the waiter before triggering the remote action that should produce the event. Confirm the iframe sends the expected event `name`.                                    |

### Accessing remote errors

When `REQUEST_REMOTE_ERROR` is thrown, the iframe's error is available in `details`:

```ts
try {
  await bridge.request('user:get', { id: '123' });
} catch (error) {
  if (error instanceof IframeBridgeError && error.code === 'REQUEST_REMOTE_ERROR') {
    const remote = error.details as {
      remoteError: { code: string; message: string; data?: unknown };
    };
    console.error('Iframe error:', remote.remoteError.code, remote.remoteError.message);
  }
}
```

Or use the `normalizeBridgeRemoteError` helper:

```ts
import { normalizeBridgeRemoteError, IframeBridgeError } from 'iframe-helper-sdk';

try {
  await bridge.request('user:get', { id: '123' });
} catch (error) {
  if (error instanceof IframeBridgeError && error.code === 'REQUEST_REMOTE_ERROR') {
    const remote = normalizeBridgeRemoteError(error.details);
    console.error(remote.code, remote.message);
  }
}
```

---

## Lifecycle Errors

Lifecycle errors are about the bridge's state — what it can and can't do at a given moment.

| Code                   | Typical cause                                                                                                                          | Recovery                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGE_NOT_READY`     | An operation was called before readiness and the pre-ready queue is disabled (`queue.enabled: false`).                                 | Either await `bridge.whenReady()` before communicating, or enable the queue by setting `queue.enabled: true` (the default).      |
| `BRIDGE_DESTROYED`     | An operation was attempted after `bridge.destroy()` was called, or `whenReady()` awaited a bridge that was destroyed before readiness. | `destroy()` is terminal — create a new bridge with `createIframeBridge()` or call `bridge.remount()`.                            |
| `QUEUE_LIMIT_EXCEEDED` | Too many operations were queued before readiness, exceeding `queue.maxSize` (default: 50).                                             | Reduce pre-ready activity, increase `queue.maxSize` deliberately, or await readiness before queuing more operations.             |
| `QUEUE_CLOSED`         | An operation attempted to enter the queue, but the queue has already closed because handshake failed or the bridge was destroyed.      | Check `bridge.state` to understand why the queue closed. If the handshake failed, fix the handshake and call `bridge.remount()`. |

:::tip Using `whenReady()` to avoid lifecycle errors

The safest pattern: `await bridge.whenReady()` before any communication. This avoids `BRIDGE_NOT_READY` entirely and lets the queue handle the window between factory creation and readiness.

```ts
const bridge = createIframeBridge({ container: '#root', src: 'https://partner.example/app' });
await bridge.whenReady();
// Now safe to communicate — bridge is ready.
const data = await bridge.request('data:get', {});
```

:::

---

## Message Errors

Message errors occur at the transport/envelope level — before a message reaches application logic.

| Code                       | Typical cause                                                                                                                                                                                                                                    | Recovery                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MESSAGE_INVALID_ENVELOPE` | A message matched the transport (correct origin, session, and source) but failed envelope validation — missing `type`, missing `name` on an event/request, missing `requestId` on a request/response, or an invalid `error` shape on a response. | Check that the iframe's messages follow the envelope spec: `protocol: 'iframe-bridge'`, `version: 1`, a non-empty `sessionId`, a known `type`, and required fields per type. See [Wire Protocol](./wire-protocol#envelope). |
| `MESSAGE_TARGET_MISMATCH`  | The SDK could not post a message to the iframe — the iframe window or target origin was unavailable.                                                                                                                                             | Confirm the iframe is still mounted in the DOM and `targetOrigin` is the correct exact origin. This can happen after the iframe navigates to a different origin or is removed from the DOM.                                 |

---

## Error Handling Patterns

### Catch and branch by code

The `code` property lets you handle different errors differently:

```ts
import { createIframeBridge, IframeBridgeError } from 'iframe-helper-sdk';

try {
  const bridge = createIframeBridge({
    container: '#partner-frame',
    src: 'https://partner.example/app',
  });

  await bridge.whenReady();

  const user = await bridge.request('user:get', { id: '123' });
  console.log('User:', user.name);
} catch (error) {
  if (!(error instanceof IframeBridgeError)) {
    // Unexpected error — rethrow
    throw error;
  }

  switch (error.code) {
    case 'CONFIG_UNSAFE_ORIGIN':
      console.error('Origin config is invalid. Use exact HTTPS origins.', error.message);
      break;

    case 'HANDSHAKE_TIMEOUT':
      console.error('Iframe did not respond. Check the iframe integration and URL.', error.message);
      // Maybe show a fallback UI
      break;

    case 'REQUEST_TIMEOUT':
      console.error('Request timed out. The iframe may be slow or unresponsive.', error.message);
      // Retry with a longer timeout, or show an error state
      break;

    case 'REQUEST_REMOTE_ERROR': {
      const remote = error.details as { remoteError: { code: string; message: string } };
      console.error(
        `Iframe returned error ${remote.remoteError.code}: ${remote.remoteError.message}`,
      );
      break;
    }

    case 'OPERATION_ABORTED':
      // Caller cancelled — do nothing
      break;

    default:
      console.error('Bridge error:', error.code, error.message, error.details);
  }
}
```

### Handling AbortSignal cancellation

The `OPERATION_ABORTED` code is used for caller-initiated cancellation via `AbortController`. It's not a true error — treat it as "the caller changed its mind."

```ts
const controller = new AbortController();

const bridge = createIframeBridge({
  container: '#root',
  src: 'https://partner.example/app',
});

await bridge.whenReady();

// Start a request that can be cancelled
const requestPromise = bridge.request(
  'search',
  { query: 'term' },
  {
    signal: controller.signal,
  },
);

// Cancel after 2 seconds if the user navigates away
setTimeout(() => controller.abort(), 2000);

try {
  const result = await requestPromise;
  console.log('Result:', result);
} catch (error) {
  if (error instanceof IframeBridgeError && error.code === 'OPERATION_ABORTED') {
    console.log('Request was cancelled.');
    return;
  }
  throw error;
}
```

### Config validation pattern

Since config errors are synchronous, wrap only the factory call:

```ts
import { createIframeBridge, IframeBridgeError } from 'iframe-helper-sdk';

let bridge;
try {
  bridge = createIframeBridge({
    container: '#partner-frame',
    src: 'https://partner.example/app',
    securityProfile: 'strict',
    sandbox: ['allow-scripts'],
  });
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error(`Config error [${error.code}]:`, error.message);
    return;
  }
  throw error;
}

// Config validated — now await readiness
try {
  await bridge.whenReady();
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error(`Bridge error [${error.code}]:`, error.message);
    return;
  }
  throw error;
}
```

---

## Quick Reference

All 26 error codes in one table with the most common recovery action.

| Error code                         | Category  | Recovery                                                          |
| ---------------------------------- | --------- | ----------------------------------------------------------------- |
| `CONFIG_INVALID_CONTAINER`         | Config    | Pass a valid DOM element or selector.                             |
| `CONFIG_INVALID_SRC`               | Config    | Use an absolute HTTPS URL without credentials.                    |
| `CONFIG_INVALID_QUEUE`             | Config    | Set `queue.maxSize` to a positive integer.                        |
| `CONFIG_INVALID_SECURITY_PROFILE`  | Config    | Use `'strict'` or `'development'`.                                |
| `CONFIG_INVALID_TIMEOUT`           | Config    | Set timeout values to integers &ge; 1.                            |
| `CONFIG_UNSAFE_ORIGIN`             | Config    | Use exact HTTPS origins; enable `allowInsecureLocalhost` for dev. |
| `CONFIG_UNSAFE_PERMISSIONS_POLICY` | Config    | Replace wildcard `allow` with explicit feature grants.            |
| `CONFIG_UNSAFE_SANDBOX`            | Config    | Remove `allow-same-origin` or switch to development profile.      |
| `DIAGNOSTICS_INVALID_MAX_ENTRIES`  | Config    | Pass `maxEntries` as a positive integer.                          |
| `HANDSHAKE_TIMEOUT`                | Handshake | Verify iframe reads bootstrap params and sends `bridge:ready`.    |
| `HANDSHAKE_ORIGIN_MISMATCH`        | Handshake | Match `allowedOrigin` to iframe's actual origin.                  |
| `HANDSHAKE_SOURCE_MISMATCH`        | Handshake | Ensure only the owned iframe sends bridge messages.               |
| `HANDSHAKE_SESSION_MISMATCH`       | Handshake | Check iframe echoes the correct session parameter.                |
| `HANDSHAKE_PROTOCOL_MISMATCH`      | Handshake | Iframe must use `protocol: 'iframe-bridge'`.                      |
| `HANDSHAKE_VERSION_MISMATCH`       | Handshake | Iframe must use `version: 1`.                                     |
| `OPERATION_INVALID_TIMEOUT`        | Operation | Pass `timeoutMs` as a positive integer.                           |
| `OPERATION_ABORTED`                | Operation | Caller cancelled — create a new `AbortController` for retry.      |
| `REQUEST_TIMEOUT`                  | Operation | Check iframe request handling; increase timeout if needed.        |
| `REQUEST_REMOTE_ERROR`             | Operation | Inspect `error.details.remoteError` for the iframe's error.       |
| `EVENT_WAIT_TIMEOUT`               | Operation | Register the waiter before triggering the remote action.          |
| `BRIDGE_NOT_READY`                 | Lifecycle | Await `bridge.whenReady()` or enable the pre-ready queue.         |
| `BRIDGE_DESTROYED`                 | Lifecycle | Create a new bridge or call `bridge.remount()`.                   |
| `QUEUE_LIMIT_EXCEEDED`             | Lifecycle | Reduce pre-ready activity or increase `queue.maxSize`.            |
| `QUEUE_CLOSED`                     | Lifecycle | Fix the handshake and call `bridge.remount()`.                    |
| `MESSAGE_INVALID_ENVELOPE`         | Message   | Check envelope shape against the wire protocol spec.              |
| `MESSAGE_TARGET_MISMATCH`          | Message   | Confirm the iframe is mounted and `targetOrigin` is correct.      |

---

## Next Steps

- **[Troubleshooting](./troubleshooting)** — Diagnostic flowcharts for common integration problems.
- **[API Reference](./api-reference)** — Hand-written reference for every public export.
- **[Configuration](./configuration)** — Complete reference for every `IframeBridgeConfig` option.
- **[Security](./security)** — Security model, profiles, CSP guidance, and production checklist.
- **[Wire Protocol](./wire-protocol)** — The envelope specification for iframe-side integrations.
- **[Debugging & Diagnostics](./debugging)** — Diagnostic recorder workflows and logger hooks.

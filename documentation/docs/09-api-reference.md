---
sidebar_position: 10
slug: api-reference
toc_max_heading_level: 3
description: Complete hand-written reference for every public export of iframe-helper-sdk — factories, bridge instance methods, types, protocol utilities, and the error class.
---

# API Reference

This page is a hand-written reference for every public API surface exported by `iframe-helper-sdk`. It is not auto-generated — every signature, behavior note, and example has been reviewed against the implemented SDK.

If you're looking for conceptual explanations, see [Core Concepts](./core-concepts). For step-by-step guidance, start with [Getting Started](./getting-started).

---

## Quick Reference

| Export                       | Kind     | Description                                           |
| ---------------------------- | -------- | ----------------------------------------------------- |
| `createIframeBridge`         | Function | Create a bridge instance for a cross-domain iframe    |
| `createTypedIframeBridge`    | Function | Create a contract-typed bridge instance               |
| `createDiagnosticRecorder`   | Function | Record diagnostic events for debugging                |
| `IframeBridgeError`          | Class    | Typed SDK error with `code`, `message`, and `details` |
| `BRIDGE_MESSAGE_TYPES`       | Constant | Tuple of all bridge message type strings              |
| `BRIDGE_PROTOCOL_NAME`       | Constant | Protocol name string: `'iframe-bridge'`               |
| `BRIDGE_PROTOCOL_VERSION`    | Constant | Protocol version number: `1`                          |
| `isBridgeEnvelope`           | Function | Type guard: checks if a value is a bridge envelope    |
| `validateBridgeEnvelope`     | Function | Validates and returns a typed bridge envelope         |
| `normalizeBridgeRemoteError` | Function | Normalizes a remote error into a standard shape       |

<details>
<summary>All exported types</summary>

`IframeBridge`, `IframeBridgeConfig`, `IframeBridgeContract`, `IframeBridgeErrorCode`, `IframeBridgeErrorOptions`, `IframeBridgeEventHandler`, `IframeBridgeIframeAttributes`, `IframeBridgeBootstrapConfig`, `IframeBridgeBootstrapSessionConfig`, `IframeBridgeBootstrapParentOriginConfig`, `IframeBridgeQueueConfig`, `IframeBridgeTimeoutConfig`, `IframeBridgeDiagnosticsConfig`, `IframeBridgeLogger`, `IframeBridgeSecurityProfile`, `IframeBridgeRequestContract`, `TypedIframeBridge`, `OperationOptions`, `LifecycleState`, `DiagnosticEvent`, `DiagnosticLevel`, `DiagnosticRecorder`, `DiagnosticRecorderEntry`, `DiagnosticRecorderOptions`, `BridgeEnvelope`, `BridgeReadyEnvelope`, `BridgeConnectedEnvelope`, `BridgeEventEnvelope`, `BridgeRequestEnvelope`, `BridgeResponseEnvelope`, `BridgeEnvelopeBase`, `BridgeEnvelopeError`, `BridgeMessageType`, `BridgeProtocolName`, `BridgeProtocolVersion`, `BootstrapParamLocation`

</details>

---

## Importing

Import everything from the package root. Do not import from internal paths — they are not part of the public API.

```ts
import {
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_PROTOCOL_NAME,
  BRIDGE_PROTOCOL_VERSION,
  IframeBridgeError,
  createDiagnosticRecorder,
  createIframeBridge,
  createTypedIframeBridge,
  isBridgeEnvelope,
  normalizeBridgeRemoteError,
  validateBridgeEnvelope,
} from 'iframe-helper-sdk';

import type {
  BridgeEnvelope,
  DiagnosticEvent,
  DiagnosticRecorder,
  IframeBridge,
  IframeBridgeConfig,
  IframeBridgeContract,
  IframeBridgeErrorCode,
  IframeBridgeSecurityProfile,
  OperationOptions,
  TypedIframeBridge,
} from 'iframe-helper-sdk';
```

---

## Factories

### `createIframeBridge(config)`

```ts
function createIframeBridge(config: IframeBridgeConfig): IframeBridge;
```

Creates and returns a new bridge instance. The factory performs these steps synchronously before returning:

1. Validates every option in `config` — throws `IframeBridgeError` on invalid values.
2. Creates an `HTMLIFrameElement` and assigns configured attributes.
3. Appends bootstrap parameters (session id, parent origin) to the iframe URL.
4. Installs a `message` event listener on `window`.
5. Starts the handshake timeout timer.
6. Mounts the iframe into `config.container`.

The returned bridge is in `waiting_for_handshake` state and begins listening for `bridge:ready` from the iframe.

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  iframeAttributes: { title: 'Partner application' },
});

// Operations called here are queued until ready
const user = await bridge.request('user:get', { id: '123' });
```

**Parameter:** `config: IframeBridgeConfig` — see [Configuration](./configuration) for every option, its type, default, and validation rules.

**Returns:** `IframeBridge` — the bridge instance. Use this object for all communication with the iframe.

**Throws:** `IframeBridgeError` synchronously when config validation fails. Common codes:

- `CONFIG_INVALID_CONTAINER` — invalid or missing container
- `CONFIG_INVALID_SRC` — missing, unparseable, or unsupported URL scheme
- `CONFIG_UNSAFE_ORIGIN` — HTTP non-localhost origin without `allowInsecureLocalhost`
- `CONFIG_INVALID_TIMEOUT` — invalid `handshakeTimeoutMs` or `operationTimeoutMs`
- `CONFIG_INVALID_QUEUE` — invalid `queue.maxSize`
- `CONFIG_INVALID_SECURITY_PROFILE` — `securityProfile` is not `'development'` or `'strict'`

---

### `createTypedIframeBridge(config)`

```ts
function createTypedIframeBridge<TContract extends IframeBridgeContract>(
  config: IframeBridgeConfig,
): TypedIframeBridge<TContract>;
```

Creates a bridge instance with compile-time type narrowing. The runtime behavior is identical to `createIframeBridge` — the generic contract parameter only affects TypeScript types. See [Type-Safe Bridge](#type-safe-bridge) for the full contract API and examples.

```ts
import { createTypedIframeBridge } from 'iframe-helper-sdk';

const bridge = createTypedIframeBridge<PartnerContract>({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

// Method and payload types are narrowed by the contract — no manual generics
const user = await bridge.request('user:get', { id: '123' });
```

**Parameter:** `config: IframeBridgeConfig` — same as `createIframeBridge`.

**Returns:** `TypedIframeBridge<TContract>` — bridge instance with contract-narrowed method signatures.

---

## Bridge Instance API

Every bridge instance (`IframeBridge`) exposes the properties and methods below. For the contract-typed variant (`TypedIframeBridge`), see [Type-Safe Bridge](#type-safe-bridge).

```ts
type IframeBridge = {
  readonly iframe: HTMLIFrameElement;
  readonly state: LifecycleState;
  request<TPayload, TResponse>(
    method: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<TResponse>;
  sendEvent<TPayload>(name: string, payload: TPayload, options?: OperationOptions): Promise<void>;
  waitForEvent<TPayload>(name: string, options?: OperationOptions): Promise<TPayload>;
  on<TPayload>(name: string, handler: (payload: TPayload) => void): () => void;
  whenReady(): Promise<void>;
  remount(): IframeBridge;
  destroy(): void;
};
```

---

### `bridge.iframe`

```ts
readonly iframe: HTMLIFrameElement
```

The `HTMLIFrameElement` owned by this bridge instance. Available immediately after the factory returns. Use it for direct DOM access — scrolling into view, observing dimensions, or integrating with framework refs.

:::note

Do not modify `iframe.src`, call `iframe.remove()`, or change sandbox/allow attributes directly. Use the bridge methods (`remount()`, `destroy()`) or the config options instead. Direct DOM manipulation can break the bridge lifecycle.

:::

---

### `bridge.state`

```ts
readonly state: LifecycleState
```

The current lifecycle state of the bridge. Read-only. Changes are monotonic — the bridge never goes backwards.

```ts
type LifecycleState =
  | 'created'
  | 'mounting'
  | 'waiting_for_handshake'
  | 'ready'
  | 'handshake_failed'
  | 'destroyed';
```

| State                   | Description                                                               | Valid operations                                                                 |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `created`               | Config validated, bridge object returned. Iframe not yet created.         | `destroy()`                                                                      |
| `mounting`              | Iframe element built. Listeners not yet installed.                        | `destroy()`                                                                      |
| `waiting_for_handshake` | Listener installed, iframe loading. Handshake timer ticking.              | `request()`, `sendEvent()`, `waitForEvent()`, `on()`, `whenReady()`, `destroy()` |
| `ready`                 | Valid `bridge:ready` received and `bridge:connected` sent. Queue flushed. | All operations                                                                   |
| `handshake_failed`      | Handshake timeout elapsed without a valid ready.                          | `destroy()`, `remount()`                                                         |
| `destroyed`             | Bridge destroyed. Listeners removed, iframe detached.                     | None — all calls reject with `BRIDGE_DESTROYED`                                  |

---

### `bridge.request(method, payload, options?)`

```ts
request<TPayload = unknown, TResponse = unknown>(
  method: string,
  payload: TPayload,
  options?: OperationOptions,
): Promise<TResponse>
```

Sends a request to the iframe and waits for a matching response. This is the primary mechanism for request/response communication — use it when the parent needs data or an action result from the iframe.

```ts
// Basic usage — type parameters are optional but recommended
const user = await bridge.request<{ id: string }, { name: string }>('user:get', { id: '123' });

// With a per-operation timeout override
const report = await bridge.request('report:generate', params, {
  timeoutMs: 30000,
});

// With an AbortSignal for cancellation
const controller = new AbortController();
const promise = bridge.request('slow:task', payload, {
  signal: controller.signal,
});
controller.abort(); // promise rejects with OPERATION_ABORTED
```

**Parameters:**

| Parameter           | Type                     | Description                                                                                             |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `method`            | `string`                 | The request method name. Must be non-empty. The iframe uses this to route the request.                  |
| `payload`           | `TPayload`               | The request payload. Must be structured-cloneable data (no functions, DOM nodes, class instances).      |
| `options.timeoutMs` | `number` (optional)      | Per-operation timeout in milliseconds. Overrides `timeouts.operationTimeoutMs`. Must be an integer ≥ 1. |
| `options.signal`    | `AbortSignal` (optional) | Abort controller signal for cancelling the request.                                                     |

**Returns:** `Promise<TResponse>` — resolves with the iframe's response payload when a matching `bridge:response` arrives.

**Behavior:**

| Scenario                                                 | Outcome                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Called before ready, queue enabled                       | Enters the pre-ready queue. Flushes and executes after readiness.                        |
| Called before ready, queue disabled                      | Rejects with `BRIDGE_NOT_READY`                                                          |
| Called when queue is full                                | Rejects with `QUEUE_LIMIT_EXCEEDED`                                                      |
| Handshake succeeds                                       | Request is posted and timeout started                                                    |
| Handshake fails while queued                             | Rejects with handshake error (`HANDSHAKE_TIMEOUT`)                                       |
| Iframe returns a response with `error`                   | Rejects with `REQUEST_REMOTE_ERROR` — the remote error is in `error.details.remoteError` |
| Iframe returns multiple responses for the same requestId | Only the first is accepted; duplicates are ignored                                       |
| `signal` aborts while queued or pending                  | Rejects with `OPERATION_ABORTED`; timers and listeners cleaned up                        |
| `timeoutMs` elapses before response                      | Rejects with `REQUEST_TIMEOUT`                                                           |
| Invalid `timeoutMs` provided                             | Rejects with `OPERATION_INVALID_TIMEOUT`                                                 |
| Bridge is destroyed while pending                        | Rejects with `BRIDGE_DESTROYED`                                                          |

:::tip

The operation timeout starts **after** the request leaves the pre-ready queue and is posted. If the handshake takes 8 seconds and the operation timeout is 5 seconds, the request gets the full 5 seconds — it is not penalized by the handshake wait.

:::

---

### `bridge.sendEvent(name, payload, options?)`

```ts
sendEvent<TPayload = unknown>(
  name: string,
  payload: TPayload,
  options?: OperationOptions,
): Promise<void>
```

Sends a fire-and-forget event to the iframe. Resolves after the event is posted — it does **not** wait for the iframe to process the event or acknowledge receipt. If you need confirmation from the iframe, use `request()` instead.

```ts
await bridge.sendEvent('analytics:track', { action: 'opened' });

await bridge.sendEvent('ui:resize', { width: 800, height: 600 });

// With abort signal — prevents posting if cancelled before flush
const controller = new AbortController();
const promise = bridge.sendEvent('analytics:track', data, {
  signal: controller.signal,
});
controller.abort(); // rejects with OPERATION_ABORTED
```

**Parameters:**

| Parameter           | Type                     | Description                                                                                                                       |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | `string`                 | The event name. Must be non-empty.                                                                                                |
| `payload`           | `TPayload`               | The event payload. Must be structured-cloneable data.                                                                             |
| `options.timeoutMs` | `number` (optional)      | Per-operation timeout. Used only during the queue phase; the event resolves immediately after posting.                            |
| `options.signal`    | `AbortSignal` (optional) | Aborts before the event is posted. Once posted, abort is a no-op — the iframe has already received (or will receive) the message. |

**Returns:** `Promise<void>` — resolves after the event is posted to the iframe via `postMessage`.

**Behavior:**

| Scenario                            | Outcome                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| Called before ready, queue enabled  | Enters the pre-ready queue. Resolves after flush and post. |
| Called before ready, queue disabled | Rejects with `BRIDGE_NOT_READY`                            |
| `signal` aborts before post         | Rejects with `OPERATION_ABORTED`                           |
| `signal` aborts after post          | No effect — the event was already sent                     |
| Invalid `timeoutMs`                 | Rejects with `OPERATION_INVALID_TIMEOUT`                   |

:::note

`sentEvent` resolves when the message leaves the parent. It does **not** mean the iframe received, processed, or acknowledged the event. For guaranteed processing, use `request()` and have the iframe respond when done.

:::

---

### `bridge.waitForEvent(name, options?)`

```ts
waitForEvent<TPayload = unknown>(
  name: string,
  options?: OperationOptions,
): Promise<TPayload>
```

Waits for the **next** matching inbound event from the iframe and resolves with its payload. Use this for one-shot event scenarios — such as waiting for an initialization signal, a user action confirmation, or a status update.

```ts
// Wait for a one-time status event
const { ready } = await bridge.waitForEvent<{ ready: boolean }>('app:status');

// With a custom timeout
const data = await bridge.waitForEvent('data:loaded', { timeoutMs: 10000 });

// With cancellation
const controller = new AbortController();
const promise = bridge.waitForEvent('transaction:complete', {
  signal: controller.signal,
});
```

**Parameters:**

| Parameter           | Type                     | Description                                                                                      |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `name`              | `string`                 | The event name to wait for. Must match the `name` field on the iframe's `bridge:event` envelope. |
| `options.timeoutMs` | `number` (optional)      | How long to wait for the event. Overrides `timeouts.operationTimeoutMs`.                         |
| `options.signal`    | `AbortSignal` (optional) | Cancels the wait.                                                                                |

**Returns:** `Promise<TPayload>` — resolves with the event payload from the first matching inbound event received after the waiter becomes active.

**Behavior:**

| Scenario                                | Outcome                                             |
| --------------------------------------- | --------------------------------------------------- |
| Called before ready, queue enabled      | Registration is queued. Timeout starts after flush. |
| Called before ready, queue disabled     | Rejects with `BRIDGE_NOT_READY`                     |
| Timeout elapses before matching event   | Rejects with `EVENT_WAIT_TIMEOUT`                   |
| `signal` aborts while queued or waiting | Rejects with `OPERATION_ABORTED`; waiter removed    |
| Bridge destroyed before resolution      | Rejects with `BRIDGE_DESTROYED`                     |
| Invalid `timeoutMs`                     | Rejects with `OPERATION_INVALID_TIMEOUT`            |

:::warning

`waitForEvent` only resolves for events that arrive **after** the waiter becomes active. If the iframe sends the event before you call `waitForEvent`, it will not be matched. Register the waiter before triggering the remote action.

:::

---

### `bridge.on(name, handler)`

```ts
on<TPayload = unknown>(
  name: string,
  handler: (payload: TPayload) => void,
): () => void
```

Registers a continuous event listener for inbound events from the iframe. Returns an unsubscribe function. Use this for persistent subscriptions — state changes, real-time data, or UI updates.

```ts
const unsubscribe = bridge.on<{ itemCount: number }>('cart:changed', (payload) => {
  console.log('Cart now has', payload.itemCount, 'items');
});

// Later, stop listening
unsubscribe();
```

**Parameters:**

| Parameter | Type                          | Description                                                            |
| --------- | ----------------------------- | ---------------------------------------------------------------------- |
| `name`    | `string`                      | The event name to subscribe to.                                        |
| `handler` | `(payload: TPayload) => void` | Callback invoked with the event payload when a matching event arrives. |

**Returns:** `() => void` — an unsubscribe function. Call it to remove the listener.

**Behavior:**

| Scenario                                       | Outcome                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Registered before ready                        | Listener installed. Events are dispatched only when the bridge is `ready`.                                                     |
| Registered after ready                         | Listener installed immediately. Receives future matching events.                                                               |
| Registered after destroyed or handshake_failed | Throws — listeners cannot be added to a non-operational bridge.                                                                |
| Bridge destroyed                               | All listeners removed. No further calls.                                                                                       |
| Handler throws                                 | Diagnostics emit `EVENT_LISTENER_ERROR` (if logger configured). Other listeners continue. Bridge operation is not interrupted. |

:::note

`on()` has no timeout semantics. It fires for every matching event until unsubscribed or the bridge is destroyed. For one-shot waiting, use `waitForEvent()`.

:::

---

### `bridge.whenReady()`

```ts
whenReady(): Promise<void>
```

Returns a promise that resolves when the bridge enters the `ready` state — after a valid `bridge:ready` is received from the iframe and validated. This does **not** send any protocol message; it is purely a lifecycle observation tool.

```ts
try {
  await bridge.whenReady();
  console.log('Bridge is ready — communication open');
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error('Bridge failed:', error.code);
  }
}
```

**Returns:** `Promise<void>` — resolves on ready, rejects on failure.

**Behavior:**

| Scenario                      | Outcome                                                  |
| ----------------------------- | -------------------------------------------------------- |
| Bridge already ready          | Resolves immediately                                     |
| Bridge becomes ready          | Resolves when the first valid `bridge:ready` is accepted |
| Handshake timeout elapses     | Rejects with `HANDSHAKE_TIMEOUT`                         |
| Bridge destroyed before ready | Rejects with `BRIDGE_DESTROYED`                          |

:::tip

Use `whenReady()` as a gate before calling operations when queueing is disabled. When queueing is enabled (the default), you can skip it and call operations immediately — they'll flush after readiness.

:::

---

### `bridge.remount()`

```ts
remount(): IframeBridge
```

Destroys the current bridge, detaches its iframe, and creates a fresh bridge attempt from the same configuration. Returns the **new** bridge instance — discard the old one and use the returned instance for all future communication.

```ts
// After a handshake failure, try again
if (bridge.state === 'handshake_failed') {
  bridge = bridge.remount();
  await bridge.whenReady();
}
```

**Returns:** `IframeBridge` — a new bridge instance created from the original config.

**Behavior:**

- Destroys the current bridge (same guarantees as `destroy()` — timer cleanup, listener removal, pending rejection, iframe detach).
- Creates a fresh iframe, fresh session id, fresh handshake timer, fresh message listener.
- If `bootstrap.session.paramValue` was explicitly set, that value is reused. For a new session id per attempt, leave it unset so the SDK generates one.
- Does **not** run automatically. Call it only when the host application intentionally wants a new attempt.

---

### `bridge.destroy()`

```ts
destroy(): void
```

Destroys the bridge instance. Idempotent — calling it multiple times is safe and has no additional effect.

```ts
bridge.destroy();
// Subsequent calls are no-ops
bridge.destroy(); // safe
```

**Behavior:**

- Removes the `message` event listener from `window`.
- Clears all active timers (handshake timeout, operation timeouts).
- Rejects all queued operations with `BRIDGE_DESTROYED`.
- Rejects all pending requests with `BRIDGE_DESTROYED`.
- Rejects all pending `waitForEvent` calls with `BRIDGE_DESTROYED`.
- Unsubscribes all continuous `on()` listeners.
- Detaches the owned iframe from its container (removes from DOM).
- Transitions state to `destroyed`.
- All future bridge method calls reject with `BRIDGE_DESTROYED`.

---

## Type-Safe Bridge

`TypedIframeBridge<TContract>` is a compile-time-only variant that narrows method names, payloads, and response types based on a contract map. At runtime, it behaves identically to `IframeBridge` — there is no runtime payload validation.

### Contract Shape

```ts
type IframeBridgeContract = {
  readonly requests?: Record<string, IframeBridgeRequestContract>;
  readonly outboundEvents?: Record<string, unknown>;
  readonly inboundEvents?: Record<string, unknown>;
};

type IframeBridgeRequestContract = {
  readonly payload: unknown;
  readonly response: unknown;
};
```

Each contract field defines a map from method/event name to its payload type:

| Contract field   | Controls                                                           |
| ---------------- | ------------------------------------------------------------------ |
| `requests`       | Narrows `request()` — method name, payload type, and response type |
| `outboundEvents` | Narrows `sendEvent()` — event name and payload type                |
| `inboundEvents`  | Narrows `on()` and `waitForEvent()` — event name and payload type  |

### TypedIframeBridge API

```ts
type TypedIframeBridge<TContract extends IframeBridgeContract> = Omit<
  IframeBridge,
  'on' | 'remount' | 'request' | 'sendEvent' | 'waitForEvent'
> & {
  request<TName extends /* keys of TContract['requests'] */>(
    method: TName,
    payload: /* TContract['requests'][TName]['payload'] */,
    options?: OperationOptions,
  ): Promise</* TContract['requests'][TName]['response'] */>;

  sendEvent<TName extends /* keys of TContract['outboundEvents'] */>(
    name: TName,
    payload: /* TContract['outboundEvents'][TName] */,
    options?: OperationOptions,
  ): Promise<void>;

  waitForEvent<TName extends /* keys of TContract['inboundEvents'] */>(
    name: TName,
    options?: OperationOptions,
  ): Promise</* TContract['inboundEvents'][TName] */>;

  on<TName extends /* keys of TContract['inboundEvents'] */>(
    name: TName,
    handler: (payload: /* TContract['inboundEvents'][TName] */) => void,
  ): () => void;

  remount(): TypedIframeBridge<TContract>;
};
```

### Example

```ts
type PartnerContract = {
  requests: {
    'user:get': {
      payload: { id: string };
      response: { name: string; email: string };
    };
    'report:generate': {
      payload: { start: string; end: string };
      response: { url: string };
    };
  };
  outboundEvents: {
    'analytics:track': { action: string; label?: string };
    'ui:resize': { width: number; height: number };
  };
  inboundEvents: {
    'cart:changed': { itemCount: number };
    'app:status': { ready: boolean; version: string };
  };
};

const bridge = createTypedIframeBridge<PartnerContract>({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

// ✅ Method names are narrowed — autocomplete works
const user = await bridge.request('user:get', { id: '123' });
//    ^? { name: string; email: string }

// ✅ Payload is narrowed — wrong shape is a compile error
await bridge.sendEvent('analytics:track', { action: 'opened' });

// ✅ Event name and handler payload are narrowed
bridge.on('cart:changed', (payload) => {
  //    ^? { itemCount: number }
  console.log(payload.itemCount);
});

// ❌ Compile error: 'unknown:method' is not a valid request method
// bridge.request('unknown:method', {});
```

:::note

The contract is **type-level only**. There is no runtime validation of method names or payload shapes. If the iframe sends a `cart:changed` event with a different shape, the TypeScript types will not catch it at runtime. For runtime validation, add your own checks inside the handler.

:::

---

## `OperationOptions`

```ts
type OperationOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};
```

Passed as the optional third argument to `request()`, `sendEvent()`, and `waitForEvent()`.

| Option      | Type          | Default                              | Description                                                                           |
| ----------- | ------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `timeoutMs` | `number`      | `timeouts.operationTimeoutMs` (5000) | Per-operation timeout in milliseconds. Overrides the default. Must be an integer ≥ 1. |
| `signal`    | `AbortSignal` | —                                    | An `AbortController` signal for cancelling the operation.                             |

**Validation:** If `timeoutMs` is invalid (not an integer, or < 1), the operation rejects with `OPERATION_INVALID_TIMEOUT`.

**Per-method behavior:**

| Method           | `timeoutMs` effect                                                                          | `signal` effect                                                           |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `request()`      | Starts after post; rejects with `REQUEST_TIMEOUT`                                           | Rejects with `OPERATION_ABORTED` if aborted while queued or pending       |
| `sendEvent()`    | Rejects with `OPERATION_INVALID_TIMEOUT` if set (fire-and-forget should not have a timeout) | Rejects with `OPERATION_ABORTED` if aborted before post; no-op after post |
| `waitForEvent()` | Starts after waiter active; rejects with `EVENT_WAIT_TIMEOUT`                               | Rejects with `OPERATION_ABORTED`; waiter removed                          |

---

## `IframeBridgeError`

```ts
class IframeBridgeError extends Error {
  readonly code: IframeBridgeErrorCode;
  readonly details?: unknown;
  constructor(code: IframeBridgeErrorCode, message: string, options?: IframeBridgeErrorOptions);
}
```

Every error thrown by the SDK is an instance of `IframeBridgeError`. Use `instanceof` to distinguish SDK errors from other exceptions in catch blocks.

```ts
import { IframeBridgeError } from 'iframe-helper-sdk';

try {
  const result = await bridge.request('user:get', { id: '123' });
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error('Bridge error:', error.code, error.message, error.details);
  } else {
    throw error; // re-throw non-SDK errors
  }
}
```

**Properties:**

| Property  | Type                    | Description                                                                                       |
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `code`    | `IframeBridgeErrorCode` | The error code. See [Error Codes](./error-codes) for every code, its cause, and recovery actions. |
| `message` | `string`                | Human-readable description of what went wrong.                                                    |
| `details` | `unknown`               | Optional additional context. For `REQUEST_REMOTE_ERROR`, contains the normalized remote error.    |
| `cause`   | `unknown`               | The original error that triggered this one, when available (standard `Error.cause`).              |

**`IframeBridgeErrorCode`** — the full union of all error codes:

```ts
type IframeBridgeErrorCode =
  | 'CONFIG_INVALID_CONTAINER'
  | 'CONFIG_INVALID_SRC'
  | 'CONFIG_INVALID_QUEUE'
  | 'CONFIG_INVALID_SECURITY_PROFILE'
  | 'CONFIG_INVALID_TIMEOUT'
  | 'CONFIG_UNSAFE_ORIGIN'
  | 'CONFIG_UNSAFE_PERMISSIONS_POLICY'
  | 'CONFIG_UNSAFE_SANDBOX'
  | 'DIAGNOSTICS_INVALID_MAX_ENTRIES'
  | 'HANDSHAKE_TIMEOUT'
  | 'HANDSHAKE_ORIGIN_MISMATCH'
  | 'HANDSHAKE_SOURCE_MISMATCH'
  | 'HANDSHAKE_SESSION_MISMATCH'
  | 'HANDSHAKE_PROTOCOL_MISMATCH'
  | 'HANDSHAKE_VERSION_MISMATCH'
  | 'BRIDGE_NOT_READY'
  | 'BRIDGE_DESTROYED'
  | 'QUEUE_LIMIT_EXCEEDED'
  | 'QUEUE_CLOSED'
  | 'OPERATION_INVALID_TIMEOUT'
  | 'OPERATION_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_REMOTE_ERROR'
  | 'EVENT_WAIT_TIMEOUT'
  | 'MESSAGE_INVALID_ENVELOPE'
  | 'MESSAGE_TARGET_MISMATCH';
```

For the complete error reference — what each code means, common causes, and recovery actions — see [Error Codes](./error-codes).

---

## `createDiagnosticRecorder(options?)`

```ts
function createDiagnosticRecorder(options?: DiagnosticRecorderOptions): DiagnosticRecorder;
```

Creates a diagnostic recorder for collecting bridge events during development and debugging. Pass its `logger` to the bridge's `diagnostics.logger` config, then inspect `recorder.entries` after operations complete.

```ts
import { createDiagnosticRecorder, createIframeBridge } from 'iframe-helper-sdk';

const recorder = createDiagnosticRecorder({ maxEntries: 100 });

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  diagnostics: {
    debug: true,
    logger: recorder.logger,
  },
});

await bridge.whenReady();
console.table(recorder.entries);
```

**Parameters:**

```ts
type DiagnosticRecorderOptions = {
  readonly maxEntries?: number; // default: Infinity
  readonly now?: () => number; // default: Date.now
};
```

**Returns:**

```ts
type DiagnosticRecorder = {
  readonly entries: readonly DiagnosticRecorderEntry[];
  readonly logger: Required<IframeBridgeLogger>;
  clear(): void;
};

type DiagnosticRecorderEntry = Readonly<
  DiagnosticEvent & {
    level: DiagnosticLevel;
    sequence: number;
    timestamp: number;
  }
>;
```

| Property / Method | Description                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `entries`         | Array of recorded diagnostic events, most recent first. Each entry extends `DiagnosticEvent` with `level`, `sequence`, and `timestamp`. |
| `logger`          | A `debug`/`warn`/`error` logger object that routes bridge diagnostics into `entries`. Pass this to `diagnostics.logger`.                |
| `clear()`         | Empties the recorded `entries` array.                                                                                                   |

:::note

The recorder does **not** capture raw `postMessage` data or application payloads. Events contain sanitized metadata — message type, session id, error codes, and lifecycle transitions. Application payload data is never included to avoid exposing PII or secrets in diagnostic logs.

:::

---

## Protocol Exports

These constants and utility functions are for iframe-side integrations and advanced parent-side message inspection. Most parent applications only need the factories and bridge instance API. If you're building an iframe application that speaks the bridge protocol, see [Wire Protocol](./wire-protocol).

### Constants

```ts
import {
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_PROTOCOL_NAME,
  BRIDGE_PROTOCOL_VERSION,
} from 'iframe-helper-sdk';
```

| Constant                  | Type                                                                                                 | Value                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `BRIDGE_PROTOCOL_NAME`    | `'iframe-bridge'`                                                                                    | The protocol name used in every envelope's `protocol` field.      |
| `BRIDGE_PROTOCOL_VERSION` | `1`                                                                                                  | The protocol version. Envelopes with other versions are rejected. |
| `BRIDGE_MESSAGE_TYPES`    | `readonly ['bridge:ready', 'bridge:connected', 'bridge:event', 'bridge:request', 'bridge:response']` | Tuple of all valid bridge message type strings.                   |

### Validation Functions

```ts
import {
  isBridgeEnvelope,
  validateBridgeEnvelope,
  normalizeBridgeRemoteError,
} from 'iframe-helper-sdk';
```

#### `isBridgeEnvelope(value)`

```ts
function isBridgeEnvelope(value: unknown): value is BridgeEnvelope;
```

Type guard that checks whether a value matches the bridge envelope shape. Returns `true` if the value has the correct `protocol`, `version`, `sessionId`, and `type` fields with expected types.

```ts
window.addEventListener('message', (event) => {
  if (isBridgeEnvelope(event.data)) {
    // event.data is now typed as BridgeEnvelope
    console.log(event.data.type);
  }
});
```

#### `validateBridgeEnvelope(value)`

```ts
function validateBridgeEnvelope(value: unknown): BridgeEnvelope;
```

Validates a value against the bridge envelope shape and returns it typed. Throws if the value is not a valid envelope — use `isBridgeEnvelope` first for conditionals, or `validateBridgeEnvelope` when you expect a valid envelope and want the error thrown on mismatch.

```ts
try {
  const envelope = validateBridgeEnvelope(event.data);
} catch {
  // Not a valid bridge envelope
}
```

**Validation rules:**

- `protocol` must be `'iframe-bridge'`
- `version` must be `1`
- `sessionId` must be a non-empty string
- `type` must be one of `BRIDGE_MESSAGE_TYPES`
- `name` must be non-empty for `bridge:event` and `bridge:request`
- `requestId` must be non-empty for `bridge:request` and `bridge:response`
- Remote errors must have non-empty `code` and `message`

#### `normalizeBridgeRemoteError(error)`

```ts
function normalizeBridgeRemoteError(error: unknown): BridgeEnvelopeError;
```

Normalizes a remote error value into the standard `{ code, message, data? }` shape. If the input is already a valid `BridgeEnvelopeError`, it is returned as-is. Otherwise, a fallback error with code `'REMOTE_ERROR'` and the original value as `data` is returned.

```ts
const envelope = validateBridgeEnvelope(event.data);
if (envelope.type === 'bridge:response' && envelope.error) {
  const { code, message, data } = normalizeBridgeRemoteError(envelope.error);
  console.error(`Remote error ${code}: ${message}`, data);
}
```

---

## Full Type Reference

<details>
<summary><code>IframeBridgeConfig</code></summary>

```ts
type IframeBridgeConfig = {
  // ── Required ──────────────────────────────
  container: Element | string;
  src: string | URL;

  // ── Iframe presentation ───────────────────
  iframeAttributes?: {
    title?: string;
    className?: string;
    id?: string;
    name?: string;
    allow?: string;
    allowFullscreen?: boolean;
    loading?: 'eager' | 'lazy';
    referrerPolicy?: ReferrerPolicy;
  };

  // ── Security ──────────────────────────────
  sandbox?: string | readonly string[];
  replaceContainerContent?: boolean;
  targetOrigin?: string;
  allowedOrigin?: string;
  allowInsecureLocalhost?: boolean;
  securityProfile?: 'development' | 'strict';

  // ── Bootstrap ─────────────────────────────
  bootstrap?: {
    session?: {
      paramName?: string;
      paramValue?: string;
      location?: 'query' | 'hash';
    };
    parentOrigin?: {
      enabled?: boolean;
      paramName?: string;
      value?: string;
      location?: 'query' | 'hash';
    };
    handshakeTimeoutMs?: number;
  };

  // ── Queue ─────────────────────────────────
  queue?: {
    enabled?: boolean;
    maxSize?: number;
  };

  // ── Timeouts ──────────────────────────────
  timeouts?: {
    operationTimeoutMs?: number;
  };

  // ── Diagnostics ───────────────────────────
  diagnostics?: {
    debug?: boolean;
    logger?: {
      debug?(event: DiagnosticEvent): void;
      warn?(event: DiagnosticEvent): void;
      error?(event: DiagnosticEvent): void;
    };
  };
};
```

</details>

<details>
<summary><code>IframeBridge</code></summary>

```ts
type IframeBridge = {
  readonly iframe: HTMLIFrameElement;
  readonly state: LifecycleState;
  request<TPayload = unknown, TResponse = unknown>(
    method: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<TResponse>;
  sendEvent<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<void>;
  waitForEvent<TPayload = unknown>(name: string, options?: OperationOptions): Promise<TPayload>;
  on<TPayload = unknown>(name: string, handler: (payload: TPayload) => void): () => void;
  whenReady(): Promise<void>;
  remount(): IframeBridge;
  destroy(): void;
};
```

</details>

<details>
<summary><code>IframeBridgeContract</code> and <code>TypedIframeBridge</code></summary>

```ts
type IframeBridgeContract = {
  readonly requests?: Record<string, IframeBridgeRequestContract>;
  readonly outboundEvents?: Record<string, unknown>;
  readonly inboundEvents?: Record<string, unknown>;
};

type IframeBridgeRequestContract = {
  readonly payload: unknown;
  readonly response: unknown;
};

type TypedIframeBridge<TContract extends IframeBridgeContract> = Omit<
  IframeBridge,
  'on' | 'remount' | 'request' | 'sendEvent' | 'waitForEvent'
> & {
  request: /* narrowed by TContract['requests'] */;
  sendEvent: /* narrowed by TContract['outboundEvents'] */;
  waitForEvent: /* narrowed by TContract['inboundEvents'] */;
  on: /* narrowed by TContract['inboundEvents'] */;
  remount(): TypedIframeBridge<TContract>;
};
```

</details>

<details>
<summary><code>LifecycleState</code></summary>

```ts
type LifecycleState =
  | 'created'
  | 'mounting'
  | 'waiting_for_handshake'
  | 'ready'
  | 'handshake_failed'
  | 'destroyed';
```

</details>

<details>
<summary><code>OperationOptions</code></summary>

```ts
type OperationOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};
```

</details>

<details>
<summary><code>IframeBridgeError</code> and related types</summary>

```ts
class IframeBridgeError extends Error {
  readonly code: IframeBridgeErrorCode;
  readonly details?: unknown;
  constructor(code: IframeBridgeErrorCode, message: string, options?: IframeBridgeErrorOptions);
}

type IframeBridgeErrorOptions = {
  details?: unknown;
  cause?: unknown;
};

type IframeBridgeErrorCode =
  | 'CONFIG_INVALID_CONTAINER'
  | 'CONFIG_INVALID_SRC'
  | 'CONFIG_INVALID_QUEUE'
  | 'CONFIG_INVALID_SECURITY_PROFILE'
  | 'CONFIG_INVALID_TIMEOUT'
  | 'CONFIG_UNSAFE_ORIGIN'
  | 'CONFIG_UNSAFE_PERMISSIONS_POLICY'
  | 'CONFIG_UNSAFE_SANDBOX'
  | 'DIAGNOSTICS_INVALID_MAX_ENTRIES'
  | 'HANDSHAKE_TIMEOUT'
  | 'HANDSHAKE_ORIGIN_MISMATCH'
  | 'HANDSHAKE_SOURCE_MISMATCH'
  | 'HANDSHAKE_SESSION_MISMATCH'
  | 'HANDSHAKE_PROTOCOL_MISMATCH'
  | 'HANDSHAKE_VERSION_MISMATCH'
  | 'BRIDGE_NOT_READY'
  | 'BRIDGE_DESTROYED'
  | 'QUEUE_LIMIT_EXCEEDED'
  | 'QUEUE_CLOSED'
  | 'OPERATION_INVALID_TIMEOUT'
  | 'OPERATION_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_REMOTE_ERROR'
  | 'EVENT_WAIT_TIMEOUT'
  | 'MESSAGE_INVALID_ENVELOPE'
  | 'MESSAGE_TARGET_MISMATCH';
```

</details>

<details>
<summary><code>DiagnosticEvent</code>, <code>DiagnosticRecorder</code>, and logger types</summary>

```ts
type DiagnosticLevel = 'debug' | 'warn' | 'error';

type DiagnosticEvent = {
  message: string;
  code?: string;
  details?: unknown;
  level?: DiagnosticLevel;
  sessionId?: string;
};

type IframeBridgeLogger = {
  debug?(event: DiagnosticEvent): void;
  warn?(event: DiagnosticEvent): void;
  error?(event: DiagnosticEvent): void;
};

type IframeBridgeDiagnosticsConfig = {
  debug?: boolean;
  logger?: IframeBridgeLogger;
};

type DiagnosticRecorderOptions = {
  readonly maxEntries?: number;
  readonly now?: () => number;
};

type DiagnosticRecorderEntry = Readonly<
  DiagnosticEvent & {
    level: DiagnosticLevel;
    sequence: number;
    timestamp: number;
  }
>;

type DiagnosticRecorder = {
  readonly entries: readonly DiagnosticRecorderEntry[];
  readonly logger: Required<IframeBridgeLogger>;
  clear(): void;
};
```

</details>

<details>
<summary><code>BridgeEnvelope</code> and protocol types</summary>

```ts
type BridgeProtocolName = 'iframe-bridge';
type BridgeProtocolVersion = 1;

type BridgeMessageType =
  | 'bridge:ready'
  | 'bridge:connected'
  | 'bridge:event'
  | 'bridge:request'
  | 'bridge:response';

type BridgeEnvelopeError = {
  code: string;
  message: string;
  data?: unknown;
};

type BridgeEnvelopeBase<TType extends BridgeMessageType> = {
  protocol: BridgeProtocolName;
  version: BridgeProtocolVersion;
  sessionId: string;
  type: TType;
};

type BridgeReadyEnvelope = BridgeEnvelopeBase<'bridge:ready'>;
type BridgeConnectedEnvelope = BridgeEnvelopeBase<'bridge:connected'>;

type BridgeEventEnvelope<TPayload = unknown> = BridgeEnvelopeBase<'bridge:event'> & {
  name: string;
  payload?: TPayload;
};

type BridgeRequestEnvelope<TPayload = unknown> = BridgeEnvelopeBase<'bridge:request'> & {
  requestId: string;
  name: string;
  payload?: TPayload;
};

type BridgeResponseEnvelope<TPayload = unknown> = BridgeEnvelopeBase<'bridge:response'> & {
  requestId: string;
  payload?: TPayload;
  error?: BridgeEnvelopeError;
};

type BridgeEnvelope<TPayload = unknown> =
  | BridgeReadyEnvelope
  | BridgeConnectedEnvelope
  | BridgeEventEnvelope<TPayload>
  | BridgeRequestEnvelope<TPayload>
  | BridgeResponseEnvelope<TPayload>;
```

</details>

---

## Next Steps

- **[Error Codes](./error-codes)** — Every error code with common causes and recovery actions.
- **[Configuration](./configuration)** — Complete reference for every `IframeBridgeConfig` option.
- **[Type-Safe Bridge](./typed-bridge)** — Deep-dive on contract maps and typed communication.
- **[Wire Protocol](./wire-protocol)** — The envelope specification for iframe-side integrations.
- **[Security](./security)** — Security model, profiles, CSP guidance, and production checklist.
- **[Debugging & Diagnostics](./debugging)** — Diagnostic recorder workflows and logger hooks.
- **[Troubleshooting](./troubleshooting)** — Diagnostic flowcharts for common problems.

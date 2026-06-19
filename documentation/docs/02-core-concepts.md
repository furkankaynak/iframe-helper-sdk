---
sidebar_position: 3
slug: core-concepts
toc_max_heading_level: 3
description: Understand the mental model, lifecycle, handshake, and communication patterns behind the iframe bridge SDK — the "why" behind the API.
---

# Core Concepts

This page explains the design and guarantees behind the iframe bridge SDK. If you want to start building immediately, see [Getting Started](./getting-started) for a hands-on walkthrough. Come back here when you need to understand _why_ things work the way they do.

---

## Mental Model

The SDK sits between your parent page and a cross-domain iframe. It creates and manages exactly **one isolated bridge instance per iframe element**. There is no global event bus — every bridge has its own lifecycle, queue, pending operations, and cleanup.

```mermaid
flowchart LR
    Parent["Your Parent App"] -->|createIframeBridge| Bridge["Bridge Instance"]
    Bridge -->|"postMessage (exact origin)"| Iframe["Iframe App"]
    Iframe -->|"postMessage (exact origin)"| Bridge
    Bridge -->|"request / on / sendEvent"| Parent
```

- **Your parent app** calls the SDK factory, then uses the returned bridge instance to communicate.
- **The bridge instance** owns the iframe element, validates every message, manages timeouts, and surfaces typed errors.
- **The iframe app** does not import this SDK. It implements the [raw wire protocol](./wire-protocol) directly — reading bootstrap parameters from its URL, sending `bridge:ready`, and responding to parent requests with the documented envelope format.

Every bridge is independent. If you mount three iframes, you get three bridge instances, three session ids, three separate message listeners, and three independent lifecycles. No message crosses between bridges unless you explicitly route it yourself.

---

## Lifecycle

Every bridge instance moves through a predictable sequence of states. You cannot go backwards, and only certain operations are valid in each state.

```mermaid
stateDiagram-v2
    [*] --> created
    created --> mounting: iframe element created
    mounting --> waiting_for_handshake: listener installed, iframe mounted
    waiting_for_handshake --> ready: valid bridge:ready received
    waiting_for_handshake --> handshake_failed: handshake timeout elapsed
    ready --> destroyed: destroy() or remount()
    handshake_failed --> destroyed: destroy() or remount()
    created --> destroyed: destroy() (early)
    mounting --> destroyed: destroy() (early)
    waiting_for_handshake --> destroyed: destroy() (early)
```

### What you can do in each state

| State                   | Bridge operations                                                                | What the SDK is doing                                                                                |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `created`               | `destroy()` only                                                                 | Config validated, bridge object returned. Iframe not yet created.                                    |
| `mounting`              | `destroy()` only                                                                 | Iframe element built, attributes assigned, `src` about to be set. Listeners not yet installed.       |
| `waiting_for_handshake` | `request()`, `sendEvent()`, `waitForEvent()`, `on()`, `whenReady()`, `destroy()` | Listener installed, iframe loading. Operations go into the pre-ready queue. Handshake timer ticking. |
| `ready`                 | All operations                                                                   | Bridge operational. Queue flushed. Messages flowing.                                                 |
| `handshake_failed`      | `destroy()`, `remount()` only                                                    | Timer expired without a valid `bridge:ready`. Queued operations rejected.                            |
| `destroyed`             | None — all calls reject with `BRIDGE_DESTROYED`                                  | Listeners removed, timers cleared, iframe detached.                                                  |

:::tip[Why no `initializing` or `reconnecting` states?]

The lifecycle is intentionally minimal. There is no `bridge:init` message in the protocol, no automatic retry, and no reconnection. If the handshake fails, the host application decides what to do next — show a fallback UI, call `remount()` for a fresh attempt, or tear down. This keeps the SDK predictable and avoids hidden state machines.

:::

Access the current state at any time:

```ts
console.log(bridge.state); // 'ready'
```

---

## Handshake

The bridge uses a **ready-first handshake**. The parent does not send an initiation message — it waits for the iframe to declare readiness. This is a deliberate design choice.

### Why ready-first?

The alternative — init-first — would have the parent send `bridge:init` and wait for the iframe to respond with `bridge:ready`. This creates several problems:

| Concern              | Init-first                                                                      | Ready-first (this SDK)                                                   |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Message ordering     | Parent must send init before the iframe can act                                 | Iframe declares readiness when it's actually ready                       |
| Duplicate risk       | Parent must guard against sending init twice                                    | No init to duplicate; the iframe sends ready once                        |
| Iframe unawareness   | If the iframe ignores init, the parent has no way to know the init was received | If the iframe never sends ready, the timeout fires — unambiguous failure |
| Bootstrap dependency | Iframe must wait for an inbound message before it can act                       | Iframe reads bootstrap params from its URL and fires ready immediately   |

The ready-first model means the iframe integration always controls its own readiness. The parent's job is to wait, validate, and respond with `bridge:connected`.

### Validation chain

When a `message` event arrives on the parent window, the SDK runs a strict validation chain before accepting any message as a valid bridge envelope:

1. **Origin** — Does `event.origin` exactly match the configured `allowedOrigin`? Wildcards rejected.
2. **Source** — Is `event.source` the same `Window` object as the owned iframe? Prevents cross-iframe leaks.
3. **Protocol** — Does `event.data.protocol === 'iframe-bridge'`? Ignores non-bridge messages.
4. **Version** — Is `event.data.version === 1`? Future-proofing for protocol evolution.
5. **Session** — Does `event.data.sessionId` match this bridge's session? Routes to the correct bridge.
6. **Envelope** — Does the message shape match the expected type (`bridge:ready`, `bridge:event`, `bridge:response`)?

All six checks must pass. A message that fails any check is silently ignored — it does not trigger errors, reject promises, or surface to your application code. (It _may_ appear in diagnostic logs if you've configured a [diagnostic recorder](./debugging).)

### One-shot acceptance

The SDK accepts only the **first** valid `bridge:ready`. After that:

- Duplicate `bridge:ready` messages do **not** re-trigger the state transition.
- `bridge:connected` is sent exactly once.
- The pre-ready queue is flushed exactly once.
- `whenReady()` resolves exactly once — or immediately if already ready.

If the iframe sends `bridge:ready` too late (after the handshake timer expires), the message is ignored and the bridge stays in `handshake_failed`.

For the full handshake sequence diagram, see [Getting Started → Understanding the Handshake](./getting-started#understanding-the-handshake).

---

## Communication Patterns

The bridge offers four communication primitives. Choosing the right one depends on whether you need a response and whether you expect one event or many.

### Request / Response

```ts
const result = await bridge.request<TPayload, TResponse>(method, payload, options?);
```

Use when you need the iframe to do work and send back a result. The parent sends a `bridge:request` envelope with a unique `requestId`, and the bridge resolves the promise when a matching `bridge:response` arrives.

- **Direction:** Parent → Iframe → Parent
- **Waits for:** A response from the iframe
- **Timeout:** Yes (`operationTimeoutMs`, per-operation `timeoutMs`, or `signal` abort)
- **Error cases:** `REQUEST_TIMEOUT`, `REQUEST_REMOTE_ERROR`, `OPERATION_ABORTED`, `BRIDGE_DESTROYED`

### Fire-and-Forget Events

```ts
await bridge.sendEvent<TPayload>(name, payload, options?);
```

Use for one-way notifications where you don't need confirmation. The promise resolves when the message is posted — it does not prove the iframe processed it.

- **Direction:** Parent → Iframe (no response expected)
- **Waits for:** Nothing beyond local post
- **Timeout:** Only for queue wait; resolves immediately once posted
- **Error cases:** `QUEUE_LIMIT_EXCEEDED`, `OPERATION_ABORTED`, `BRIDGE_DESTROYED`

:::warning

Aborting a `sendEvent()` only cancels the local post. The message may already have been delivered to the iframe. If you need to confirm the iframe acted on the event, use `request()` instead.

:::

### One-Shot Event Wait

```ts
const payload = await bridge.waitForEvent<TPayload>(name, options?);
```

Use when you expect the iframe to send **one** specific event in response to a known action. It resolves with the next matching inbound event after the waiter is active.

- **Direction:** Iframe → Parent (one event)
- **Waits for:** The next matching inbound event
- **Timeout:** Yes (`operationTimeoutMs`, per-operation `timeoutMs`, or `signal` abort)
- **Error cases:** `EVENT_WAIT_TIMEOUT`, `OPERATION_ABORTED`, `BRIDGE_DESTROYED`

### Continuous Listeners

```ts
const unsubscribe = bridge.on<TPayload>(name, (payload) => { ... });
```

Use for events the iframe may send at any time and any number of times — status updates, notifications, data pushes. Returns an unsubscribe function; call it to stop listening.

- **Direction:** Iframe → Parent (zero or more events)
- **Waits for:** Nothing — fires callback on every matching event
- **Timeout:** None — runs until you unsubscribe or the bridge is destroyed
- **Error cases:** Listener errors are surfaced through diagnostics; other routes continue

### When to use which

| You want to...                                        | Use              |
| ----------------------------------------------------- | ---------------- |
| Ask the iframe a question and get an answer           | `request()`      |
| Notify the iframe of something, no reply needed       | `sendEvent()`    |
| Wait for a specific one-time event from the iframe    | `waitForEvent()` |
| React to every occurrence of an event from the iframe | `on()`           |

---

## Sessions

Every bridge instance generates a **session id** — a random string appended to the iframe URL and echoed back in every protocol envelope.

The session id is:

- **Correlation** — it ties messages to a specific bridge instance so the parent can route correctly when multiple iframes are present.
- **Ephemeral** — a new session is generated for each `createIframeBridge()` call (unless you supply a fixed `bootstrap.session.paramValue`).
- **Public** — it appears in the iframe URL as a query or hash parameter. Anyone who can see the iframe's `src` can see the session id.

The session id is **not**:

- **Authentication** — it does not prove the iframe is who it claims to be.
- **A secret** — do not treat it as a token, API key, or credential.
- **Proof of trust** — the iframe echoes it back, but a malicious iframe could echo anything.
- **CSRF protection** — origin enforcement and your server-side auth handle that.

:::tip

The session guarantees correlation, not security. Security comes from exact origin validation, source window checks, and your own authentication layer. See [Security](./security) for the full model.

:::

You can customize the session parameter name, value, and location (query string vs. hash) through `bootstrap.session`. See [Configuration](./configuration) for details.

---

## Origins

The SDK enforces **exact origin matching** on every message. This is the foundation of the security model.

### Rules

- **No wildcards.** `'*'` is rejected at config validation time. Every origin must be a fully qualified string like `'https://partner.example'`.
- **HTTPS by default.** Non-`localhost` HTTP origins are rejected with `CONFIG_UNSAFE_ORIGIN`. Use `allowInsecureLocalhost: true` for local development only.
- **No paths, query strings, or hashes.** `'https://partner.example/app'` is rejected. Origins are scheme + host + port only.
- **No embedded credentials.** `'https://user:pass@partner.example'` is rejected.

### How origins are derived

| Config field    | Default derivation     | Purpose                                              |
| --------------- | ---------------------- | ---------------------------------------------------- |
| `targetOrigin`  | `new URL(src).origin`  | Origin used for parent-to-iframe `postMessage` calls |
| `allowedOrigin` | `new URL(src).origin`  | Origin accepted for iframe-to-parent messages        |
| `src`           | (required, no default) | URL loaded into the iframe                           |

You can set `targetOrigin` and `allowedOrigin` explicitly when the iframe redirects to a different origin or when you want to document the expected origin in code.

### What happens on mismatch

If the iframe sends messages from an origin that doesn't match `allowedOrigin`, those messages are silently ignored. The handshake never completes, and eventually `whenReady()` rejects with `HANDSHAKE_TIMEOUT`.

If you configure a `targetOrigin` that doesn't match the actual iframe origin, the browser blocks `postMessage` delivery. Bridge operations silently fail and eventually time out.

:::warning

Both mismatches produce timeout errors, not origin-mismatch errors. The SDK cannot know _why_ the iframe didn't respond — only that it didn't. Use [diagnostics](./debugging) to detect mismatches during development.

:::

---

## Isolation

Each bridge instance is fully isolated from every other bridge instance on the page.

| What's isolated        | How                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Message routing**    | Inbound `message` events are validated against `event.source` — only messages from the owned iframe window are accepted for that bridge. |
| **Session ids**        | Each bridge generates its own unique session id. Messages with a different session id are ignored.                                       |
| **Pre-ready queue**    | Each bridge has its own bounded queue. A full queue on one bridge does not affect another.                                               |
| **Lifecycle state**    | Each bridge moves through its own state machine independently.                                                                           |
| **Pending operations** | Timers, abort signals, and pending promises are scoped to one bridge.                                                                    |
| **Event listeners**    | `on()` subscriptions are per-bridge. Destroying one bridge does not affect listeners on another.                                         |
| **Cleanup**            | Calling `destroy()` on one bridge removes only that bridge's listeners, timers, and iframe element.                                      |

This means you can mount multiple iframes and treat each one as an independent integration — no shared state, no accidental cross-talk, no cleanup interference.

```ts
const bridgeA = createIframeBridge({ container: '#widget-a', src: 'https://a.example/app' });
const bridgeB = createIframeBridge({ container: '#widget-b', src: 'https://b.example/app' });

// These never interfere with each other
await bridgeA.whenReady();
await bridgeB.whenReady();
```

---

## Summary: What the SDK Does vs. What You Do

| The SDK handles                                                                     | You handle                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Creating and mounting the iframe element                                            | Providing a container element and iframe URL                             |
| Generating session ids and appending bootstrap URL params                           | Customizing bootstrap param names/locations if needed                    |
| Installing and managing `message` event listeners                                   | Nothing — the listener is fully managed                                  |
| Validating `event.origin`, `event.source`, protocol, version, session, and envelope | Configuring exact `targetOrigin` / `allowedOrigin`                       |
| Queueing pre-ready operations and flushing on handshake                             | Deciding whether to enable or disable the queue                          |
| Enforcing per-operation timeouts and cleaning up timers                             | Configuring timeout values appropriate for your integration              |
| Rejecting queued/pending operations on handshake failure or destroy                 | Calling `destroy()` when the integration should end                      |
| Surfaceing structured `IframeBridgeError` codes for branching                       | Catching errors and implementing recovery logic                          |
| Emitting sanitized diagnostic events                                                | Connecting diagnostic hooks to your logging                              |
| **Nothing** related to authentication or authorization                              | Authenticating users, authorizing actions, applying server-side security |
| **Nothing** related to CSP or server-side headers                                   | Setting `frame-src` on the parent, `frame-ancestors` on the iframe       |
| **Nothing** related to iframe-side message handling                                 | Implementing the raw wire protocol on the iframe side                    |

---

## Next Steps

- **[Configuration](./configuration)** — Every option, grouped by category, with defaults and rationale.
- **[Security](./security)** — Security model, profiles, CSP guidance, and production checklist.
- **[Type-Safe Bridge](./typed-bridge)** — Define a contract map once, get full TypeScript narrowing.
- **[Wire Protocol](./wire-protocol)** — The envelope specification for iframe-side integrations.
- **[Debugging & Diagnostics](./debugging)** — Plug in diagnostic recorders and logger hooks.

Or jump back to [Getting Started](./getting-started) for hands-on usage.

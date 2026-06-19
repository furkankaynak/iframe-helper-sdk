---
sidebar_position: 0
toc_max_heading_level: 3
---

# Iframe Helper SDK

**Secure, structured communication between a parent page and cross-domain iframes.**

Embed iframes from separate origins without reaching for `window.postMessage` directly. The SDK handles origin validation, handshake verification, message queueing, and typed request/response contracts — so you can focus on what the iframe _does_ instead of how to talk to it.

---

## Key Features

- **Strict origin enforcement** — exact origin matching, no wildcards. The SDK rejects `'*'` and verifies every message source against the configured origin.
- **Bounded message queue** — requests sent before the handshake completes are queued automatically and flushed once the bridge is ready. Configurable size limit prevents unbounded memory growth.
- **Request/response with timeouts** — every request gets a timeout, and timed-out operations are cleaned up so they can't interfere with future communication.
- **Compile-time typed contracts** — optional `createTypedIframeBridge` provides full TypeScript narrowing for method names, payloads, and responses without any runtime cost.
- **Fire-and-forget events** — send events to the iframe (or listen for inbound events) as one-way notifications with no response overhead.
- **Diagnostics built in** — plug in a diagnostic recorder to capture lifecycle events, message routing, and errors for debugging and monitoring.
- **Zero dependencies** — the runtime payload is a single ES2020 bundle with no external dependencies.
- **~2 KB gzipped** — small enough to not matter in your bundle budget.

---

## Why Use This Library

### Raw `postMessage` Is Error-Prone

The browser gives you `window.postMessage` and `message` events. That's a firehose. Every tab, extension, and iframe on the page uses the same channel. Without discipline you end up with:

- Messages leaking between unrelated iframes
- No handshake guarantees — you send requests to an iframe that hasn't loaded
- Origin validation bugs (`'*'` is easy, `event.origin === expected` is harder)
- Ad-hoc message formats that diverge between teams
- No timeout management, no queuing, no error taxonomy

### This SDK Gives You a Protocol

Instead of raw `postMessage`, you get a bridge instance bound to one iframe, one origin. It manages the handshake, queues messages, enforces timeouts, and surfaces errors with structured codes you can branch on.

| Concern | Raw `postMessage` | Iframe Helper SDK |
|---|---|---|
| Origin validation | Manual, easy to misconfigure | Exact origin enforced per bridge |
| Handshake | None, or DIY | Ready-first handshake with timeout |
| Message format | Ad-hoc JSON | Standardized envelope (bridge protocol) |
| Request queueing | Not built in | Bounded queue, automatically flushed |
| Timeouts | Must implement yourself | Configurable per-operation timeouts |
| Typed contracts | Manual type assertions | Compile-time narrowing via contracts |
| Error handling | Generic `Error` | `IframeBridgeError` with code-based branching |
| Diagnostics | `console.log` debugging | Pluggable diagnostic recorder and logger |

---

## At a Glance

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

await bridge.whenReady();
const user = await bridge.request('user:get', { id: '123' });
```

Three steps: create a bridge, wait for the iframe to say it's ready, start sending requests. The bridge handles origin verification, session routing, queueing, and cleanup behind the scenes.

---

## Who Is This For

You're embedding an iframe that lives on a different origin (or the same origin, under controlled conditions) and you want structured communication with it. The SDK is for the **parent page**. The iframe application does not need to import this package — it only needs to follow the [wire protocol](./wire-protocol) for the handshake and message format.

**Use this SDK if you:**
- Embed a partner widget, chat panel, or micro-frontend from a separate domain
- Want type-safe method contracts between your app and an embedded iframe
- Need origin enforcement and message routing that's auditable and debuggable
- Maintain a platform that third parties embed into

**You probably don't need this SDK if:**
- Your iframe is purely presentational (no communication needed)
- You're building a single-team monolith where same-origin `postMessage` suffices
- You're on the iframe side only — the SDK runs in the parent context

---

## Next Steps

- **[Getting Started](./getting-started)** — Install the SDK and create your first bridge in under 5 minutes.
- **[Core Concepts](./core-concepts)** — Understand the lifecycle, handshake, and communication patterns.
- **[GitHub](https://github.com/furkankaynak/iframe-helper-sdk)** — Source code, issues, and contributing.

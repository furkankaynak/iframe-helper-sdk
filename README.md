# Iframe Helper SDK

[![npm version](https://img.shields.io/npm/v/iframe-helper-sdk)](https://www.npmjs.com/package/iframe-helper-sdk)
[![license](https://img.shields.io/npm/l/iframe-helper-sdk)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/iframe-helper-sdk)](https://bundlephobia.com/package/iframe-helper-sdk)
[![node](https://img.shields.io/node/v/iframe-helper-sdk)](https://nodejs.org/)

**Secure, structured communication between a parent page and cross-domain iframes.**

Embed iframes from separate origins without reaching for `window.postMessage` directly. The SDK handles origin validation, handshake verification, message queueing, and typed request/response contracts — so you focus on what the iframe _does_ instead of how to talk to it.

## Key Features

- **Strict origin enforcement** — exact origin matching, no wildcards. Every message source is validated against the configured origin.
- **Bounded message queue** — requests sent before the handshake completes are queued automatically and flushed once the bridge is ready.
- **Request/response with timeouts** — every request gets a timeout; timed-out operations are cleaned up so they can't interfere with future communication.
- **Compile-time typed contracts** — optional `createTypedIframeBridge` provides full TypeScript narrowing for method names, payloads, and responses without runtime cost.
- **Fire-and-forget events** — send events to the iframe (or listen for inbound events) as one-way notifications with no response overhead.
- **Diagnostics built in** — plug in a diagnostic recorder to capture lifecycle events, message routing, and errors for debugging and monitoring.
- **Zero dependencies** — the runtime payload is a single ES2020 bundle with no external dependencies.
- **~2 KB gzipped** — small enough to not matter in your bundle budget.

## Quick Start

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

## Installation

```bash
npm install iframe-helper-sdk
```

```bash
yarn add iframe-helper-sdk
```

```bash
pnpm add iframe-helper-sdk
```

TypeScript types are included — no separate `@types/` package needed. Requires Node.js 18+ at build time; at runtime the SDK targets ES2020 browsers.

## Documentation

Full documentation at **[furkankaynak.github.io/iframe-helper-sdk](https://furkankaynak.github.io/iframe-helper-sdk/)**:

| Section      | Pages                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Introduction | Home, Getting Started, Core Concepts                                           |
| Guides       | Configuration, Type-Safe Bridge, Wire Protocol, Security, Use Cases, Debugging |
| Reference    | API Reference, Error Codes                                                     |
| Help         | Troubleshooting, FAQ                                                           |

Source code and issues: [github.com/furkankaynak/iframe-helper-sdk](https://github.com/furkankaynak/iframe-helper-sdk)

## Communication Patterns

The bridge exposes four communication primitives:

| You want to...                                  | Use                               |
| ----------------------------------------------- | --------------------------------- |
| Ask the iframe a question and get an answer     | `bridge.request(method, payload)` |
| Notify the iframe of something, no reply needed | `bridge.sendEvent(name, payload)` |
| Wait for a one-time event from the iframe       | `bridge.waitForEvent(name)`       |
| React to every occurrence of an event           | `bridge.on(name, handler)`        |

## Type-Safe Bridge

For integrations with many methods, define a contract map once and get full TypeScript narrowing everywhere:

```ts
import { createTypedIframeBridge } from 'iframe-helper-sdk';

type Contract = {
  requests: {
    'user:get': { payload: { id: string }; response: { name: string } };
  };
  outboundEvents: {
    'analytics:track': { action: string };
  };
  inboundEvents: {
    'cart:changed': { itemCount: number };
  };
};

const bridge = createTypedIframeBridge<Contract>({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

await bridge.whenReady();
const user = await bridge.request('user:get', { id: '123' });
//      ^ typed as { name: string }

await bridge.sendEvent('analytics:track', { action: 'opened' });
//      ^ only accepts { action: string }

bridge.on('cart:changed', (payload) => {
  //                ^ typed as { itemCount: number }
  console.log(payload.itemCount);
});
```

This is **compile-time only** — the runtime wire protocol is identical to `createIframeBridge`. No runtime schema validation, no additional bytes.

## Error Handling

Every API that can fail throws an `IframeBridgeError` with a structured `code` property you can branch on:

```ts
import { IframeBridgeError } from 'iframe-helper-sdk';

try {
  const user = await bridge.request('user:get', { id: '123' });
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error('Bridge error:', error.code, error.message, error.details);
  } else {
    throw error; // re-throw non-SDK errors
  }
}
```

| Code                   | Meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `REQUEST_TIMEOUT`      | The iframe didn't respond before the operation timeout.             |
| `REQUEST_REMOTE_ERROR` | The iframe responded with an explicit error object.                 |
| `OPERATION_ABORTED`    | The `AbortSignal` you provided was triggered.                       |
| `BRIDGE_NOT_READY`     | Queueing is disabled and you called a method before readiness.      |
| `BRIDGE_DESTROYED`     | The bridge was destroyed while the operation was pending.           |
| `HANDSHAKE_TIMEOUT`    | The iframe didn't send `bridge:ready` within the handshake timeout. |

See the full [Error Codes reference](https://furkankaynak.github.io/iframe-helper-sdk/error-codes) for all 25 error codes and recovery actions.

## Iframe Application (Protocol)

The iframe does **not** need to import this SDK. It implements the raw protocol directly:

```ts
// 1. Read bootstrap parameters from the URL
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('__iframeBridgeSessionId');
const parentOrigin = params.get('__iframeBridgeParentOrigin');

// 2. Send bridge:ready to the parent
window.parent.postMessage(
  { protocol: 'iframe-bridge', version: 1, sessionId, type: 'bridge:ready' },
  parentOrigin,
);

// 3. Listen for parent messages
window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) return;
  const msg = event.data;
  if (msg?.protocol !== 'iframe-bridge' || msg?.sessionId !== sessionId) return;

  switch (msg.type) {
    case 'bridge:connected':
      console.log('Connected!');
      break;
    case 'bridge:request':
      // Process request, send bridge:response back
      window.parent.postMessage(
        {
          protocol: 'iframe-bridge',
          version: 1,
          sessionId,
          type: 'bridge:response',
          requestId: msg.requestId,
          payload: { name: 'Ada' },
        },
        parentOrigin,
      );
      break;
  }
});
```

Full protocol specification: [Wire Protocol](https://furkankaynak.github.io/iframe-helper-sdk/wire-protocol)

## Manual Example

The repository includes working parent/iframe playgrounds under `playground/manual/`:

```bash
npm run build
npm run example:manual:parent
npm run example:manual:iframe
```

Open `http://127.0.0.1:5173/` after both dev servers are running. The parent server serves `playground/manual/parent` as its root, and the iframe server serves `playground/manual/iframe`.

## Development

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run lint
npm run format:check
```

| Script                 | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `npm run build`        | Production build (Vite + tsc + CJS types)                                    |
| `npm run test`         | Vitest test runner                                                           |
| `npm run typecheck`    | TypeScript type checking (`tsc --noEmit`)                                    |
| `npm run lint`         | ESLint                                                                       |
| `npm run format:check` | Prettier format check                                                        |
| `npm run verify`       | Full CI pipeline (typecheck + test + lint + format + build + publint + attw) |
| `npm run docs:dev`     | Start Docusaurus documentation server                                        |
| `npm run docs:build`   | Build documentation site                                                     |

## License

[MIT](./LICENSE)

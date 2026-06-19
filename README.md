# Iframe Helper SDK

[![npm version](https://img.shields.io/npm/v/iframe-helper-sdk)](https://www.npmjs.com/package/iframe-helper-sdk)
[![docs](https://github.com/furkankaynak/iframe-helper-sdk/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/furkankaynak/iframe-helper-sdk/actions/workflows/deploy-docs.yml)
[![types](https://img.shields.io/npm/types/iframe-helper-sdk)](https://www.npmjs.com/package/iframe-helper-sdk)
[![bundle size](https://img.shields.io/bundlephobia/minzip/iframe-helper-sdk)](https://bundlephobia.com/package/iframe-helper-sdk)
[![license](https://img.shields.io/npm/l/iframe-helper-sdk)](./LICENSE)

**Secure, structured communication between a parent page and cross-domain iframes.**

`iframe-helper-sdk` is a zero-dependency TypeScript SDK for parent-side iframe integrations. It wraps `window.postMessage` with exact origin validation, ready-first handshakes, session routing, bounded queueing, request/response timeouts, fire-and-forget events, diagnostics, and optional compile-time typed contracts.

Use it when you need a small, auditable bridge between your application and an embedded iframe without building a custom protocol from scratch.

## Install

```bash
npm install iframe-helper-sdk
```

```bash
pnpm add iframe-helper-sdk
```

```bash
yarn add iframe-helper-sdk
```

Types are included. No separate `@types/*` package is required.

## Quick Start

### Parent Page

The SDK runs in the parent page. Give it a container and an iframe URL, wait for the iframe to complete the handshake, then start communicating.

```ts
import { IframeBridgeError, createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  iframeAttributes: {
    title: 'Partner application',
  },
  securityProfile: 'strict',
});

try {
  await bridge.whenReady();

  const user = await bridge.request<{ id: string }, { name: string }>('user:get', {
    id: '123',
  });

  console.log(user.name);
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error('Bridge failed:', error.code, error.details);
  } else {
    throw error;
  }
}
```

### Iframe Application

The iframe application does not need to install this SDK. It implements the wire protocol directly by reading the bootstrap parameters and replying with protocol envelopes.

```ts
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('__iframeBridgeSessionId');
const parentOrigin = params.get('__iframeBridgeParentOrigin');

if (!sessionId || !parentOrigin) {
  throw new Error('Missing iframe bridge bootstrap parameters.');
}

window.parent.postMessage(
  {
    protocol: 'iframe-bridge',
    version: 1,
    sessionId,
    type: 'bridge:ready',
  },
  parentOrigin,
);

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) return;

  const message = event.data;
  if (message?.protocol !== 'iframe-bridge' || message?.version !== 1) return;
  if (message.sessionId !== sessionId) return;

  if (message.type === 'bridge:request' && message.name === 'user:get') {
    window.parent.postMessage(
      {
        protocol: 'iframe-bridge',
        version: 1,
        sessionId,
        type: 'bridge:response',
        requestId: message.requestId,
        payload: { name: 'Ada Lovelace' },
      },
      parentOrigin,
    );
  }
});
```

See the full [Wire Protocol](https://furkankaynak.github.io/iframe-helper-sdk/wire-protocol) for every envelope type and validation rule.

## Why This SDK

Raw `postMessage` is intentionally low-level. Every window, iframe, tab, and extension can send messages on the same channel. A production iframe integration needs more structure than a `message` event listener.

| Concern           | Raw `postMessage`       | Iframe Helper SDK                             |
| ----------------- | ----------------------- | --------------------------------------------- |
| Origin validation | Manual and easy to miss | Exact origin enforced per bridge              |
| Handshake         | None or custom          | Ready-first handshake with timeout            |
| Message format    | Ad hoc JSON             | Versioned `iframe-bridge` envelopes           |
| Request queueing  | Not built in            | Bounded pre-ready queue                       |
| Timeouts          | Manual timers           | Configurable operation timeouts               |
| Typed contracts   | Manual type assertions  | Compile-time narrowing via contract maps      |
| Error handling    | Generic errors          | `IframeBridgeError` with code-based branching |
| Diagnostics       | Console logging         | Opt-in diagnostic recorder and logger hooks   |

## Features

- **Strict origin enforcement** - exact `targetOrigin` and `allowedOrigin` checks. Wildcard origins are rejected.
- **Ready-first handshake** - the parent waits for `bridge:ready`, validates the sender, then responds with `bridge:connected`.
- **Session-scoped routing** - every bridge gets a session id so messages from unrelated iframes are ignored.
- **Bounded pre-ready queue** - operations called before readiness are queued and flushed after handshake, with a configurable limit.
- **Request/response API** - `bridge.request()` sends a method call and resolves with the iframe response.
- **Event API** - `bridge.sendEvent()`, `bridge.on()`, and `bridge.waitForEvent()` cover one-way and inbound event flows.
- **Typed contracts** - `createTypedIframeBridge` narrows method names, payloads, and responses at compile time with no runtime cost.
- **Structured errors** - every SDK error is an `IframeBridgeError` with a stable `code` and optional `details`.
- **Diagnostics** - use `createDiagnosticRecorder` or a custom logger to observe lifecycle, handshake, queue, and filtering decisions.
- **Small runtime** - zero runtime dependencies, tree-shakable package output, and a compact browser payload.

## Communication Patterns

| You want to                                  | Use                                   |
| -------------------------------------------- | ------------------------------------- |
| Wait until the iframe is ready               | `bridge.whenReady()`                  |
| Ask the iframe for a result                  | `bridge.request(method, payload)`     |
| Notify the iframe without waiting for a body | `bridge.sendEvent(name, payload)`     |
| Subscribe to iframe events                   | `bridge.on(name, handler)`            |
| Wait for one matching iframe event           | `bridge.waitForEvent(name, options?)` |
| Recreate a failed bridge attempt             | `bridge.remount()`                    |
| Remove listeners, timers, and the iframe     | `bridge.destroy()`                    |

## Type-Safe Bridge

Use `createTypedIframeBridge` when your integration has enough methods or events that repeated generics become noisy. The contract exists only at compile time. It does not validate runtime payloads and is not a security boundary.

```ts
import { createTypedIframeBridge } from 'iframe-helper-sdk';

type PartnerContract = {
  requests: {
    'user:get': {
      payload: { id: string };
      response: { name: string; email: string };
    };
    'order:create': {
      payload: { productId: string; quantity: number };
      response: { orderId: string };
    };
  };
  outboundEvents: {
    'analytics:track': { action: string; label?: string };
  };
  inboundEvents: {
    'cart:changed': { itemCount: number };
  };
};

const bridge = createTypedIframeBridge<PartnerContract>({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

await bridge.whenReady();

const user = await bridge.request('user:get', { id: '123' });
// user is { name: string; email: string }

await bridge.sendEvent('analytics:track', { action: 'opened' });

bridge.on('cart:changed', (payload) => {
  console.log(payload.itemCount);
});
```

Read more in the [Type-Safe Bridge guide](https://furkankaynak.github.io/iframe-helper-sdk/typed-bridge).

## Security Model

This SDK is a transport and lifecycle layer, not a complete application security solution. It reduces common `postMessage` mistakes, but authentication, authorization, payload validation, CSRF protection, and server-side business rules remain your responsibility.

Enforced by the SDK:

- Parent-to-iframe messages always use an exact target origin.
- Inbound messages are validated against origin, source window, session id, protocol name, protocol version, and envelope shape.
- HTTPS iframe URLs are required by default. HTTP is only allowed for explicit localhost development mode.
- Unsafe URL schemes such as `javascript:`, `data:`, `blob:`, and `srcdoc` are rejected.
- `securityProfile: 'strict'` turns risky production settings into config errors.
- `destroy()` removes SDK-owned listeners, timers, pending requests, event waits, and the owned iframe.

Production checklist:

- Use HTTPS for both parent and iframe origins.
- Set `securityProfile: 'strict'` once local development is complete.
- Keep `targetOrigin` and `allowedOrigin` exact. Do not use wildcard origins.
- Add parent-side CSP such as `frame-src https://partner.example`.
- Add iframe-side CSP such as `frame-ancestors https://host.example`.
- Review iframe `sandbox` and `allow` attributes before enabling browser capabilities.
- Validate critical payloads in your application layer or backend.

Read the full [Security guide](https://furkankaynak.github.io/iframe-helper-sdk/security) before shipping a cross-domain integration.

## API Surface

Import public APIs from the package root only.

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
```

| Export                       | Kind     | Purpose                                             |
| ---------------------------- | -------- | --------------------------------------------------- |
| `createIframeBridge`         | Function | Create a parent-side iframe bridge                  |
| `createTypedIframeBridge`    | Function | Create the same bridge with contract-narrowed types |
| `createDiagnosticRecorder`   | Function | Capture diagnostic events in a bounded recorder     |
| `IframeBridgeError`          | Class    | SDK error with `code`, `message`, and `details`     |
| `BRIDGE_MESSAGE_TYPES`       | Constant | Tuple of protocol message type strings              |
| `BRIDGE_PROTOCOL_NAME`       | Constant | Protocol name, currently `'iframe-bridge'`          |
| `BRIDGE_PROTOCOL_VERSION`    | Constant | Protocol version, currently `1`                     |
| `isBridgeEnvelope`           | Function | Type guard for bridge envelopes                     |
| `validateBridgeEnvelope`     | Function | Validate and return a typed bridge envelope         |
| `normalizeBridgeRemoteError` | Function | Normalize iframe-side error responses               |

### Bridge Instance

```ts
type IframeBridge = {
  readonly iframe: HTMLIFrameElement;
  readonly state:
    | 'created'
    | 'mounting'
    | 'waiting_for_handshake'
    | 'ready'
    | 'handshake_failed'
    | 'destroyed';
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

Full reference: [API Reference](https://furkankaynak.github.io/iframe-helper-sdk/api-reference).

## Error Handling

All SDK errors use `IframeBridgeError`. Branch on `error.code` instead of parsing strings.

```ts
import { IframeBridgeError } from 'iframe-helper-sdk';

try {
  await bridge.whenReady();
  const result = await bridge.request('report:generate', payload, {
    timeoutMs: 30_000,
  });
  console.log(result);
} catch (error) {
  if (error instanceof IframeBridgeError) {
    switch (error.code) {
      case 'HANDSHAKE_TIMEOUT':
        console.error('The iframe did not complete the handshake.');
        break;
      case 'REQUEST_TIMEOUT':
        console.error('The iframe did not respond in time.');
        break;
      case 'REQUEST_REMOTE_ERROR':
        console.error('The iframe returned an error:', error.details);
        break;
      default:
        console.error(error.code, error.message, error.details);
    }
  } else {
    throw error;
  }
}
```

Common codes:

| Code                   | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `HANDSHAKE_TIMEOUT`    | The iframe did not send a valid `bridge:ready` in time         |
| `REQUEST_TIMEOUT`      | A request was sent, but no matching response arrived in time   |
| `REQUEST_REMOTE_ERROR` | The iframe responded with an explicit error object             |
| `EVENT_WAIT_TIMEOUT`   | `waitForEvent()` did not receive the expected event in time    |
| `OPERATION_ABORTED`    | The provided `AbortSignal` cancelled the operation             |
| `BRIDGE_NOT_READY`     | Queueing is disabled and an operation ran before readiness     |
| `BRIDGE_DESTROYED`     | The bridge was destroyed before the operation could complete   |
| `QUEUE_LIMIT_EXCEEDED` | Too many operations were queued before the iframe became ready |

See the [Error Codes reference](https://furkankaynak.github.io/iframe-helper-sdk/error-codes) for the complete list and recovery actions.

## Diagnostics

Diagnostics are opt-in. Use the built-in recorder for local debugging or plug your own logger into monitoring.

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

Diagnostics are sanitized by design and do not include raw application payloads by default. See [Debugging & Diagnostics](https://furkankaynak.github.io/iframe-helper-sdk/debugging).

## Documentation

Full documentation: [furkankaynak.github.io/iframe-helper-sdk](https://furkankaynak.github.io/iframe-helper-sdk/)

| Section      | Pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Introduction | [Home](https://furkankaynak.github.io/iframe-helper-sdk/), [Getting Started](https://furkankaynak.github.io/iframe-helper-sdk/getting-started), [Core Concepts](https://furkankaynak.github.io/iframe-helper-sdk/core-concepts)                                                                                                                                                                                                                                              |
| Guides       | [Configuration](https://furkankaynak.github.io/iframe-helper-sdk/configuration), [Type-Safe Bridge](https://furkankaynak.github.io/iframe-helper-sdk/typed-bridge), [Wire Protocol](https://furkankaynak.github.io/iframe-helper-sdk/wire-protocol), [Security](https://furkankaynak.github.io/iframe-helper-sdk/security), [Use Cases](https://furkankaynak.github.io/iframe-helper-sdk/use-cases), [Debugging](https://furkankaynak.github.io/iframe-helper-sdk/debugging) |
| Reference    | [API Reference](https://furkankaynak.github.io/iframe-helper-sdk/api-reference), [Error Codes](https://furkankaynak.github.io/iframe-helper-sdk/error-codes)                                                                                                                                                                                                                                                                                                                 |
| Help         | [Troubleshooting](https://furkankaynak.github.io/iframe-helper-sdk/troubleshooting), [FAQ](https://furkankaynak.github.io/iframe-helper-sdk/faq)                                                                                                                                                                                                                                                                                                                             |

Documentation source lives in [`documentation/docs`](./documentation/docs).

## Examples

The repository includes a working parent and iframe playground under [`playground/manual`](./playground/manual).

```bash
npm run build
```

Then run the parent and iframe dev servers in separate terminals:

```bash
npm run example:manual:parent
```

```bash
npm run example:manual:iframe
```

Open `http://127.0.0.1:5173/`. The parent server runs on port `5173`, and the iframe server runs on port `5174`.

## Compatibility

- **Runtime:** Browser environments with `window`, `document`, `HTMLIFrameElement`, and `postMessage`.
- **SSR:** Browser-only. Create bridges inside client-only lifecycle hooks such as React `useEffect`, Vue `onMounted`, or Svelte `onMount`.
- **Build target:** ES2020 browser output.
- **Package formats:** ESM and CommonJS, with TypeScript declarations for both import styles.
- **Node.js:** `>=18` for development, build, and package tooling.
- **Dependencies:** Zero runtime dependencies.

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
| `npm run build`        | Production build with Vite, TypeScript declarations, and CJS type prep       |
| `npm run test`         | Vitest test suite                                                            |
| `npm run typecheck`    | TypeScript type checking with `tsc --noEmit`                                 |
| `npm run lint`         | ESLint                                                                       |
| `npm run format`       | Format source, tests, playground, docs, config, and README files             |
| `npm run format:check` | Prettier format check                                                        |
| `npm run verify`       | Full release gate: typecheck, test, lint, format, build, publint, attw, pack |
| `npm run docs:dev`     | Start the Docusaurus documentation server                                    |
| `npm run docs:build`   | Build the documentation site                                                 |

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/furkankaynak/iframe-helper-sdk). For changes to the public API, update the documentation and README examples in the same pull request.

Before opening a PR, run:

```bash
npm run verify
npm run docs:build
```

## License

[MIT](./LICENSE)

# Iframe Helper SDK

Parent-side TypeScript SDK for mounting cross-domain iframes and communicating with iframe applications through a strict-origin, per-iframe bridge instance.

## Install

```bash
npm install iframe-helper-sdk
```

## Development

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run lint
npm run format:check
```

## Basic Usage

```ts
import { createDiagnosticRecorder, createIframeBridge, IframeBridgeError } from 'iframe-helper-sdk';

const recorder = createDiagnosticRecorder({ maxEntries: 100 });

const bridge = createIframeBridge({
  container: '#frame-root',
  src: 'https://partner.example/app',
  securityProfile: 'strict',
  iframeAttributes: {
    title: 'Partner application',
    referrerPolicy: 'no-referrer',
  },
  diagnostics: {
    debug: true,
    logger: recorder.logger,
  },
});

try {
  await bridge.whenReady();

  const user = await bridge.request<{ id: string }, { name: string }>('user:get', { id: '123' });

  const controller = new AbortController();

  await bridge.sendEvent<{ userId: string }>(
    'analytics:user-viewed',
    { userId: '123' },
    { signal: controller.signal, timeoutMs: 3000 },
  );

  const status = await bridge.waitForEvent<{ ready: boolean }>('app:status', {
    timeoutMs: 3000,
  });

  const unsubscribe = bridge.on<{ count: number }>('cart:changed', (payload) => {
    console.log(payload.count);
  });

  console.log(user.name, status.ready);
  console.table(recorder.entries);
  unsubscribe();
} catch (error) {
  if (error instanceof IframeBridgeError) {
    console.error(error.code, error.details);
  }
}
```

The iframe application does not import this SDK. It must read the bootstrap URL parameters, send `bridge:ready` to the exact parent origin, and then use the documented bridge envelope. The parent SDK uses a ready-first handshake and does not send `bridge:init`.

## Public API

- `createIframeBridge(config)` is the root factory export.
- `createTypedIframeBridge<TContract>(config)` provides optional contract-map typing without changing runtime behavior.
- `createDiagnosticRecorder(options?)` records sanitized logger diagnostics for debugging and examples.
- `securityProfile: 'strict'` turns selected unsafe iframe settings into config errors; omitted config preserves development-compatible warning behavior.
- Bridge instances expose `request<TPayload, TResponse>`, `sendEvent<TPayload>`, `waitForEvent<TPayload>`, `on<TPayload>`, `whenReady`, `remount`, `destroy`, `state`, and `iframe`.
- Operation options support `timeoutMs` and optional `signal?: AbortSignal`.
- `IframeBridgeError`, protocol constants, protocol guards, and public TypeScript types are exported from the package root.

## Documentation

Docs site: **[furkankaynak.github.io/iframe-helper-sdk](https://furkankaynak.github.io/iframe-helper-sdk/)**

- Product requirements: [`.docs/prd.md`](.docs/prd.md)
- Architecture decisions: [`.docs/decisions.md`](.docs/decisions.md)
- Usage and API guide: [`.docs/usage.md`](.docs/usage.md)
- Use-case config examples: [`.docs/use-case-config-examples.md`](.docs/use-case-config-examples.md)
- Security roadmap: [`.docs/security-roadmap.md`](.docs/security-roadmap.md)
- Design plan: [`.docs/plans/2026-06-10-iframe-bridge-sdk-design.md`](.docs/plans/2026-06-10-iframe-bridge-sdk-design.md)
- Implementation plan: [`.docs/plans/2026-06-10-iframe-bridge-sdk-implementation-plan.md`](.docs/plans/2026-06-10-iframe-bridge-sdk-implementation-plan.md)

## Manual Example

The repository includes manual parent/iframe playgrounds under `playground/manual`. They are not part of the library bundle and are excluded from the package runtime payload by the existing `files` allowlist.

```bash
npm run build
npm run example:manual:parent
npm run example:manual:iframe
```

Open `http://127.0.0.1:5173/` after both dev servers are running. The parent server serves `playground/manual/parent` as its root, and the iframe server serves `playground/manual/iframe` as its root.

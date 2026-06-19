---
sidebar_position: 5
slug: typed-bridge
toc_max_heading_level: 3
description: Define a contract map once to get compile-time TypeScript narrowing for all bridge methods — no runtime cost, no schema libraries, no extra bytes.
---

# Type-Safe Bridge

The base `createIframeBridge()` API gives you method-level generics — every call site controls its own types. That works well for small integrations. When your bridge surface grows to dozens of request methods and event names, repeating type annotations on every call becomes noisy and error-prone.

`createTypedIframeBridge` solves this by letting you define a **contract map** — one TypeScript type that describes every method name, payload, and response your bridge supports. The compiler then narrows every method call automatically. No runtime schema validation. No extra kilobytes. No behavior change.

---

## Before: Method-Level Generics

With the base `createIframeBridge()`, you supply type parameters on each call:

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

await bridge.whenReady();

// Every call site must repeat the payload and response types
const user = await bridge.request<{ id: string }, { name: string }>('user:get', { id: '123' });

await bridge.sendEvent<{ action: string }>('analytics:track', {
  action: 'opened',
});

bridge.on<{ itemCount: number }>('cart:changed', (payload) => {
  console.log(payload.itemCount);
});
```

This gives you full type safety on each individual call. But the compiler can't check whether `'user:get'` is a valid method name, whether you passed the right payload shape, or whether `'cart:changed'` is an event the iframe actually sends. The type parameters are local to each call site — there's no single source of truth for the bridge's entire interface.

---

## After: Contract Maps

Define the bridge's full interface once as a type, then pass it to `createTypedIframeBridge`. The compiler checks every method name, payload shape, and return type against that contract.

```ts
import { createTypedIframeBridge } from 'iframe-helper-sdk';
import type { IframeBridgeContract } from 'iframe-helper-sdk';

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
    'ui:notification': { level: 'info' | 'warn'; message: string };
  };
  inboundEvents: {
    'cart:changed': { itemCount: number };
    'app:status': { ready: boolean };
  };
};

// The compiler narrows every method automatically
const bridge = createTypedIframeBridge<PartnerContract>({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

await bridge.whenReady();

const user = await bridge.request('user:get', { id: '123' });
//      ^ typed as { name: string; email: string }
//      Compiler rejects: bridge.request('user:missing', ...)

await bridge.sendEvent('analytics:track', { action: 'opened' });
//      ^ only accepts { action: string; label?: string }
//      Compiler rejects: bridge.sendEvent('cart:changed', ...)

bridge.on('cart:changed', (payload) => {
  //                ^ typed as { itemCount: number }
  console.log(payload.itemCount);
});

const status = await bridge.waitForEvent('app:status');
//      ^ typed as { ready: boolean }
```

The config object passed to `createTypedIframeBridge` is identical to `createIframeBridge` — all the same options work exactly the same way. The type parameter is the only difference.

:::tip

The contract type is structural, not sealed. If the iframe adds new methods later, you can add entries to the contract without touching any call sites. Old call sites stay typed; new ones get the expanded surface.

:::

---

## Contract Shape

The contract is a plain TypeScript type with three optional sections. Every section is optional — you only define what your bridge uses.

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

### `requests`

Parent-to-iframe request/response pairs. Each entry maps a method name to a `{ payload, response }` object.

Use `requests` for every `bridge.request()` call your parent makes. The compiler checks the method name, payload shape, and return type.

If omitted, `request()` is not narrowed — it still works but accepts any `string` method name and any payload, returning `unknown`.

```ts
requests: {
  'user:get': { payload: { id: string }; response: { name: string } };
  'search:query': { payload: { term: string }; response: { results: string[] } };
}
```

### `outboundEvents`

Fire-and-forget events the parent sends to the iframe via `sendEvent()`. Each entry maps an event name to its payload type.

Use `outboundEvents` for every `bridge.sendEvent()` call. The compiler checks the event name and payload shape.

If omitted, `sendEvent()` is not narrowed — it still works but accepts any `string` name and any payload.

```ts
outboundEvents: {
  'analytics:track': { action: string; label?: string };
}
```

### `inboundEvents`

Events the iframe sends to the parent, handled by `on()` and `waitForEvent()`. Each entry maps an event name to its payload type.

Use `inboundEvents` for both continuous listeners (`on`) and one-shot waiters (`waitForEvent`). The compiler checks the event name and narrows the payload in the callback or return type.

If omitted, `on()` and `waitForEvent()` are not narrowed — they still work but accept any `string` name, with payloads typed as `unknown`.

```ts
inboundEvents: {
  'cart:changed': { itemCount: number };
}
```

### Why three separate sections?

The contract separates request names, outbound event names, and inbound event names so the compiler can enforce correct usage at each call site. For example:

- You can't send an inbound event (`sendEvent('cart:changed', ...)`) — the compiler rejects it.
- You can't use `on()` or `waitForEvent()` with a request method name.
- Each section can be authored, reviewed, and versioned independently as the bridge surface grows.

---

## Runtime Behavior

`createTypedIframeBridge` and `createIframeBridge` share the **exact same runtime code**. The typed factory is a thin wrapper that calls the same internal implementation and returns the same bridge controller — it only adds a TypeScript cast.

```ts
// Simplified: the real implementation
function createTypedIframeBridge<TContract extends IframeBridgeContract>(
  config: IframeBridgeConfig,
): TypedIframeBridge<TContract> {
  return createIframeBridgeInternal(config) as TypedIframeBridge<TContract>;
}
```

This means:

- **Zero runtime cost** — no extra allocations, no schema walking, no runtime type maps.
- **Zero extra bytes** — tree-shaking removes the typed factory entirely if you don't import it.
- **Identical wire protocol** — the iframe sees the same `bridge:request` and `bridge:response` envelopes regardless of which factory you used.
- **Identical error behavior** — timeouts, aborts, and remote errors work exactly the same.
- **Identical lifecycle** — handshake, queue, destroy, and remount behavior is unchanged.

---

## Typed Remount

`bridge.remount()` preserves the contract type on the returned instance:

```ts
const bridge = createTypedIframeBridge<PartnerContract>({ ... });

const newBridge = bridge.remount();
//      ^ TypedIframeBridge<PartnerContract> — not widened back to IframeBridge

await newBridge.request('user:get', { id: '456' });
//                        ^ still narrowed to contract methods
```

This means you can safely destroy and recreate a bridge in error-recovery flows without losing type safety.

---

## When to Use Which

| Scenario                                                   | Use                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Single iframe, 1–3 methods                                 | `createIframeBridge` with per-call generics                           |
| Bridge surface grows beyond 4–5 methods                    | `createTypedIframeBridge` with a contract map                         |
| Multiple iframes sharing the same contract                 | `createTypedIframeBridge` — define the contract once, reuse it        |
| Contract lives in a shared types package                   | `createTypedIframeBridge` — import the contract type and pass it      |
| Team wants a single source of truth for the bridge surface | `createTypedIframeBridge` — the contract type serves as documentation |
| Rapid prototyping or exploration                           | `createIframeBridge` — no upfront type definition needed              |

You can also use both in the same project. Different iframe integrations have different complexity — choose the right API for each one.

---

## Limitations

The typed bridge is a developer experience feature. Understand what it does and doesn't provide:

### No runtime payload validation

The contract narrows TypeScript types at compile time. At runtime, the bridge still transports `unknown` payloads through `postMessage`. If the iframe sends a response with the wrong shape, the parent receives it without errors unless you validate it yourself.

```ts
// This compiles — the type says { name: string }
const user = await bridge.request('user:get', { id: '123' });

// But at runtime, user could be anything the iframe actually sent.
// The compiler can't prove the iframe conforms to the contract.
```

:::danger

Treat the contract as documentation the iframe should follow, not as a security boundary. Malicious or buggy iframes can send arbitrary data regardless of the contract type. Always validate critical data on the server side.

:::

### TypeScript-only

The contract works only in TypeScript codebases. JavaScript consumers use `createIframeBridge` with the same runtime behavior but no compile-time narrowing. If your team uses plain JavaScript, the contract provides no benefit.

### No code generation

The contract is not a schema — there's no code generation, no JSON Schema output, and no automatic iframe-side types. If the iframe team uses TypeScript, consider sharing the contract type in a separate types package.

### Contract consistency is manual

Nothing enforces that the iframe actually implements the methods you declared in the contract. If you add `'order:delete'` to the contract but the iframe never handles it, requests will time out at runtime. The contract is a promise you and the iframe team keep together — testing and integration verification are still essential.

---

## Sharing Contracts Across Teams

When the parent and iframe teams both use TypeScript, extract the contract into a shared package:

```ts
// @partner/shared-contracts
import type { IframeBridgeContract } from 'iframe-helper-sdk';

export type PartnerContract = {
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

// Ensure the contract satisfies the SDK's constraint
// This line is compile-time only — if PartnerContract doesn't match IframeBridgeContract, the build fails
const _check: IframeBridgeContract = null! as PartnerContract;
```

The iframe team can then extract types from the same contract for their internal request handlers without importing the SDK itself:

```ts
// Iframe-side (does not import iframe-helper-sdk)
type Requests = PartnerContract['requests'];

function handleUserGet(payload: Requests['user:get']['payload']): Requests['user:get']['response'] {
  return { name: payload.id }; // type-safe
}
```

---

## Migration Path

You don't need to convert everything at once. Start with `createIframeBridge` and migrate to a typed bridge when the surface grows:

### Step 1: Keep the untyped bridge

```ts
const bridge = createIframeBridge({ container: '#root', src: 'https://partner.example/app' });
```

### Step 2: Extract the contract type

Collect the method names, payloads, and responses you're already using in per-call generics:

```ts
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
```

### Step 3: Switch the factory

```ts
const bridge = createTypedIframeBridge<Contract>({
  container: '#root',
  src: 'https://partner.example/app',
});
```

### Step 4: Remove per-call generics

Delete the type parameters you were passing to each `request()`, `sendEvent()`, and `on()` call. The compiler will flag any mismatches — fix them based on what the contract says the iframe actually supports.

---

## Next Steps

- **[API Reference](./api-reference)** — Full signature reference for `createTypedIframeBridge`, `TypedIframeBridge`, and `IframeBridgeContract`.
- **[Wire Protocol](./wire-protocol)** — The envelope specification that the iframe must follow, regardless of which factory you use.
- **[Security](./security)** — Understand why the contract is not a security boundary and what real protections the SDK provides.
- **[Use Cases & Recipes](./use-cases)** — Copy-pasteable configurations with typed bridge examples.
- **[Configuration](./configuration)** — All config options work identically with `createTypedIframeBridge`.

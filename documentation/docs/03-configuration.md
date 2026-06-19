---
sidebar_position: 4
slug: configuration
toc_max_heading_level: 3
description: Every configuration option for createIframeBridge — grouped by category, with types, defaults, validation rules, and when to use each one.
---

# Configuration

The `IframeBridgeConfig` object passed to `createIframeBridge()` controls every aspect of how the SDK creates, mounts, secures, and communicates with a cross-domain iframe. Most options have sensible defaults — you only need two to get started.

This page covers every option, grouped by what it controls. For copy-pasteable configurations tuned to specific scenarios — production partner integrations, local development, sandboxed embeds — see [Use Cases & Recipes](./use-cases).

---

## Required Options

These two options have no defaults. You must provide them every time you call `createIframeBridge()`.

### `container`

**Type:** `Element | string`

The DOM mount target for the iframe. Pass an existing `Element` reference when your framework already holds one (e.g., a React ref), or a CSS selector string when the SDK should resolve the element from the document.

```ts
// Using a selector
createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});

// Using an existing element reference
const el = document.getElementById('partner-frame');
createIframeBridge({
  container: el,
  src: 'https://partner.example/app',
});
```

**Validation:** If `container` is not an element, is an invalid selector, requires `document` when none exists, or the selector matches nothing, `createIframeBridge()` throws `CONFIG_INVALID_CONTAINER` synchronously — before creating the bridge instance.

---

### `src`

**Type:** `string | URL`

The absolute URL loaded into the iframe. The SDK appends bootstrap parameters (session id, parent origin) to this URL before assigning `iframe.src`. You can pass a `URL` object or a string — the SDK normalizes both.

```ts
createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
});
```

**Validation:** Lots of things can go wrong here, and all of them throw synchronously:

| Condition | Error code |
|---|---|
| `src` is missing or not parseable as an absolute URL | `CONFIG_INVALID_SRC` |
| `src` includes embedded credentials (`user:pass@`) | `CONFIG_INVALID_SRC` |
| `src` uses `javascript:`, `data:`, `blob:`, or another unsupported scheme | `CONFIG_INVALID_SRC` |
| `src` uses HTTP (and it's not `localhost` with `allowInsecureLocalhost`) | `CONFIG_UNSAFE_ORIGIN` |

:::tip

If your iframe URL already has query parameters or a hash, the SDK appends bootstrap parameters without removing them. If the iframe app needs to read those original parameters, they'll still be there.

:::

---

## Iframe Attributes

The `iframeAttributes` object controls DOM presentation, accessibility, browser loading behavior, Permissions Policy, and referrer behavior. None of these affect the bridge protocol or origin validation.

```ts
type IframeBridgeIframeAttributes = {
  title?: string;
  className?: string;
  id?: string;
  name?: string;
  allow?: string;
  allowFullscreen?: boolean;
  loading?: 'eager' | 'lazy';
  referrerPolicy?: ReferrerPolicy;
};
```

### `iframeAttributes.title`

**Type:** `string`

Sets `iframe.title`. Provide an accessible name for the embedded application — especially important when the iframe is visible or interactive.

```ts
iframeAttributes: {
  title: 'Partner application',
}
```

If omitted, the SDK leaves `title` unset. The bridge works, but screen readers will have no label for the iframe unless the host page provides accessible context through other means.

---

### `iframeAttributes.className`

**Type:** `string`

Sets `iframe.className`. Use when your host stylesheet controls iframe size, borders, layout, or responsive behavior through CSS classes.

```ts
iframeAttributes: {
  className: 'partner-frame',
}
```

If omitted, the SDK does not add a class. Browser and host stylesheet defaults apply.

---

### `iframeAttributes.id`

**Type:** `string`

Sets `iframe.id`. Use when you need a stable DOM id for CSS, automated tests, analytics, or legacy integration code.

```ts
iframeAttributes: {
  id: 'partner-frame',
}
```

If omitted, the SDK does not assign an id. The iframe element is still accessible through `bridge.iframe`.

---

### `iframeAttributes.name`

**Type:** `string`

Sets `iframe.name` — the browsing context name. Use only when the embedded app or host environment requires a named browsing context (e.g., legacy form targets or integrations that inspect `window.name`).

```ts
iframeAttributes: {
  name: 'partner-context',
}
```

If omitted, the iframe has no SDK-assigned browsing context name.

---

### `iframeAttributes.allow`

**Type:** `string`

Sets the iframe `allow` attribute for browser Permissions Policy features (fullscreen, clipboard, camera, geolocation, etc.). Grant only the features the iframe actually needs, scoped to exact origins where possible.

```ts
iframeAttributes: {
  allow: 'clipboard-write https://partner.example; fullscreen https://partner.example',
}
```

:::warning

Wildcard grants (e.g., `'camera *'`) are detected during validation. In `securityProfile: 'strict'`, they throw `CONFIG_UNSAFE_PERMISSIONS_POLICY`. In `'development'` mode (the default), they emit a diagnostics warning but allow the bridge to proceed.

:::

If omitted, the SDK does not grant additional feature permissions through `allow`; browser defaults, parent policy, and iframe-origin policy apply.

---

### `iframeAttributes.allowFullscreen`

**Type:** `boolean`

Sets `iframe.allowFullscreen`. Use when the iframe application needs to enter fullscreen mode.

```ts
iframeAttributes: {
  allowFullscreen: true,
}
```

If omitted, the browser default applies.

---

### `iframeAttributes.loading`

**Type:** `'eager' | 'lazy'`

Sets `iframe.loading`. Use `'lazy'` for below-the-fold or optional embeds to defer loading; use `'eager'` when the iframe should load immediately (the browser default).

```ts
iframeAttributes: {
  loading: 'lazy',
}
```

If omitted, the browser decides its default loading behavior.

---

### `iframeAttributes.referrerPolicy`

**Type:** `ReferrerPolicy`

Sets `iframe.referrerPolicy` for the iframe navigation request. Use to limit or remove the `Referer` header sent when the iframe loads.

```ts
iframeAttributes: {
  referrerPolicy: 'no-referrer',
}
```

If omitted, the browser default and any page-level referrer policy apply.

---

## Security Options

These options control origin validation, sandboxing, security profile, and container cleanup. They are the foundation of the bridge's security model. For the full security model, see [Security](./security).

### `targetOrigin`

**Type:** `string`

The exact origin used for all parent-to-iframe `postMessage` calls — `bridge:connected`, requests, and events. This must match the iframe's actual document origin for the browser to deliver messages.

```ts
createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  targetOrigin: 'https://partner.example',
});
```

**Default:** Derived from `src.origin`. If your `src` is `'https://partner.example/app'`, the default `targetOrigin` is `'https://partner.example'`.

**When to set explicitly:**
- The iframe redirects to a different origin after load, and you know the final origin ahead of time.
- You want to document the expected iframe origin in code, making it visible during security review.
- The default derivation pick ups the wrong origin and you need to force a specific value.

**Validation:** Must be an exact origin (`scheme://host:port` only — no path, query, hash, credentials, or wildcards). Invalid values throw `CONFIG_UNSAFE_ORIGIN` synchronously. If the origin is valid but doesn't match the actual iframe origin, the browser silently blocks `postMessage` delivery and bridge operations eventually time out.

---

### `allowedOrigin`

**Type:** `string`

The exact origin the parent accepts for iframe-to-parent messages. Every inbound `message` event is checked: `event.origin` must exactly match this value.

```ts
createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  allowedOrigin: 'https://partner.example',
});
```

**Default:** Derived from `src.origin`.

**When to set explicitly:**
- The iframe sends messages from a different origin than its `src` (e.g., after a redirect).
- You want security-sensitive integrations to be self-documenting in config.

**Validation:** Same rules as `targetOrigin`. Must be an exact origin — no wildcards, paths, queries, hashes, or credentials. If the origin is valid but the iframe sends messages from a different origin, those messages are silently ignored and the handshake never completes (resulting in `HANDSHAKE_TIMEOUT`).

:::danger

Both origin mismatches produce timeout errors, not origin-mismatch errors. The SDK cannot distinguish "the iframe never sent a message" from "the iframe sent messages from the wrong origin." During development, use [diagnostics](./debugging) to detect mismatches.

:::

---

### `allowInsecureLocalhost`

**Type:** `boolean`

Controls whether HTTP `localhost`-style origins are permitted for `src`, target origin, allowed origin, and parent origin values. It never allows non-localhost HTTP origins.

```ts
createIframeBridge({
  container: '#frame-root',
  src: 'http://127.0.0.1:5174/',
  allowInsecureLocalhost: true,
});
```

**Default:** `true` when the current parent origin is `localhost`; `false` otherwise. If `securityProfile` is `'strict'`, this option is forced to `false` regardless of the parent origin.

**When to use:**
- Local development with `http://localhost`, `http://127.0.0.1`, or `http://[::1]` iframe apps.
- Manual playgrounds that run multiple local dev servers.

:::warning

Never enable this in production. Use HTTPS and `securityProfile: 'strict'` for deployed hosts. The option is a development convenience, not a security bypass for production HTTP.

:::

---

### `sandbox`

**Type:** `string | readonly string[]`

Sets the iframe `sandbox` attribute. Pass a string when you already have a browser-ready sandbox value, or an array of tokens for easier composition.

```ts
// String form
sandbox: 'allow-scripts',

// Array form (joined with spaces)
sandbox: ['allow-scripts'],
```

**Default:** No sandbox attribute added. The iframe is not restricted by iframe sandboxing. Other protections — exact origins, CSP, server-side auth — still apply.

**Important sandbox behavior:**

- Without `allow-same-origin`, a sandboxed iframe sends `event.origin === 'null'`, which the SDK rejects because origins must be exact HTTP(S) values.
- `allow-scripts` plus `allow-same-origin` weakens sandbox isolation. In `'development'` mode, this combination emits a `CONFIG_UNSAFE_SANDBOX` diagnostics warning. In `'strict'` mode, it throws `CONFIG_UNSAFE_SANDBOX` synchronously.

:::tip

If you sandbox, test the exact token set in a real browser. Sandbox tokens can change the iframe origin and break exact-origin message validation.

:::

---

### `securityProfile`

**Type:** `'development' | 'strict'`

Controls how aggressively the SDK enforces security-relevant configuration checks.

```ts
createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  securityProfile: 'strict',
});
```

**Default:** `'development'`

| Behavior | `development` (default) | `strict` |
|---|---|---|
| Wildcard Permissions Policy (`allow: 'camera *'`) | Diagnostic warning | Throws `CONFIG_UNSAFE_PERMISSIONS_POLICY` |
| `sandbox` with `allow-scripts` + `allow-same-origin` | Diagnostic warning | Throws `CONFIG_UNSAFE_SANDBOX` |
| `allowInsecureLocalhost: true` | Allowed on localhost | Forced to `false`; setting it to `true` throws `CONFIG_UNSAFE_ORIGIN` |

**When to use `'strict'`:**
- Production deployments where configuration mistakes should fail fast.
- CI and integration tests that should catch security misconfiguration.
- Any deployment where you have reviewed and expect exact, production-grade settings.

**When to keep `'development'`:**
- Local development with HTTP localhost servers.
- Sandboxed integrations where you have intentionally reviewed and documented the `allow-scripts` + `allow-same-origin` combination.
- Experimentation and manual playgrounds.

---

### `replaceContainerContent`

**Type:** `boolean`

Controls how the iframe is mounted into its container.

```ts
createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  replaceContainerContent: true,
});
```

**Default:** `false`

- `false` — the SDK appends the iframe with `container.appendChild(iframe)`. Existing container children remain.
- `true` — the SDK replaces all children with `container.replaceChildren(iframe)`. Placeholders, spinners, or stale iframes are removed.

**When to use `true`:**
- The container is a dedicated mount point with placeholder content.
- You remount the bridge and want the old iframe removed automatically.

**When to keep `false`:**
- The container intentionally holds other host-managed content alongside the iframe.

---

## Bootstrap Options

Bootstrap options control what parameters are appended to the iframe URL and how long the parent waits for the handshake.

```ts
type IframeBridgeBootstrapConfig = {
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
```

### Defaults

| Option | Default |
|---|---|
| `bootstrap.session.paramName` | `__iframeBridgeSessionId` |
| `bootstrap.session.paramValue` | SDK-generated random id |
| `bootstrap.session.location` | `query` |
| `bootstrap.parentOrigin.enabled` | `true` |
| `bootstrap.parentOrigin.paramName` | `__iframeBridgeParentOrigin` |
| `bootstrap.parentOrigin.value` | `window.location.origin` |
| `bootstrap.parentOrigin.location` | `query` |
| `bootstrap.handshakeTimeoutMs` | `10000` (10 seconds) |

---

### `bootstrap.session`

Configures the session parameter appended to the iframe URL. The iframe app must echo this value back in every protocol envelope so the parent can route messages to the correct bridge.

**If omitted entirely,** the SDK generates a random session id and appends it as `__iframeBridgeSessionId` in the query string.

#### `bootstrap.session.paramName`

**Type:** `string`

The URL parameter name that carries the session id. Customize when:
- The iframe app already expects a specific parameter name.
- The default name collides with an existing parameter.

```ts
bootstrap: {
  session: { paramName: 'bridgeSession' },
}
```

:::warning

If the iframe reads a different parameter name, it won't echo the expected session id. The parent will ignore its messages until the handshake times out.

:::

#### `bootstrap.session.paramValue`

**Type:** `string`

A fixed session value. Use when:
- You need deterministic session ids for tests.
- You want to correlate parent and iframe logs using a shared correlation id.
- You're reusing a known id during an intentional remount.

```ts
bootstrap: {
  session: { paramValue: 'test-session-1' },
}
```

If omitted, the SDK generates a value with `crypto.randomUUID()` when available, falling back to a time/random value.

:::danger

The session id is **not** a secret, token, or authentication credential. It appears in the iframe URL and is visible to anyone who can inspect the iframe element. Treat it as correlation metadata only. See [Core Concepts → Sessions](./core-concepts#sessions) for details.

:::

#### `bootstrap.session.location`

**Type:** `'query' | 'hash'`

Controls whether the session parameter is in the URL query string or hash.

```ts
bootstrap: {
  session: { location: 'hash' },
}
```

- `'query'` — the iframe server or initial route sees the value during normal URL parsing.
- `'hash'` — the value stays client-side and is read by iframe JavaScript after load.

If omitted, defaults to `'query'`. If the iframe reads the wrong location, it misses the session id and the handshake times out.

---

### `bootstrap.parentOrigin`

Configures the parent-origin parameter appended to the iframe URL. The iframe reads this to know where to send `bridge:ready` and other protocol messages.

**If omitted entirely,** the SDK appends `__iframeBridgeParentOrigin` in the query string with `window.location.origin`.

#### `bootstrap.parentOrigin.enabled`

**Type:** `boolean`

Controls whether the parent origin parameter is appended at all.

```ts
bootstrap: {
  parentOrigin: { enabled: false },
}
```

Set to `false` when the iframe app already has a trusted parent-origin allowlist and you don't want the parent origin in the iframe URL. If the iframe relies on this parameter and it's disabled, the handshake will fail unless the iframe has another way to discover the parent origin.

#### `bootstrap.parentOrigin.paramName`

**Type:** `string`

The URL parameter name that carries the parent origin. Customize when the iframe app expects a different name or the default collides with existing parameters.

```ts
bootstrap: {
  parentOrigin: { paramName: 'parent' },
}
```

#### `bootstrap.parentOrigin.value`

**Type:** `string`

An explicit parent origin value. Use when `window.location.origin` is not the value the iframe should target — for example, a proxy or gateway deployment.

```ts
bootstrap: {
  parentOrigin: { value: 'https://host.example' },
}
```

Must be an exact safe origin. Follows the same validation rules as `targetOrigin` and `allowedOrigin`.

#### `bootstrap.parentOrigin.location`

**Type:** `'query' | 'hash'`

Controls whether the parent origin is in the query string or hash. Same behavior as `bootstrap.session.location`.

---

### `bootstrap.handshakeTimeoutMs`

**Type:** `number`

Maximum time (in milliseconds) the parent waits for the iframe to send a valid `bridge:ready` message. If no valid ready arrives before the timer expires, the bridge transitions to `handshake_failed`.

```ts
bootstrap: {
  handshakeTimeoutMs: 20000, // 20 seconds
}
```

**Default:** `10000` (10 seconds)

**When to increase:**
- The iframe app has a slow startup (heavy bundles, data fetching, delayed initialization).
- Network conditions are known to be slow in your deployment environment.

**When to decrease:**
- The host UI should fail fast and show its own retry or fallback experience.
- You're in an integration test environment that benefits from quick feedback.

**Validation:** Must be an integer ≥ 1. Invalid values throw `CONFIG_INVALID_TIMEOUT` synchronously.

**What happens on timeout:** `whenReady()` rejects with `HANDSHAKE_TIMEOUT`. Queued operations reject. All future communication fails until you call `bridge.remount()` or `bridge.destroy()`.

---

## Queue Options

The pre-ready queue holds `request()`, `sendEvent()`, and `waitForEvent()` calls made before the bridge enters the `ready` state. It is not a throughput, retry, or batching system.

```ts
type IframeBridgeQueueConfig = {
  enabled?: boolean;
  maxSize?: number;
};
```

### Defaults

| Option | Default |
|---|---|
| `queue.enabled` | `true` |
| `queue.maxSize` | `50` |

---

### `queue.enabled`

**Type:** `boolean`

Enables or disables pre-ready queueing.

```ts
queue: { enabled: false },
```

- `true` (default) — operations called before readiness are queued and flushed when the handshake completes.
- `false` — operations called before readiness reject immediately with `BRIDGE_NOT_READY`.

**When to disable:**
- You want strict lifecycle behavior and prefer callers to `await bridge.whenReady()` before communicating.
- Your integration code is order-dependent and queueing would mask timing bugs.

**When to keep enabled:**
- Host code calls bridge operations immediately after `createIframeBridge()` and expects them to work once the iframe is ready.
- You want simpler calling code without explicit readiness checks before every operation.

---

### `queue.maxSize`

**Type:** `number`

Maximum number of operations the queue will hold.

```ts
queue: { maxSize: 20 },
```

**Default:** `50`

**Validation:** Must be an integer ≥ 1. Invalid values throw `CONFIG_INVALID_QUEUE` synchronously.

**Behavior when full:** Additional queued operations reject with `QUEUE_LIMIT_EXCEEDED`. Lower the value if accidental bursts before readiness should fail quickly. Raise it only when an integration intentionally schedules many operations before the iframe is ready.

---

## Timeout Options

Timeout options control how long the SDK waits for responses from the iframe after posting a request.

```ts
type IframeBridgeTimeoutConfig = {
  operationTimeoutMs?: number;
};
```

### Defaults

| Option | Default |
|---|---|
| `timeouts.operationTimeoutMs` | `5000` (5 seconds) |

---

### `timeouts.operationTimeoutMs`

**Type:** `number`

The default timeout for operations that wait for remote work or future inbound messages.

```ts
timeouts: { operationTimeoutMs: 10000 }, // 10 seconds
```

**Default:** `5000` (5 seconds)

**What it affects:**
- `request()` — starts after the request is posted; waits for a matching `bridge:response`.
- `waitForEvent()` — starts after the waiter is active; waits for the next matching inbound event.

**What it does NOT affect:**
- `sendEvent()` — resolves when posted; does not wait for iframe processing.
- `on()` — continuous listeners have no timeout semantics.
- The handshake — that's controlled by `bootstrap.handshakeTimeoutMs`.

**Validation:** Must be an integer ≥ 1. Invalid values throw `CONFIG_INVALID_TIMEOUT` synchronously.

You can override this default per-operation with the `timeoutMs` option:

```ts
const result = await bridge.request('slow:task', payload, { timeoutMs: 30000 });
```

**What happens on timeout:**
- `request()` rejects with `REQUEST_TIMEOUT`.
- `waitForEvent()` rejects with `EVENT_WAIT_TIMEOUT`.

:::tip

Operation timeouts start when the operation leaves the pre-ready queue and begins execution. A request queued before readiness is not penalized by the handshake wait time.

:::

---

## Diagnostics Options

Diagnostics are opt-in observational hooks. They let you observe SDK lifecycle events, config warnings, ignored messages, and listener errors — without changing bridge behavior.

```ts
type IframeBridgeDiagnosticsConfig = {
  debug?: boolean;
  logger?: {
    debug?(event: DiagnosticEvent): void;
    warn?(event: DiagnosticEvent): void;
    error?(event: DiagnosticEvent): void;
  };
};
```

### `diagnostics.debug`

**Type:** `boolean`

Enables debug-level diagnostics when a logger is configured.

```ts
diagnostics: { debug: true },
```

**Default:** `false`

Warning and error diagnostics are delivered through configured `warn` and `error` hooks regardless of this setting. Debug diagnostics are only delivered when `debug: true`.

**When to enable:**
- Local development and manual playground debugging.
- Investigating handshake, message filtering, or lifecycle behavior.
- Capturing verbose bridge traces with `createDiagnosticRecorder`.

---

### `diagnostics.logger`

**Type:** `IframeBridgeLogger`

Logger hooks that receive sanitized `DiagnosticEvent` objects. Each hook receives events with the appropriate `level` populated.

```ts
const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  diagnostics: {
    debug: true,
    logger: {
      debug(event) { console.debug('[Bridge]', event); },
      warn(event)  { console.warn('[Bridge]', event); },
      error(event) { console.error('[Bridge]', event); },
    },
  },
});
```

**If omitted,** no diagnostics are emitted externally.

**Logger failure behavior:** If a hook throws, the SDK catches the failure and continues bridge operation. Diagnostics are observational — a broken logger never breaks the bridge.

#### `diagnostics.logger.debug`

Receives debug events only when `diagnostics.debug` is `true`. Includes lifecycle transitions, message routing details, and queue activity for development-time inspection.

#### `diagnostics.logger.warn`

Receives warning diagnostics when the SDK detects risky but allowed configuration — for example, `CONFIG_UNSAFE_SANDBOX` when `securityProfile` is `'development'`.

#### `diagnostics.logger.error`

Receives error diagnostics for observable runtime issues — for example, when a user event listener throws. Runtime errors represented by rejected promises or thrown `IframeBridgeError` values are still surfaced through the relevant API calls.

---

### Diagnostic Recorder

For local debugging and manual examples, `createDiagnosticRecorder` provides a convenience wrapper that collects diagnostic events into an array:

```ts
import { createDiagnosticRecorder, createIframeBridge } from '@furkankaynak/iframe-helper-sdk';

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

Each entry includes the sanitized `DiagnosticEvent` plus `level`, `sequence`, and `timestamp`. The recorder does not capture raw `postMessage` data or application payloads.

For deeper diagnostic workflows, see [Debugging & Diagnostics](./debugging).

---

## Quick Config Recipes

The examples above show individual options. For copy-pasteable configurations covering real scenarios — production partner integrations, same-origin embeds, local development, sandboxed bridges, sensitive URLs, and Permissions Policy reviews — see the full recipes in [Use Cases & Recipes](./use-cases).

---

## Full Type Reference

<details>
<summary><code>IframeBridgeConfig</code> — complete type</summary>

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

---

## Next Steps

- **[Type-Safe Bridge](./typed-bridge)** — Define a contract map once, get full TypeScript narrowing at compile time.
- **[Security](./security)** — Security model, profiles, CSP guidance, and production checklist.
- **[Use Cases & Recipes](./use-cases)** — Copy-pasteable configurations for real deployment scenarios.
- **[Debugging & Diagnostics](./debugging)** — Plug in diagnostic recorders and logger hooks.
- **[Wire Protocol](./wire-protocol)** — The envelope specification for iframe-side integrations.

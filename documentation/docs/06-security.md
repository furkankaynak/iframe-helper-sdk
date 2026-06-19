---
sidebar_position: 7
slug: security
toc_max_heading_level: 3
description: The security model behind the iframe bridge SDK — guarantees, non-guarantees, security profiles, CSP, sandbox, Permissions Policy, origin validation, and a production checklist.
---

# Security

The SDK applies defense in depth at every layer of the bridge — not a single check, but a chain of validations that must all pass before any application message is accepted. This page explains what the SDK protects, what it doesn't, and how to harden your integration.

For a working production configuration, see [Use Cases & Recipes](./use-cases). For the handshake validation rules the parent enforces, see [Wire Protocol](./wire-protocol#handshake-sequence).

---

## Current Guarantees

These protections are enforced automatically by the SDK. You don't need to opt in — they apply to every bridge instance.

| Guarantee                      | How it works                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Exact target origin**        | Parent-to-iframe `postMessage` calls always use an exact, validated origin. Wildcard origins (`'*'`) are rejected at config time with `CONFIG_UNSAFE_ORIGIN`.                                                |
| **Inbound message validation** | Every incoming message is checked against `event.origin`, `event.source`, session id, protocol name (`'iframe-bridge'`), protocol version (`1`), and envelope shape before being processed.                  |
| **HTTPS-by-default**           | `src` URLs must use HTTPS, except for explicit `localhost` development mode controlled by `allowInsecureLocalhost`.                                                                                          |
| **Unsafe scheme rejection**    | `javascript:`, `data:`, `blob:`, and `srcdoc` iframe URLs are rejected synchronously with `CONFIG_INVALID_SRC`. Embedded credentials in URLs are also rejected.                                              |
| **Bounded pre-ready queue**    | Operations called before handshake readiness are queued with a configurable limit (default: 50). Queue overflow throws `QUEUE_LIMIT_EXCEEDED`. The queue closes on handshake failure or destroy.             |
| **Complete cleanup**           | `destroy()` removes all SDK-owned listeners, timers, pending requests, event waits, and the owned iframe. Idempotent — safe to call multiple times.                                                          |
| **Sanitized diagnostics**      | Diagnostic events do not include raw `postMessage` data or application payloads by default. Browser `messageerror` events are surfaced as `MESSAGE_DESERIALIZATION_ERROR` without raw message content.       |
| **Strict security profile**    | `securityProfile: 'strict'` converts risky-but-allowed configurations into hard errors: rejects insecure localhost mode, wildcard Permissions Policy grants, and sandbox combinations that weaken isolation. |
| **Duplicate message handling** | Only the first `bridge:ready` is accepted. Duplicate responses for the same `requestId` are ignored. Duplicate ready messages do not re-flush the queue or re-send `bridge:connected`.                       |

---

## Non-Guarantees

The SDK is a transport and lifecycle layer — not a complete security solution. These concerns are outside its scope and remain your responsibility.

### The SDK does **not** provide

- **Authentication or authorization.** The session id is correlation metadata for message routing. It is not a token, not a secret, and not proof of identity.
- **Server-side validation.** Client-side origin and envelope checks cannot prove the iframe application is uncompromised. Backend validation is still required.
- **CSRF protection.** The bridge layer does not prevent cross-site request forgery. Use standard CSRF defenses in your application layer.
- **Runtime payload validation.** TypeScript contract types (`createTypedIframeBridge`) are compile-time only. They do not validate payloads at runtime and are not a security boundary.
- **Proof of remote processing.** `sendEvent()` resolves after posting — it does not confirm the iframe processed the message. Use `request()` when acknowledgement is required.
- **Same-origin isolation.** If the parent and iframe share an origin, the iframe can access the parent DOM, cookies, storage, and service worker scope. The SDK does not prevent same-origin access — that's a browser guarantee.

:::danger Same-origin is not isolation

If your parent page and the iframe share an origin (including same subdomain), the iframe can access `window.parent.document`, parent cookies, `localStorage`, and service workers. The SDK's origin validation still functions, but the iframe is inside your trust boundary. If the iframe app is operated by a different team or has a different security posture, use a **separate subdomain** (e.g., `embed.example.com` vs `app.example.com`) or sandbox the iframe.

:::

### What the SDK cannot detect

- An iframe that intentionally spoofs messages after a valid handshake.
- An iframe that loads a different document post-handshake (the exact `targetOrigin` prevents delivery to a different origin, and unexpected origins or sources are ignored).
- A compromised parent page that manipulates the bridge configuration.

---

## Security Profiles

The `securityProfile` option controls how aggressively the SDK enforces security-relevant configuration. Choose one based on your environment.

<table>
<thead>
<tr>
<th></th>
<th><code>'development'</code> (default)</th>
<th><code>'strict'</code></th>
</tr>
</thead>
<tbody>
<tr>
<td>Wildcard Permissions Policy<br/><code>allow: 'camera *'</code></td>
<td>Diagnostic warning</td>
<td>Throws <code>CONFIG_UNSAFE_PERMISSIONS_POLICY</code></td>
</tr>
<tr>
<td>Sandbox <code>allow-scripts</code> + <code>allow-same-origin</code></td>
<td>Diagnostic warning</td>
<td>Throws <code>CONFIG_UNSAFE_SANDBOX</code></td>
</tr>
<tr>
<td><code>allowInsecureLocalhost: true</code> with strict</td>
<td>Allowed</td>
<td>Forced to <code>false</code>; setting <code>true</code> throws <code>CONFIG_UNSAFE_ORIGIN</code></td>
</tr>
</tbody>
</table>

### When to use `'strict'`

- **Production deployments.** Configuration mistakes should fail fast, not silently warn.
- **CI and integration tests.** Catch security misconfiguration before it reaches staging.
- **Any deployment where you've reviewed and expect production-grade settings.**

### When to keep `'development'`

- **Local development** with HTTP localhost servers.
- **Sandboxed integrations** where the `allow-scripts` + `allow-same-origin` combination is intentionally reviewed and documented.
- **Experimentation and manual playgrounds.**

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

// Production: fail fast on unsafe configs
const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  securityProfile: 'strict',
});
```

:::tip

In `'development'` mode, warnings are only delivered when a [diagnostics logger](./configuration#diagnosticslogger) is configured. Use `createDiagnosticRecorder` to capture them during development.

:::

---

## CSP Guidance

Content Security Policy prevents unauthorized iframe embedding at the browser level. Use it alongside the SDK's origin validation — CSP and the bridge check different things, and both matter.

### Parent-side: restrict what you embed

Add a `frame-src` (or `child-src`) directive to your parent page's CSP header. This controls which origins the browser is allowed to load into iframes on your page.

**Production cross-domain:**

```http
Content-Security-Policy: frame-src https://partner.example
```

**Same-host:**

```http
Content-Security-Policy: frame-src 'self'
```

**Multiple trusted partners:**

```http
Content-Security-Policy: frame-src https://partner.example https://payments.example
```

:::warning

If you don't set `frame-src`, the browser falls back to `default-src` or allows all sources. This means an attacker who can inject HTML into your page can load an arbitrary iframe. Always restrict `frame-src` in production.

:::

### Iframe-side: restrict who can embed you

Your iframe application should also set a CSP header with `frame-ancestors`. This tells the browser which parent origins are allowed to embed your iframe.

**Only your production parent:**

```http
Content-Security-Policy: frame-ancestors https://host.example
```

**Multiple known embedders:**

```http
Content-Security-Policy: frame-ancestors https://host.example https://admin.example
```

**Same-host embed only:**

```http
Content-Security-Policy: frame-ancestors 'self'
```

:::tip CSP does not replace bridge validation

CSP controls which pages can load/embed the iframe. The SDK's origin, source, and session validation controls which messages are accepted over `postMessage`. Both layers are necessary — one doesn't replace the other. See [Origin Validation](#origin-validation) for what the SDK checks.

:::

---

## Sandbox Guidance

The `sandbox` option applies the iframe `sandbox` attribute, which restricts what the iframe can do. Use it to reduce the impact of a compromised iframe application.

### How sandbox tokens affect the bridge

| Token                                                       | Effect on bridge behavior                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow-scripts`                                             | Required. Without it, the iframe cannot run JavaScript and the handshake will never complete.                                                                                                                                                           |
| `allow-same-origin`                                         | Treats the iframe as same-origin. **Without it**, the iframe sends `event.origin === 'null'` and the SDK rejects its messages because origins must be exact HTTP(S) values. **With it**, the iframe regains access to its origin's cookies and storage. |
| `allow-forms`, `allow-top-navigation`, `allow-popups`, etc. | Do not affect bridge communication. Add only if the iframe genuinely needs them.                                                                                                                                                                        |

### The `allow-scripts` + `allow-same-origin` caveat

When both tokens are present, the sandbox is significantly weakened: the iframe can execute scripts **and** access same-origin resources (cookies, `localStorage`, `sessionStorage`). This is the browser-equivalent of running the iframe without a sandbox.

```ts
// Development: emits CONFIG_UNSAFE_SANDBOX warning
createIframeBridge({
  container: '#sandboxed-frame',
  src: 'https://partner.example/app',
  sandbox: ['allow-scripts', 'allow-same-origin'],
  securityProfile: 'development',
  diagnostics: {
    // Warning will appear here
  },
});

// Strict: throws CONFIG_UNSAFE_SANDBOX synchronously
createIframeBridge({
  sandbox: ['allow-scripts', 'allow-same-origin'],
  securityProfile: 'strict', // ❌ Error
});
```

:::warning Always test your sandbox token set

Sandbox behavior varies across browsers. Test your exact token combination in every browser you support. A token set that works in Chrome may break `event.origin` behavior in Firefox.

:::

### Recommended starting points

**Maximum isolation** (if the iframe only needs to display content, no scripts):

```ts
sandbox: ''; // No tokens — most restrictive
```

**Scripts only, no origin access** (the iframe runs scripts but can't access its own origin's cookies/storage):

```ts
sandbox: 'allow-scripts';
```

:::danger

Without `allow-same-origin`, the iframe's `event.origin` is `'null'`. The SDK rejects messages from `'null'` origins. This configuration requires the iframe to communicate through a different channel, or it means the iframe is intentionally non-interactive.

:::

---

## Permissions Policy

The `iframeAttributes.allow` attribute controls which browser features the iframe can use — camera, microphone, geolocation, clipboard, fullscreen, and more.

### Grant only what the iframe needs

Use the narrowest possible grant. Prefer origin-scoped values over wildcards.

```ts
// Good: scoped to the iframe's exact origin
createIframeBridge({
  src: 'https://partner.example/app',
  iframeAttributes: {
    allow: 'clipboard-write https://partner.example',
  },
});

// Bad: wildcard grant allows any iframe loaded at this URL
createIframeBridge({
  src: 'https://partner.example/app',
  iframeAttributes: {
    allow: 'clipboard-write *',
  },
});
```

### Wildcard detection

The SDK detects wildcard values (any token containing `*` or `'src'`) in the `allow` attribute:

- **`'development'` profile:** Emits a `CONFIG_UNSAFE_PERMISSIONS_POLICY` diagnostic warning. The bridge still functions.
- **`'strict'` profile:** Throws `CONFIG_UNSAFE_PERMISSIONS_POLICY` synchronously. The bridge is never created.

```ts
// Strict mode rejects wildcard grants
createIframeBridge({
  securityProfile: 'strict',
  iframeAttributes: {
    allow: 'camera *; microphone *', // ❌ CONFIG_UNSAFE_PERMISSIONS_POLICY
  },
});
```

:::tip

If no `allow` attribute is set, the browser applies its default Permissions Policy. The SDK does not add any feature grants on its own.

:::

---

## Origin Validation

The SDK enforces strict origin validation at every level — from config parsing to message routing. Understanding these rules helps you debug handshake failures and avoid common misconfigurations.

### What the SDK requires

Every origin value (`src`, `targetOrigin`, `allowedOrigin`, and the bootstrap parent origin) must:

- Be an **exact origin** — `https://partner.example:443`, not `https://partner.example/app`
- Use **HTTPS** — except localhost origins with `allowInsecureLocalhost: true`
- Be a **real HTTP(S) origin** — no `javascript:`, `data:`, `blob:`, `file:`, or opaque origins
- Not contain **wildcards** — no `*`, no `*.example.com`
- Not contain **paths, query strings, hashes, or credentials**

| Config value                        | Valid?                              | Reason                      |
| ----------------------------------- | ----------------------------------- | --------------------------- |
| `https://partner.example`           | Yes                                 | Exact HTTPS origin          |
| `http://127.0.0.1:5174`             | Yes (with `allowInsecureLocalhost`) | Explicit localhost dev mode |
| `https://partner.example/app`       | No                                  | Contains a path             |
| `https://*.example.com`             | No                                  | Contains a wildcard         |
| `*`                                 | No                                  | Wildcard origin             |
| `http://partner.example`            | No                                  | HTTP on non-localhost       |
| `https://user:pass@partner.example` | No                                  | Contains credentials        |

### `targetOrigin` vs `allowedOrigin`

These two options control opposite directions of message flow. They must be symmetric for the bridge to work.

| Option          | Direction       | What it controls                                                   |
| --------------- | --------------- | ------------------------------------------------------------------ |
| `targetOrigin`  | Parent → Iframe | Origin used in `postMessage()` calls from the parent to the iframe |
| `allowedOrigin` | Iframe → Parent | Origin the parent accepts for inbound messages from the iframe     |

If you leave both unset, the SDK derives them from `src.origin`. For most integrations, this is correct. Set them explicitly only when you know the iframe's messaging origin differs from its initial URL.

```ts
// Most common: derive from src
createIframeBridge({
  src: 'https://partner.example/app',
  // targetOrigin = 'https://partner.example' (derived)
  // allowedOrigin = 'https://partner.example' (derived)
});

// Explicit: when the iframe redirects to a different origin for messaging
createIframeBridge({
  src: 'https://partner.example/app',
  targetOrigin: 'https://messages.partner.example',
  allowedOrigin: 'https://messages.partner.example',
});
```

:::warning

If `targetOrigin` does not match the iframe's actual origin, the browser silently drops the `postMessage` call. The bridge won't receive an error — it will time out with `HANDSHAKE_TIMEOUT`. If `allowedOrigin` does not match, inbound messages from the iframe are silently ignored.

:::

### Localhost development

The SDK never allows non-localhost HTTP origins. During development, set `allowInsecureLocalhost: true` to permit HTTP on `localhost`, `127.0.0.1`, or `[::1]`.

```ts
createIframeBridge({
  src: 'http://127.0.0.1:5174',
  allowInsecureLocalhost: true, // Required for HTTP localhost
  securityProfile: 'development',
});
```

By default, `allowInsecureLocalhost` is `true` only when the parent page itself is on localhost. In all other cases, it defaults to `false`.

:::danger

Never set `allowInsecureLocalhost: true` in production. The option is a development convenience and never permits HTTP on production domains.

:::

---

## Same-Origin Is Not Isolation

If the parent page and the iframe share an origin — including the same subdomain — the browser treats them as part of the same security context. The SDK cannot override this.

### What same-origin means in practice

- The iframe can access `window.parent.document` and modify the parent DOM.
- The iframe shares cookies with the parent (including `HttpOnly` if served from the same application).
- The iframe shares `localStorage`, `sessionStorage`, and `indexedDB` with the parent origin.
- The iframe can register service workers that control the parent's scope.

The SDK's message validation still works — invalid envelopes, wrong session ids, and mismatched protocol versions are still rejected. But **the iframe doesn't need the bridge** to interact with your page. It can access the DOM directly.

### Recommendations

- **If the iframe is built by your own team and deployed together with the parent,** same-origin may be acceptable. Keep origin, source, session, protocol, and version validation enabled regardless.

- **If the iframe is built by a different team or has a different security posture,** host it on a separate subdomain (e.g., `embed.example.com` while the parent runs at `app.example.com`). This makes it cross-origin and prevents DOM/cookie/storage access.

- **If you must embed same-origin content from an external source,** apply the strongest available `sandbox` tokens and set `securityProfile: 'strict'`. However, no sandbox token can fully isolate same-origin content from the parent.

```ts
// Same-origin: the iframe can access the parent DOM
createIframeBridge({
  src: 'https://app.example/embed',
  // The iframe can read window.parent.document.cookie
});
```

---

## Security Checklist

Use this checklist before deploying a bridge integration to production. Each item covers a specific concern and references the relevant configuration option or CSP directive.

### Origins

- [ ] `src` uses HTTPS (not HTTP). → `CONFIG_UNSAFE_ORIGIN` otherwise.
- [ ] `targetOrigin` is an exact origin, not a wildcard or path. → Derived from `src.origin` by default.
- [ ] `allowedOrigin` is an exact origin, not a wildcard or path. → Derived from `src.origin` by default.
- [ ] `allowInsecureLocalhost` is `false` (or not set) in production. → Defaults to `false` on non-localhost parents.
- [ ] No wildcards, credentials, or paths in any configured origin. → [Origin Validation](#origin-validation)

### CSP

- [ ] Parent page sets `frame-src` to restrict which origins can be loaded into iframes.
- [ ] Iframe application sets `frame-ancestors` to restrict which origins can embed it.
- [ ] CSP directives use exact origins, not wildcards. → [CSP Guidance](#csp-guidance)

### Security Profile

- [ ] `securityProfile` is set to `'strict'` for production. → Catches wildcard permissions, unsafe sandbox, and HTTP localhost.
- [ ] No `CONFIG_UNSAFE_SANDBOX` or `CONFIG_UNSAFE_PERMISSIONS_POLICY` errors at startup.

### Sandbox

- [ ] If you use `sandbox`, you've tested the exact token set in all target browsers.
- [ ] You understand that `allow-scripts` + `allow-same-origin` weakens sandbox isolation.
- [ ] Without `allow-same-origin`, the iframe sends `event.origin === 'null'` and the bridge rejects it.

### Permissions Policy

- [ ] `iframeAttributes.allow` grants only the features the iframe actually needs.
- [ ] No wildcard grants (`*` or `'src'`) in the `allow` value — scoped to exact origins instead.

### Referrer Policy

- [ ] `referrerPolicy` is set to `'no-referrer'` for sensitive parent URLs (tenant ids, tokens, invitation links). → `iframeAttributes.referrerPolicy`
- [ ] Or `'same-origin'` when parent and iframe share an origin and referrer data is safe to send.

### Bootstrap

- [ ] No secrets or tokens in `bootstrap.session.paramValue`. The session id appears in the iframe URL and is visible to anyone inspecting the DOM.
- [ ] Bootstrap parameters in the hash (`location: 'hash'`) if parent URL query strings contain sensitive data.
- [ ] The iframe app validates the parent origin against its own allowlist — not blindly trusting the bootstrap parameter.

### Diagnostics

- [ ] A diagnostics logger is configured to catch warnings (`CONFIG_UNSAFE_SANDBOX`, `CONFIG_UNSAFE_PERMISSIONS_POLICY`) during development.
- [ ] Diagnostic data is routed to your application monitoring in production.
- [ ] You understand that diagnostics do not include raw message payloads.

---

## Next Steps

- **[Use Cases & Recipes](./use-cases)** — Copy-pasteable security configurations for production, local dev, sandboxed, and sensitive deployments.
- **[Configuration](./configuration)** — Detailed reference for every security-related option (`securityProfile`, `sandbox`, `targetOrigin`, `allowedOrigin`, `allowInsecureLocalhost`, `iframeAttributes`).
- **[Wire Protocol](./wire-protocol)** — What the parent validates on every inbound message (origin, source, session, protocol, version, envelope).
- **[Troubleshooting](./troubleshooting)** — Diagnose handshake failures, origin mismatches, and CSP-related issues.

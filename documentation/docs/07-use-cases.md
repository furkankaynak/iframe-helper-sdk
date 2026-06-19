---
sidebar_position: 8
slug: use-cases
toc_max_heading_level: 3
description: Copy-pasteable configuration recipes for common iframe bridge deployments — production partners, same-origin, local dev, sandboxed, sensitive URLs, permissions, diagnostics, and multiple bridges.
---

# Use Cases & Recipes

The recipes on this page are **copy-pasteable starting points** for common iframe bridge deployments. They are not a replacement for server-side authentication, authorization, CSRF protection, CSP, or a child-side parent-origin allowlist. Each recipe includes the exact configuration, the CSP headers you should add, and notes on what to watch for.

For the full reference on every configuration option, see [Configuration](./configuration). For the security reasoning behind these choices, see [Security](./security).

---

## Production Cross-Domain Partner

Use this when the parent and iframe app are on different HTTPS origins and the iframe app is trusted to implement the raw bridge protocol.

```ts
import { createDiagnosticRecorder, createIframeBridge } from 'iframe-helper-sdk';

const diagnostics = createDiagnosticRecorder({ maxEntries: 100 });

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  targetOrigin: 'https://partner.example',
  allowedOrigin: 'https://partner.example',
  securityProfile: 'strict',
  iframeAttributes: {
    title: 'Partner application',
    referrerPolicy: 'no-referrer',
  },
  diagnostics: {
    logger: diagnostics.logger,
  },
});

await bridge.whenReady();
```

**Parent page CSP header:**

```http
Content-Security-Policy: frame-src https://partner.example; child-src https://partner.example
```

**Iframe app CSP header:**

```http
Content-Security-Policy: frame-ancestors https://host.example
```

:::tip Keep origins exact

Keep `targetOrigin` and `allowedOrigin` exact — no wildcards, no substring matching. Both must be the full origin value: `https://partner.example`. The SDK rejects wildcard origins at config time with `CONFIG_UNSAFE_ORIGIN`.

:::

Key points:

- Use `securityProfile: 'strict'` in production to catch unsafe config at startup.
- Prefer a child-side allowlist for accepted parent origins. The bootstrap parent origin parameter is discovery metadata, not proof of trust.
- The diagnostic recorder helps during integration. Remove it or point to your monitoring system in production.

---

## Same-Host / Same-Origin Embed

Use this only when the parent and iframe app share an origin and are inside the same trust boundary. A same-origin iframe can access the parent DOM, share cookies, and share service worker scope.

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#account-frame',
  src: 'https://app.example/account/embed',
  targetOrigin: 'https://app.example',
  allowedOrigin: 'https://app.example',
  securityProfile: 'strict',
  iframeAttributes: {
    title: 'Account embed',
    referrerPolicy: 'same-origin',
  },
});
```

**Parent page CSP header:**

```http
Content-Security-Policy: frame-src 'self'
```

**Iframe app CSP header:**

```http
Content-Security-Policy: frame-ancestors 'self'
```

:::danger Same-origin is not a sandbox

If either document has an XSS vulnerability, both should be treated as compromised. The iframe does not need the bridge protocol to access your page — it can read `window.parent.document` directly. See [Security → Same-Origin Is Not Isolation](./security#same-origin-is-not-isolation).

:::

Key points:

- Keep origin, source, session, protocol, and version validation enabled — even for same-origin.
- Use a separate subdomain (e.g., `embed.example.com` vs `app.example.com`) when the iframe is operated by a different team or has a different security posture.
- Use `referrerPolicy: 'same-origin'` when referrer data is safe to send within your boundary.

---

## Local Cross-Origin Development

Use this for local parent and iframe dev servers running on different localhost ports.

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#frame-root',
  src: 'http://127.0.0.1:5174/',
  targetOrigin: 'http://127.0.0.1:5174',
  allowedOrigin: 'http://127.0.0.1:5174',
  allowInsecureLocalhost: true,
  securityProfile: 'development',
  iframeAttributes: {
    title: 'Local iframe app',
  },
});
```

:::warning Do not copy to production

`allowInsecureLocalhost` never permits non-localhost HTTP origins. This recipe works only on `localhost`, `127.0.0.1`, or `[::1]`. Use HTTPS and `securityProfile: 'strict'` for deployed hosts.

:::

Key points:

- `allowInsecureLocalhost: true` is required for `http://` localhost origins.
- The `securityProfile` defaults to `'development'` when not set. This recipe is explicit about it for clarity.
- This works across ports — `127.0.0.1:5173` (parent) and `127.0.0.1:5174` (iframe) are different origins.

---

## Sandboxed Bridge Integration

Use sandboxing only after testing the exact token set in a real browser. Sandbox tokens can change the iframe's origin and break exact-origin message validation.

```ts
import { createDiagnosticRecorder, createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#reviewed-sandbox-frame',
  src: 'https://partner.example/app',
  targetOrigin: 'https://partner.example',
  allowedOrigin: 'https://partner.example',
  securityProfile: 'development',
  sandbox: ['allow-scripts', 'allow-same-origin'],
  iframeAttributes: {
    title: 'Reviewed sandboxed partner app',
    referrerPolicy: 'no-referrer',
  },
  diagnostics: {
    logger: createDiagnosticRecorder({ maxEntries: 100 }).logger,
  },
});
```

:::danger The `allow-scripts` + `allow-same-origin` caveat

| Situation                                      | What happens                                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Without `allow-same-origin`**                | The iframe sends `event.origin === 'null'`. The SDK rejects it — `allowedOrigin` must be an exact HTTP(S) origin, not `'null'`.                                                   |
| **With `allow-scripts` + `allow-same-origin`** | The sandbox isolation is weakened. In `'development'` mode, the SDK emits a `CONFIG_UNSAFE_SANDBOX` warning. In `'strict'` mode, it throws `CONFIG_UNSAFE_SANDBOX` synchronously. |

:::

Key points:

- `securityProfile: 'strict'` **rejects** this sandbox combination. Keep `'development'` only when the warning is reviewed and documented.
- Test the exact sandbox token set in every browser you support. Behaviour varies.
- The diagnostic recorder captures the `CONFIG_UNSAFE_SANDBOX` warning — check `recorder.entries` during development.

---

## Sensitive Parent URLs

Use this when parent routes or query strings may contain tenant ids, invitation state, or other values that should not be sent in the `Referer` header to the iframe.

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#sensitive-frame',
  src: 'https://partner.example/app',
  targetOrigin: 'https://partner.example',
  allowedOrigin: 'https://partner.example',
  securityProfile: 'strict',
  bootstrap: {
    session: { location: 'hash' },
    parentOrigin: { location: 'hash' },
  },
  iframeAttributes: {
    title: 'Sensitive partner flow',
    referrerPolicy: 'no-referrer',
  },
});
```

Key points:

- `referrerPolicy: 'no-referrer'` removes the navigation `Referer` header entirely.
- Hash bootstrap values (`location: 'hash'`) stay client-side during the navigation request. The iframe app must read them from `location.hash` instead of the query string.
- Do not place secrets in the session value. It is correlation metadata only — it appears in the iframe URL and is visible to anyone inspecting the DOM.

---

## Permissions Policy Review

Use the `iframeAttributes.allow` attribute only for browser capabilities the iframe actually needs. Grant the narrowest possible permissions, scoped to exact origins where possible.

**Good — origin-scoped, minimal grant:**

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#clipboard-frame',
  src: 'https://partner.example/app',
  targetOrigin: 'https://partner.example',
  allowedOrigin: 'https://partner.example',
  securityProfile: 'strict',
  iframeAttributes: {
    title: 'Clipboard integration',
    allow: 'clipboard-write https://partner.example',
  },
});
```

**Bad — wildcard grant:**

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#unsafe-frame',
  src: 'https://partner.example/app',
  iframeAttributes: {
    allow: 'camera *',
  },
  securityProfile: 'strict', // ❌ Throws CONFIG_UNSAFE_PERMISSIONS_POLICY
});
```

:::warning Strict mode rejects wildcards

In `securityProfile: 'strict'`, any wildcard grant (`*` or `'src'`) in the `allow` attribute throws `CONFIG_UNSAFE_PERMISSIONS_POLICY` synchronously. In `'development'` mode (the default), wildcards emit a diagnostics warning but allow the bridge to proceed.

:::

Key points:

- If no `allow` attribute is set, the browser applies its default Permissions Policy. The SDK does not add feature grants on its own.
- Grant only features the iframe genuinely needs. Each additional grant increases the surface area.

---

## Diagnostics Setup

Use `createDiagnosticRecorder` during development and integration testing to capture lifecycle events, config warnings, and message filtering details. Use a custom logger to route diagnostics to your application monitoring in production.

**Development — recorder + debug:**

```ts
import { createDiagnosticRecorder, createIframeBridge } from 'iframe-helper-sdk';

const recorder = createDiagnosticRecorder({ maxEntries: 100 });

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  securityProfile: 'strict',
  diagnostics: {
    debug: true,
    logger: recorder.logger,
  },
});

await bridge.whenReady();

// Inspect all captured events
console.table(recorder.entries);
```

**Production — custom logger with error monitoring:**

```ts
import { createIframeBridge } from 'iframe-helper-sdk';

const bridge = createIframeBridge({
  container: '#partner-frame',
  src: 'https://partner.example/app',
  securityProfile: 'strict',
  diagnostics: {
    logger: {
      warn(event) {
        console.warn('[iframe-bridge]', event);
      },
      error(event) {
        console.error('[iframe-bridge]', event);
        // Route to your error monitoring: Sentry, DataDog, etc.
      },
    },
  },
});
```

:::tip Debug is opt-in

Debug events — lifecycle transitions, queue activity, message routing — are only emitted when `diagnostics.debug: true`. Warning and error diagnostics are always delivered to configured hooks regardless of the debug flag.

:::

Key points:

- Each recorder entry includes `level`, `sequence`, `timestamp`, and the sanitized `DiagnosticEvent`. Raw `postMessage` data and application payloads are never included.
- If a logger hook throws, the SDK catches the failure and continues bridge operation — diagnostics are observational, not critical.
- For deeper diagnostic workflows, see [Debugging & Diagnostics](./debugging).

---

## Multiple Bridge Instances

Embedding several iframes on the same page requires a separate bridge instance per iframe. Each bridge gets its own session id, message listener, and lifecycle — they are fully isolated.

```ts
import { createDiagnosticRecorder, createIframeBridge } from 'iframe-helper-sdk';

const diagnostics = createDiagnosticRecorder({ maxEntries: 200 });

// Partner A
const partnerA = createIframeBridge({
  container: '#partner-a-frame',
  src: 'https://partner-a.example/app',
  targetOrigin: 'https://partner-a.example',
  allowedOrigin: 'https://partner-a.example',
  securityProfile: 'strict',
  iframeAttributes: {
    title: 'Partner A',
    referrerPolicy: 'no-referrer',
  },
  diagnostics: {
    logger: diagnostics.logger,
  },
});

// Partner B
const partnerB = createIframeBridge({
  container: '#partner-b-frame',
  src: 'https://partner-b.example/app',
  targetOrigin: 'https://partner-b.example',
  allowedOrigin: 'https://partner-b.example',
  securityProfile: 'strict',
  iframeAttributes: {
    title: 'Partner B',
    referrerPolicy: 'no-referrer',
  },
});

await Promise.all([partnerA.whenReady(), partnerB.whenReady()]);

// Each bridge is independent
const userA = await partnerA.request('user:get', { id: '123' });
partnerB.sendEvent('analytics:track', { action: 'page_view' });
```

:::tip Cleanup on unmount

When integrating with frameworks like React or Vue, call `bridge.destroy()` in your component's cleanup hook. Each bridge owns its iframe element and message listeners — destroying the bridge removes all of them.

```ts
// React example
useEffect(() => {
  const bridge = createIframeBridge({
    /* ... */
  });
  bridge.whenReady();
  return () => bridge.destroy();
}, []);
```

:::

Key points:

- Each bridge generates its own session id (unless you set a fixed `bootstrap.session.paramValue`). Messages are routed to the correct bridge by matching the session id in the envelope.
- Each bridge needs a distinct container element — selectors must point to different DOM nodes.
- Use a single shared `DiagnosticRecorder` to capture events from all bridges in one place, or use separate recorders per bridge for finer-grained inspection.
- Bridges do not share state, listeners, or configuration. Destroying one does not affect the others.

---

## Next Steps

- **[Configuration](./configuration)** — Full reference for every option used in these recipes.
- **[Security](./security)** — Security model, profiles, CSP, sandbox, and the production checklist.
- **[Core Concepts](./core-concepts)** — Mental model, lifecycle states, and the handshake sequence.
- **[Troubleshooting](./troubleshooting)** — Diagnose handshake failures, origin mismatches, and CSP issues.
- **[FAQ](./faq)** — Common questions and answers.

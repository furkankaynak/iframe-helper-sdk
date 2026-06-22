---
slug: /child/security
sidebar_label: Security
toc_max_heading_level: 3
description: Child iframe SDK security model, allowedParentOrigins semantics, exact target origin behavior, CSP frame-ancestors guidance, and session id boundaries.
---

# Child Security

The child SDK protects the iframe app from processing messages sent by unexpected parent windows. It complements browser and server controls, but it does not replace authentication, authorization, backend validation, CSP, or application-level payload checks.

For the parent-side security model, see [Security](/security). For the raw message contract, see [Wire Protocol](/wire-protocol).

---

## Parent Origin Allowlist

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';

createIframeChildBridge({
  allowedParentOrigins: ['https://host.example'],
});
```

The child config shape is:

```ts
type IframeChildBridgeConfig = {
  allowedParentOrigins?: readonly string[] | null;
};
```

`allowedParentOrigins?: readonly string[] | null` has exact semantics:

| Value           | Behavior                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Omitted         | Accepts the bootstrap parent origin. Relies on server-side/browser embedding controls such as CSP `frame-ancestors`. |
| `null`          | Same as omitted: accepts the bootstrap parent origin.                                                                |
| Non-empty array | Requires the bootstrap parent origin to exactly match one of the configured origins.                                 |
| Empty array     | Invalid configuration. Use `null`/omit for bootstrap-only behavior, or provide at least one exact origin.            |

Origin values must be exact origins such as `https://host.example`. Do not use paths, query strings, hashes, substring checks, or wildcard patterns.

---

## Bootstrap Origin Is Not Proof Of Trust

The parent origin comes from the bridge bootstrap parameters added to the iframe URL. With an omitted or `null` allowlist, the child accepts that bootstrap origin so it can complete the protocol handshake.

That is convenient for controlled deployments, but it is not a browser-level embedding policy. If you omit `allowedParentOrigins`, protect the iframe app with server-side/browser controls such as CSP `frame-ancestors`.

```http
Content-Security-Policy: frame-ancestors https://host.example
```

Use both layers for production:

- `frame-ancestors` controls which pages can embed the iframe app.
- `allowedParentOrigins` controls which parent origins the child SDK will accept for bridge messages.
- The wire protocol session id correlates messages to a bridge instance; it is not authentication.

---

## Exact Target Origin

The child SDK does not use wildcard target origins in normal operation. After accepting the parent origin, child-to-parent messages use that exact origin for `postMessage()`.

This applies to:

- `bridge:ready`
- `bridge:event` sent by `sendEvent()`
- `bridge:response` sent by `handleRequest()` handlers
- Plugin messages, including child resize events

---

## Session Id Boundary

The session id is correlation metadata, not auth, a token, or a secret. It exists so both sides can route messages to the correct bridge instance and ignore unrelated iframe traffic.

Do not use the session id for authorization decisions. Use real application authentication and server-side authorization for protected data or actions.

---

## Message Validation

The child SDK validates incoming parent messages before dispatching them to handlers:

- `event.origin` must match the accepted parent origin.
- The protocol name must be `'iframe-bridge'`.
- The protocol version must be `1`.
- The `sessionId` must match the bootstrap session id.
- The envelope type and required fields must be valid.

Invalid messages are ignored or surfaced through diagnostics when configured. Application payloads are still your responsibility to validate before using them for security-sensitive work.

---

## Production Checklist

- Configure `allowedParentOrigins` with exact production parent origins when they are known.
- If `allowedParentOrigins` is omitted or `null`, enforce iframe-side CSP `frame-ancestors` on the iframe app response.
- Keep child-to-parent messages on exact target origins; never fall back to `'*'` for normal operation.
- Treat `sessionId` as routing metadata only.
- Validate sensitive payloads in the application layer or backend.
- Keep the parent-side `frame-src` CSP aligned with the iframe origins it embeds.

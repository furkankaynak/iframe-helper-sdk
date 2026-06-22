---
slug: /child/plugins
sidebar_label: Plugins
toc_max_heading_level: 3
description: Child iframe SDK plugin model, tree-shakable optional imports, lifecycle boundaries, and the child resize plugin subpath.
---

# Child Plugins

Child plugins are optional iframe-app runtime extensions. They are registered when creating the child bridge and are kept out of the default `iframe-helper-sdk/child` import so optional features stay tree-shakable.

---

## Register Plugins

```ts
import { createIframeChildBridge } from 'iframe-helper-sdk/child';
import { childResizePlugin } from 'iframe-helper-sdk/child/resize';

const bridge = createIframeChildBridge(
  { allowedParentOrigins: ['https://host.example'] },
  { plugins: [childResizePlugin({ axis: 'both' })] },
);
```

Plugins run in the iframe app and share the child bridge's accepted parent origin, session id, and lifecycle. They do not change the canonical [Wire Protocol](/wire-protocol); they use normal bridge messages under reserved names where needed.

---

## Import Boundaries

Import the child bridge and child plugins from their documented public subpaths:

| Feature             | Import path                      |
| ------------------- | -------------------------------- |
| Child bridge        | `iframe-helper-sdk/child`        |
| Child resize plugin | `iframe-helper-sdk/child/resize` |

Child resize must be imported from `iframe-helper-sdk/child/resize`, not `iframe-helper-sdk/child`.

---

## Security Boundary

Plugins are trusted code in your iframe application. The child SDK validates parent messages before plugin hooks run, but plugin behavior is still part of your app's runtime.

Keep plugin configuration explicit and minimal:

- Import only the plugin subpaths you need.
- Do not use wildcard target origins in plugin code.
- Treat the session id as correlation metadata only.
- Validate any plugin-controlled application payloads before using them for sensitive actions.

---

## Plugin Context And Hooks

Child plugins are setup hooks. A plugin receives the accepted bridge context and can return lifecycle hooks:

```ts
type IframeChildBridgePlugin = (ctx: {
  readonly bridge: IframeChildBridge;
  readonly parentOrigin: string;
  readonly sessionId: string;
  readonly warn: (event: DiagnosticEvent) => void;
}) => {
  onConnected?(): void;
  onEvent?(envelope: BridgeEventEnvelope, bridge: IframeChildBridge): void;
  destroy?(): void;
} | void;
```

| Hook            | When it runs                                                          |
| --------------- | --------------------------------------------------------------------- |
| setup function  | During child bridge creation, after config normalization.             |
| `onConnected()` | Once, after a valid `bridge:connected` completes the child handshake. |
| `onEvent()`     | For validated parent `bridge:event` messages after connection.        |
| `destroy()`     | When `bridge.destroy()` tears down the child bridge.                  |

Plugin exceptions are caught and reported through diagnostics so optional behavior does not crash the core child bridge lifecycle.

---

## Available Child Plugins

- [Child Resize](/child/resize) sends iframe content dimensions to a parent bridge that registered the parent-side `resizePlugin()`.

Future child plugins should follow the same boundary: optional subpath import, no package-root side effects, exact-origin messaging, and cleanup through `destroy()`.

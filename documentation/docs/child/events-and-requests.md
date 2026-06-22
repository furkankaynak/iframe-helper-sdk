---
slug: /child/events-and-requests
sidebar_label: Events And Requests
toc_max_heading_level: 3
description: Child iframe SDK event and request handling APIs, including sendEvent, on, handleRequest, whenConnected, destroy, and the MVP no child-to-parent RPC boundary.
---

# Events And Requests

The child SDK exposes the iframe-app side of the bridge: child-to-parent events, parent-to-child events, and handlers for parent-initiated requests.

It does not expose child-to-parent RPC. There is no child `request()` method in the MVP.

---

## Lifecycle Gate

```ts
await bridge.whenConnected();
```

`whenConnected()` resolves when the child has completed the handshake and received `bridge:connected` from the parent. Use it before sending application events if your app needs to know the parent accepted the bridge.

```ts
const bridge = createIframeChildBridge({
  allowedParentOrigins: ['https://host.example'],
});

await bridge.whenConnected();
await bridge.sendEvent('app:ready', { version: '1.0.0' });
```

---

## Send Events To The Parent

```ts
await bridge.sendEvent('cart:changed', { itemCount: 3 });
```

`sendEvent()` sends a `bridge:event` envelope to the accepted parent origin. It resolves after the message is posted; it does not mean the parent processed the event.

Use events for notifications, state changes, analytics, and child-to-parent signals that do not require a protocol-level response.

---

## Receive Events From The Parent

```ts
const unsubscribe = bridge.on('theme:changed', (payload) => {
  document.documentElement.dataset.theme = String(payload);
});

// Later:
unsubscribe();
```

`on()` registers a continuous listener for parent `bridge:event` messages with the matching `name`. The returned function removes that listener.

The child SDK validates origin, session id, protocol, version, and envelope shape before dispatching the event.

---

## Handle Parent Requests

```ts
const unregister = bridge.handleRequest('user:get', async (payload) => {
  return { name: 'Ada' };
});

// Later:
unregister();
```

`handleRequest()` registers a handler for parent-initiated `bridge:request` messages. When the parent calls `bridge.request('user:get', payload)`, the child handler returns a payload or throws/rejects, and the child SDK sends the matching `bridge:response`.

Child request handlers respond to parent `bridge:request`; the child does not initiate `bridge:request`.

---

## No Child `request()`

The MVP child bridge has no `request()` method. This keeps the public contract aligned with the current wire protocol behavior: parent-to-child requests are supported, but child-to-parent requests are not.

If the child needs to ask the parent to do something, send an event and let the parent decide how to respond through a later event or parent-initiated request.

```ts
await bridge.sendEvent('checkout:requested', { cartId: 'cart_123' });
```

---

## Cleanup

```ts
bridge.destroy();
```

`destroy()` removes the child bridge's message listeners, request handlers, event listeners, and plugin resources. Treat a destroyed bridge as terminal; create a new child bridge instance if the iframe app needs to reconnect.

---

## Protocol Mapping

| Child SDK API     | Wire message                            | Direction                             |
| ----------------- | --------------------------------------- | ------------------------------------- |
| `whenConnected()` | `bridge:ready` then `bridge:connected`  | Child -> Parent, then Parent -> Child |
| `sendEvent()`     | `bridge:event`                          | Child -> Parent                       |
| `on()`            | `bridge:event`                          | Parent -> Child                       |
| `handleRequest()` | `bridge:request` then `bridge:response` | Parent -> Child, then Child -> Parent |

For envelope fields and validation rules, see [Wire Protocol](/wire-protocol).

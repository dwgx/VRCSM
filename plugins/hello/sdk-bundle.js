// VRCSM plugin SDK — tiny UMD bundle every plugin imports.
//
// The iframe loaded by PluginHost can only reach the host through
// postMessage. This file shims ipc() into a promise that the host
// resolves via window.postMessage with a matching id.
//
// Public API:
//   window.vrcsm.call(method, params)  → Promise<result>
//   window.vrcsm.on(event, handler)    → unsubscribe (reserved for v0.9.0)
//
// Under the hood we send `{__vrcsm: "ipc", id, method, params}` to
// window.parent and wait for an `{__vrcsm: "ipc-response", id, result|error}`
// from the same origin the iframe was loaded from. Only the main SPA
// can reach here because DENY_CORS prevents every other origin from
// posting into the iframe.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.vrcsm = factory();
  }
}(typeof window !== "undefined" ? window : this, function () {
  var pending = new Map();
  var nextId = 0;

  function onMessage(ev) {
    var data = ev.data;
    if (!data || data.__vrcsm !== "ipc-response") return;
    var slot = pending.get(data.id);
    if (!slot) return;
    pending.delete(data.id);
    if (data.error) {
      var err = new Error(data.error.message || data.error.code || "ipc_error");
      err.code = data.error.code || "ipc_error";
      slot.reject(err);
    } else {
      slot.resolve(data.result);
    }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("message", onMessage);
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = "p" + (nextId++);
      pending.set(id, { resolve: resolve, reject: reject });
      var payload = { __vrcsm: "ipc", id: id, method: method, params: params };
      try {
        window.parent.postMessage(payload, "*");
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  }

  function on(_event, _handler) {
    // Reserved for v0.9.0 — plugins subscribe to host events like
    // "process.vrcStatusChanged" through this stream. Returns a
    // no-op unsubscribe for forward compat.
    return function () {};
  }

  return { call: call, on: on };
}));

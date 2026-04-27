// VRCSM plugin SDK — tiny UMD bundle every plugin imports.
//
// Plugin iframes talk to the native host directly through
// chrome.webview.postMessage. WebViewHost identifies the originating
// plugin frame from its virtual-host origin, then IpcBridge forwards
// the request through plugin.rpc so permissions are checked against the
// real plugin id.
//
// Public API:
//   window.vrcsm.call(method, params)  -> Promise<result>
//   window.vrcsm.on(event, handler)    -> unsubscribe

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.vrcsm = factory();
  }
}(typeof window !== "undefined" ? window : this, function () {
  var pending = new Map();
  var listeners = new Map();
  var nextId = 0;

  function getWebview() {
    return (
      typeof window !== "undefined" &&
      window.chrome &&
      window.chrome.webview
    ) || null;
  }

  function handleMessage(ev) {
    var data = ev.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_e) {
        return;
      }
    }
    if (!data || typeof data !== "object") return;

    if (typeof data.id === "string") {
      var slot = pending.get(data.id);
      if (!slot) return;
      pending.delete(data.id);
      clearTimeout(slot.timer);
      if (data.error) {
        var err = new Error(data.error.message || data.error.code || "ipc_error");
        err.code = data.error.code || "ipc_error";
        slot.reject(err);
      } else {
        slot.resolve(data.result);
      }
      return;
    }

    if (typeof data.event === "string") {
      var set = listeners.get(data.event);
      if (!set) return;
      set.forEach(function (handler) {
        try {
          handler(data.data);
        } catch (_e) {
          // Plugin event handlers are isolated from the SDK pump.
        }
      });
    }
  }

  var webview = getWebview();
  if (webview && typeof webview.addEventListener === "function") {
    webview.addEventListener("message", handleMessage);
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var wv = getWebview();
      if (!wv || typeof wv.postMessage !== "function") {
        reject(new Error("chrome.webview unavailable — plugin IPC must run inside VRCSM"));
        return;
      }

      var id = "p" + (nextId++);
      var timer = setTimeout(function () {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("ipc timeout: " + method));
      }, 60000);

      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        wv.postMessage(JSON.stringify({
          id: id,
          method: "plugin.rpc",
          params: { method: method, params: params || {} },
        }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  }

  function on(event, handler) {
    var set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler);
    return function () {
      set.delete(handler);
      if (set.size === 0) listeners.delete(event);
    };
  }

  return { call: call, on: on };
}));

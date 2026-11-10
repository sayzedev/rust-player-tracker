(() => {
  const REQUEST_SOURCE = "rust-player-tracker-page";
  const RESPONSE_SOURCE = "rust-player-tracker-extension";

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== REQUEST_SOURCE || data.type !== "GET_RUSTPLUS_AUTH") return;
    const requestId = String(data.requestId || "");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) return;

    chrome.runtime.sendMessage({ type: "RUSTPLUS_GET_PENDING" }, response => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        source: RESPONSE_SOURCE,
        type: "RUSTPLUS_AUTH_RESULT",
        requestId,
        response: runtimeError
          ? { ok: false, error: "extension_unavailable", message: "Расширение не отвечает. Перезагрузи страницу сайта." }
          : response
      }, location.origin);
    });
  });
})();

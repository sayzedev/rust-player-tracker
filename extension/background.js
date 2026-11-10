const FACEPUNCH_SCHEME = "rust-plus://rust-auth-session";
const FACEPUNCH_APP_ORIGIN = "https://companion-rust.facepunch.com";

function readAuthPayload(rawUrl) {
  try {
    if (!rawUrl || !rawUrl.startsWith(FACEPUNCH_SCHEME)) return null;
    const url = new URL(rawUrl);
    const token = url.searchParams.get("token") || url.searchParams.get("Token") || "";
    const steamId = url.searchParams.get("steamId") || url.searchParams.get("SteamId") || url.searchParams.get("steamID") || "";
    if (!/^\d{17}$/.test(steamId) || token.length < 20 || token.length > 4096 || /\s/.test(token)) return null;
    return { token, steamId, capturedAt: Date.now() };
  } catch {
    return null;
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  let target;
  try { target = new URL(details.url); } catch { return; }

  if (target.origin === FACEPUNCH_APP_ORIGIN && target.pathname === "/app") {
    const result = await chrome.storage.session.get("facepunchAppTabs");
    const tabs = Array.isArray(result.facepunchAppTabs) ? result.facepunchAppTabs : [];
    if (!tabs.includes(details.tabId)) tabs.push(details.tabId);
    await chrome.storage.session.set({ facepunchAppTabs: tabs.slice(-20) });
    return;
  }

  const payload = readAuthPayload(details.url);
  if (!payload) return;
  const result = await chrome.storage.session.get("facepunchAppTabs");
  const tabs = Array.isArray(result.facepunchAppTabs) ? result.facepunchAppTabs : [];
  if (!tabs.includes(details.tabId)) return;
  await chrome.storage.session.remove("facepunchAppTabs");
  await chrome.storage.session.set({ pendingRustPlus: payload });
  await chrome.action.setBadgeText({ text: "OK" });
  await chrome.action.setBadgeBackgroundColor({ color: "#16865b" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RUSTPLUS_GET_PENDING") return;
  let senderOrigin = "";
  try { senderOrigin = new URL(sender.url || "").origin; } catch {}
  if (senderOrigin !== "https://sayzedev.github.io") {
    sendResponse({ ok: false, error: "origin_not_allowed" });
    return;
  }
  chrome.storage.session.get("pendingRustPlus").then(async result => {
    const payload = result.pendingRustPlus || null;
    if (payload) await chrome.storage.session.remove("pendingRustPlus");
    await chrome.action.setBadgeText({ text: "" });
    sendResponse(payload
      ? { ok: true, payload }
      : { ok: false, error: "no_pending_token", message: "Токен не найден. Сначала заверши вход на официальной странице Facepunch." });
  }).catch(() => sendResponse({ ok: false, error: "extension_storage_error" }));
  return true;
});

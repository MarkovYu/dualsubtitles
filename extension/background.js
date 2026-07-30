const DEFAULT_LT_ENDPOINTS = [
  "https://translate.argosopentech.com/translate",
  "https://libretranslate.de/translate"
];

async function fetchText(url) {
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

// ---- Providers --------------------------------------------------------------

async function translateLibre(endpoint, text, source, target) {
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: source || "auto",
      target: target || "ru",
      format: "text"
    })
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Bad JSON from ${endpoint}`);
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

  const translated = data.translatedText || data.translation || "";
  if (!translated) throw new Error(`No translation from ${endpoint}`);
  return {
    translatedText: translated.trim(),
    alternatives: [],
    detected: data.detectedLanguage?.language || ""
  };
}

// DeepL — official API. Free-plan keys end with ":fx" and use the free host.
async function translateDeepL(key, text, source, target) {
  const host = /:fx$/i.test(key) ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const tgt = (target || "ru").toUpperCase();
  const body = new URLSearchParams();
  body.append("text", text);
  body.append("target_lang", tgt === "EN" ? "EN-US" : tgt);
  if (source && source !== "auto") body.append("source_lang", source.toUpperCase());

  const res = await fetch(host + "/v2/translate", {
    method: "POST",
    headers: {
      "Authorization": "DeepL-Auth-Key " + key,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("Bad JSON from DeepL"); }
  if (!res.ok) throw new Error(data?.message || `DeepL HTTP ${res.status}`);

  const t = data?.translations?.[0]?.text;
  if (!t) throw new Error("No translation from DeepL");
  return { translatedText: t.trim(), alternatives: [], detected: data.translations[0].detected_source_language || "" };
}

async function translateMyMemory(text, source, target) {
  const src = source && source !== "auto" ? source : "en";
  const tgt = target || "ru";
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(tgt)}`;
  const res = await fetch(url, { credentials: "omit", cache: "no-store" });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Bad JSON from MyMemory");
  }
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error("No translation from MyMemory");
  return { translatedText: translated.trim(), alternatives: [] };
}

// ---- Provider chain ---------------------------------------------------------

function buildProviders({ text, source, target, endpoint, deeplKey }) {
  const p = {};

  if (deeplKey && deeplKey.trim()) {
    const key = deeplKey.trim();
    p.deepl = { name: "DeepL", fn: () => translateDeepL(key, text, source, target) };
  }

  p.libre = {
    name: "LibreTranslate",
    fn: async () => {
      const eps = [];
      if (endpoint && endpoint.trim()) eps.push(endpoint.trim());
      eps.push(...DEFAULT_LT_ENDPOINTS);
      const seen = new Set();
      const errors = [];
      for (const ep of eps) {
        if (seen.has(ep)) continue;
        seen.add(ep);
        try { return await translateLibre(ep, text, source, target); }
        catch (e) { errors.push(e.message || String(e)); }
      }
      throw new Error(errors.join(" | ") || "All LibreTranslate endpoints failed");
    }
  };

  p.mymemory = { name: "MyMemory", fn: () => translateMyMemory(text, source, target) };

  return p;
}

async function translateWord(msg) {
  const providers = buildProviders(msg);
  const pref = (msg.provider || "auto").toLowerCase();

  // Default order: DeepL (if a key is set) → LibreTranslate → MyMemory.
  const base = providers.deepl
    ? ["deepl", "libre", "mymemory"]
    : ["libre", "mymemory"];

  // An explicit choice goes first; the rest stay as graceful fallbacks.
  let order = (pref !== "auto" && providers[pref])
    ? [pref, ...base.filter(k => k !== pref)]
    : base;
  order = order.filter(k => providers[k]);

  const errors = [];
  for (const key of order) {
    try {
      const result = await providers[key].fn();
      return {
        ok: true,
        provider: providers[key].name,
        translatedText: result.translatedText,
        alternatives: result.alternatives || [],
        detected: result.detected || ""
      };
    } catch (e) {
      errors.push(`${providers[key].name}: ${e.message}`);
    }
  }

  return { ok: false, error: errors.join(" | ") };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "fetchText") {
        const text = await fetchText(msg.url);
        sendResponse({ ok: true, text });
        return;
      }

      if (msg?.type === "translate") {
        const result = await translateWord(msg);
        sendResponse(result);
        return;
      }

      if (msg?.type === "injectHook") {
        const tabId = sender?.tab?.id;
        if (tabId == null) { sendResponse({ ok: false, error: "no tab id" }); return; }
        try {
          // Privileged MAIN-world injection: not subject to the page CSP and
          // doesn't require a (possibly fatal) "world" key in the manifest.
          const target = Number.isInteger(sender?.frameId)
            ? { tabId, frameIds: [sender.frameId] }
            : { tabId };
          await chrome.scripting.executeScript({
            target,
            world: "MAIN",
            files: ["inject.js"]
          });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        return;
      }

      if (msg?.type === "openVocabulary") {
        await chrome.tabs.create({ url: chrome.runtime.getURL("vocabulary.html") });
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();

  return true;
});

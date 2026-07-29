// Runs in the page's MAIN world so it can see the player's own network calls.
// Prime Video protects only audio/video with DRM; subtitles are plain
// TTML/DFXP (or VTT) text files. Amazon serves them from opaque CloudFront
// URLs, so we detect them by content-type and body signature (not just URL),
// and we also scan the player's JSON manifests for subtitle URLs and fetch
// those ourselves.
(() => {
  if (window.__KPDS_INJECT__) return;
  window.__KPDS_INJECT__ = true;

  const post = (url, text, lang) => {
    try { window.postMessage({ __kpds: true, type: "sub", url, text, lang: lang || "" }, "*"); } catch (e) {}
  };
  const dbg = (msg) => {
    try { window.postMessage({ __kpds: true, type: "dbg", msg: String(msg) }, "*"); } catch (e) {}
  };

  const SUB_EXT = /\.(dfxp|ttml2?|vtt)(\?|$)/i;
  const SUB_HINT = /subtitle|caption|timedtext|dfxp|ttml/i;
  const MANIFEST_HINT = /playback|resource|getplayback|presentation|subtitle|timedtext|catalog\/Get/i;

  const isTimedText = (t) =>
    typeof t === "string" && t.length > 20 &&
    (/<tt[\s>]/i.test(t) || /\bWEBVTT\b/.test(t) || /-->/.test(t));

  const langOf = (t) => {
    const m = /xml:lang\s*=\s*["']([a-zA-Z-]+)["']/.exec(t || "");
    return m ? m[1] : "";
  };

  const seen = new Set();
  const origFetch = window.fetch;
  window.__kpdsFetch = origFetch;

  const META_URL_HINT = /url|uri|href|src/i;
  const META_LANG_HINT = /language|lang|locale/i;
  let lastMetaKey = "";
  let lastMetaSentAt = 0;

  const findPrimePlayer = () => {
    try {
      const nodes = [...document.querySelectorAll("div[id^='dv-web-player']")];
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.querySelector && n.querySelector("video")) return n;
      }
    } catch (e) {}
    return null;
  };

  const playerContext = (el) => {
    try {
      return el?._reactRootContainer?._internalRoot?.current?.child?.memoizedProps?.context || null;
    } catch (e) {
      return null;
    }
  };

  const collectUrls = (obj, depth, out) => {
    if (!obj || depth > 5) return;
    if (typeof obj === "string") {
      if (/^https?:/i.test(obj) && (SUB_EXT.test(obj) || SUB_HINT.test(obj))) out.push(obj);
      return;
    }
    if (Array.isArray(obj)) {
      for (const v of obj) collectUrls(v, depth + 1, out);
      return;
    }
    if (typeof obj === "object") {
      let objHasSubtitleHint = false;
      try { objHasSubtitleHint = SUB_HINT.test(JSON.stringify(obj).slice(0, 3000)); } catch (e) {}
      for (const k in obj) {
        let v;
        try { v = obj[k]; } catch (e) { continue; }
        if (typeof v === "string" && META_URL_HINT.test(k) && /^https?:/i.test(v)) {
          if (SUB_EXT.test(v) || SUB_HINT.test(v) || objHasSubtitleHint) out.push(v);
        } else {
          collectUrls(v, depth + 1, out);
        }
      }
    }
  };

  const firstString = (obj, re, depth) => {
    if (!obj || depth > 4) return "";
    if (typeof obj === "string") return "";
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const s = firstString(v, re, depth + 1);
        if (s) return s;
      }
      return "";
    }
    if (typeof obj === "object") {
      for (const k in obj) {
        let v;
        try { v = obj[k]; } catch (e) { continue; }
        if (typeof v === "string" && re.test(k) && v.length < 80) return v;
        const s = firstString(v, re, depth + 1);
        if (s) return s;
      }
    }
    return "";
  };

  const streamLabel = (s, idx) =>
    firstString(s, /display|label|name|description/i, 0) ||
    firstString(s, META_LANG_HINT, 0) ||
    `Subtitles ${idx + 1}`;

  const streamLang = (s) => firstString(s, META_LANG_HINT, 0);

  const publishPrimeMeta = (payload) => {
    try { window.postMessage(payload, "*"); } catch (e) {}
    try {
      const nodes = [...document.querySelectorAll("div.kpds-prime-meta")];
      let el = nodes.find(n => {
        try { return JSON.parse(n.getAttribute("data-kpds-meta") || "{}").videoSrc === payload.videoSrc; }
        catch (e) { return false; }
      });
      if (!el) {
        el = document.createElement("div");
        el.className = "kpds-prime-meta";
        el.hidden = true;
        el.style.display = "none";
        document.body.appendChild(el);
      }
      el.setAttribute("data-kpds-meta", JSON.stringify({
        titleId: payload.titleId,
        videoSrc: payload.videoSrc,
        tracks: payload.tracks,
        at: Date.now()
      }));
      for (const old of nodes.slice(0, Math.max(0, nodes.length - 8))) old.remove();
    } catch (e) {}
  };

  const postPrimeTime = () => {
    try {
      const ctx = playerContext(findPrimePlayer());
      const ms = ctx?.webPlayer?.currentTime?.currentPosition;
      const time = Number(ms) / 1000;
      if (Number.isFinite(time) && time >= 0) {
        window.postMessage({ __kpds: true, type: "prime-time", time }, "*");
      }
    } catch (e) {}
  };

  const postPrimeMeta = () => {
    try {
      const el = findPrimePlayer();
      const ctx = playerContext(el);
      const video = el && el.querySelector("video");
      const item = ctx?.videoStream?.streamFeature?.currentPlaylistItem || null;
      const streams = item?.staticTimedTextStreams || [];
      if (!el || !video || !item?.titleId || !Array.isArray(streams) || !streams.length) return;

      const tracks = [];
      streams.forEach((s, idx) => {
        const urls = [];
        collectUrls(s, 0, urls);
        const url = urls.find(Boolean);
        if (!url) return;
        tracks.push({
          url,
          lang: streamLang(s),
          label: streamLabel(s, idx)
        });
      });
      if (!tracks.length) return;

      const key = `${item.titleId}|${video.currentSrc || video.src || ""}|${tracks.map(t => t.url).join("|")}`;
      const now = Date.now();
      if (key === lastMetaKey && now - lastMetaSentAt < 3000) return;
      lastMetaKey = key;
      lastMetaSentAt = now;

      publishPrimeMeta({
        __kpds: true,
        type: "prime-meta",
        titleId: item.titleId,
        videoSrc: video.currentSrc || video.src || "",
        tracks
      });
      dbg(`prime metadata ${item.titleId} · ${tracks.length} tracks`);
    } catch (e) {}
  };

  const handleText = (url, text, langHint) => {
    if (!text || (url && seen.has(url))) return;
    if (isTimedText(text)) {
      if (url) seen.add(url);
      post(url || "inline", text, langHint || langOf(text));
      dbg("captured subtitle " + String(url).slice(0, 90));
    }
  };

  // Fetch a candidate subtitle URL ourselves (page context, so same CORS the
  // player has). Use the original fetch to avoid re-entering our hook.
  const grab = (url, langHint) => {
    if (!url || seen.has(url)) return;
    try {
      (origFetch || window.fetch).call(window, url, { credentials: "omit" })
        .then(r => r.text())
        .then(t => handleText(url, t, langHint))
        .catch(() => {});
    } catch (e) {}
  };

  // Walk a JSON object looking for subtitle URLs / track descriptors.
  const scanJson = (obj, depth) => {
    if (!obj || depth > 7) return;
    if (typeof obj === "string") {
      if (/^https?:/.test(obj) && (SUB_EXT.test(obj) || SUB_HINT.test(obj))) grab(obj);
      return;
    }
    if (Array.isArray(obj)) { for (const v of obj) scanJson(v, depth + 1); return; }
    if (typeof obj === "object") {
      const url = obj.url || obj.uri || obj.src || obj.subtitleUrl;
      const lang = obj.languageCode || obj.language || obj.lang || obj.displayName || obj.langCode;
      const typeStr = JSON.stringify(obj.type || obj.subtype || obj.format || "");
      if (typeof url === "string" &&
          (SUB_EXT.test(url) || SUB_HINT.test(url) || /subtitle|caption|timedtext|dfxp|ttml/i.test(typeStr))) {
        grab(url, typeof lang === "string" ? lang : "");
      }
      for (const k in obj) { try { scanJson(obj[k], depth + 1); } catch (e) {} }
    }
  };

  // ---- fetch hook ----
  if (origFetch) {
    window.fetch = function (...args) {
      const input = args[0];
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const p = origFetch.apply(this, args);
      p.then((res) => {
        try {
          const ct = ((res.headers && res.headers.get && res.headers.get("content-type")) || "").toLowerCase();
          const urlMatch = url && (SUB_EXT.test(url) || SUB_HINT.test(url));
          const ctText = /ttml|dfxp|vtt|xml|text\/plain/.test(ct);
          const ctJson = /json/.test(ct);
          if (urlMatch || ctText) {
            res.clone().text().then(t => handleText(url, t)).catch(() => {});
          } else if (ctJson && (!url || MANIFEST_HINT.test(url))) {
            res.clone().json().then(j => scanJson(j, 0)).catch(() => {});
          }
        } catch (e) {}
      }).catch(() => {});
      return p;
    };
  }

  // ---- XHR hook ----
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const open = OrigXHR.prototype.open;
    const send = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url, ...rest) {
      this.__kpdsUrl = url;
      return open.call(this, method, url, ...rest);
    };
    OrigXHR.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          const url = this.__kpdsUrl || "";
          const ct = ((this.getResponseHeader && this.getResponseHeader("content-type")) || "").toLowerCase();
          const text = (this.responseType === "" || this.responseType === "text") ? this.responseText : "";
          if (!text) return;
          if ((url && (SUB_EXT.test(url) || SUB_HINT.test(url))) || /ttml|dfxp|vtt|xml|text\/plain/.test(ct)) {
            handleText(url, text);
          } else if (/json/.test(ct) && (!url || MANIFEST_HINT.test(url))) {
            try { scanJson(JSON.parse(text), 0); } catch (e) {}
          }
        } catch (e) {}
      });
      return send.apply(this, args);
    };
  }

  postPrimeMeta();
  postPrimeTime();
  setInterval(postPrimeMeta, 1000);
  setInterval(postPrimeTime, 500);
  dbg("subtitle hooks installed");
})();

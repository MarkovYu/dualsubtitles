// Runs in the page's MAIN world so it can see the player's own network calls.
// Prime Video protects only audio/video with DRM; subtitles are plain
// TTML/DFXP (or VTT) text files. Amazon serves them from opaque CloudFront
// URLs, so we detect them by content-type and body signature (not just URL),
// and we also scan the player's JSON manifests for subtitle URLs and fetch
// those ourselves.
(() => {
  if (window.__KPDS_INJECT__) return;
  window.__KPDS_INJECT__ = true;

  const stashSubtitle = (url, text, lang) => {
    try {
      const root = document.documentElement || document.head || document.body;
      if (!root) return;
      let box = document.getElementById("kpds-capture-buffer");
      if (!box) {
        box = document.createElement("div");
        box.id = "kpds-capture-buffer";
        box.hidden = true;
        box.style.display = "none";
        root.appendChild(box);
      }
      const item = document.createElement("div");
      item.className = "kpds-captured-sub";
      item.setAttribute("data-url", url || "inline");
      item.setAttribute("data-lang", lang || "");
      item.textContent = text || "";
      box.appendChild(item);
      while (box.children.length > 20) box.firstElementChild?.remove();
    } catch (e) {}
  };

  const post = (url, text, lang) => {
    stashSubtitle(url, text, lang);
    try { window.postMessage({ __kpds: true, type: "sub", url, text, lang: lang || "" }, "*"); } catch (e) {}
  };
  const dbg = (msg) => {
    try { window.postMessage({ __kpds: true, type: "dbg", msg: String(msg) }, "*"); } catch (e) {}
  };

  const SUB_EXT = /\.(dfxp|ttml2?|vtt|srt|ass|ssa)(?=$|[?#&"',)\]\s])/i;
  const SUB_HINT = /subtitle|subtitles|caption|timedtext|dfxp|ttml/i;
  const MANIFEST_HINT = /playback|resource|getplayback|presentation|subtitle|timedtext|catalog\/Get/i;

  const isTimedText = (t) =>
    typeof t === "string" && t.length > 20 &&
    (/<tt[\s>]/i.test(t) || /\bWEBVTT\b/.test(t) || /-->/.test(t) ||
      /^\s*\[Script Info\]/mi.test(t) || /^\s*\[Events\]/mi.test(t));

  const langOf = (t) => {
    const m = /xml:lang\s*=\s*["']([a-zA-Z-]+)["']/.exec(t || "");
    return m ? m[1] : "";
  };

  const seen = new Set();
  const scannedScripts = new WeakSet();
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
      const url = candidateUrl(obj);
      if (url && (SUB_EXT.test(url) || SUB_HINT.test(url))) out.push(url);
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
        if (typeof v === "string" && META_URL_HINT.test(k)) {
          const url = candidateUrl(v);
          if (url && (SUB_EXT.test(url) || SUB_HINT.test(url) || objHasSubtitleHint)) out.push(url);
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

  const textFromRuns = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value.runs)) return value.runs.map(r => r.text || "").join("").trim();
    return value.simpleText || "";
  };

  const youtubeCaptionUrl = (url) => {
    try {
      const u = new URL(url, location.href);
      u.searchParams.set("fmt", "json3");
      return u.toString();
    } catch (e) {
      return url;
    }
  };

  let lastYoutubeMetaKey = "";
  let lastYoutubeMetaAt = 0;
  const postYoutubeMeta = () => {
    try {
      const response = window.ytInitialPlayerResponse || window.ytplayer?.config?.args?.raw_player_response || window.ytplayer?.bootstrapPlayerResponse;
      const renderer = response?.captions?.playerCaptionsTracklistRenderer;
      const tracksRaw = renderer?.captionTracks || [];
      if (!Array.isArray(tracksRaw) || !tracksRaw.length) return;

      const seenTracks = new Set();
      const tracks = tracksRaw
        .filter(t => t?.baseUrl && !t.translationLanguage)
        .map((t, idx) => {
          const lang = t.languageCode || "";
          const auto = t.kind === "asr" ? " auto" : "";
          const name = textFromRuns(t.name) || t.languageName?.simpleText || t.languageCode || `Subtitles ${idx + 1}`;
          return {
            url: youtubeCaptionUrl(t.baseUrl),
            lang,
            label: `${name}${auto}`,
            key: `${t.vssId || ""}|${lang}|${name}|${auto}`
          };
        })
        .filter(t => {
          if (seenTracks.has(t.key)) return false;
          seenTracks.add(t.key);
          delete t.key;
          return true;
        });
      if (!tracks.length) return;

      const key = tracks.map(t => `${t.label}|${t.url}`).join("\n");
      const now = Date.now();
      if (key === lastYoutubeMetaKey && now - lastYoutubeMetaAt < 3000) return;
      lastYoutubeMetaKey = key;
      lastYoutubeMetaAt = now;
      window.postMessage({ __kpds: true, type: "yt-meta", tracks }, "*");
      dbg(`youtube metadata ${tracks.length} tracks`);
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

  const normalizeUrlText = (text) => String(text || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/gi, "?");

  const candidateUrl = (raw) => {
    let url = normalizeUrlText(raw)
      .replace(/^[\s"'([{]+/g, "")
      .replace(/[\s"'.,;)\]}]+$/g, "");
    try { url = decodeURIComponent(url); } catch (e) {}
    try {
      if (/^https?:\/\//i.test(url)) return url;
      if (/^\/\//.test(url)) return location.protocol + url;
      if (/^\//.test(url)) return new URL(url, location.href).toString();
    } catch (e) {}
    return "";
  };

  // Fetch a candidate subtitle URL ourselves (page context, so same CORS the
  // player has). Use the original fetch to avoid re-entering our hook.
  const grab = (url, langHint) => {
    if (!url || seen.has(url)) return;
    try {
      (origFetch || window.fetch).call(window, url, { credentials: "include" })
        .then(r => r.text())
        .then(t => handleText(url, t, langHint))
        .catch(() => {});
    } catch (e) {}
  };

  const scanTextForSubtitleUrls = (text, langHint) => {
    const src = normalizeUrlText(text);
    const re = /(?:https?:)?\/\/[^\s"',<>\\)\]]+|\/[^\s"',<>\\)\]]+?\.(?:dfxp|ttml2?|vtt|srt|ass|ssa)(?:[?#][^\s"',<>\\)\]]*)?/gi;
    let m;
    while ((m = re.exec(src))) {
      const url = candidateUrl(m[0]);
      if (SUB_EXT.test(url) || SUB_HINT.test(url)) grab(url, langHint);
    }
  };

  // Walk a JSON object looking for subtitle URLs / track descriptors.
  const scanJson = (obj, depth) => {
    if (!obj || depth > 7) return;
    if (typeof obj === "string") {
      const url = candidateUrl(obj);
      if (url && (SUB_EXT.test(url) || SUB_HINT.test(url))) grab(url);
      else if (SUB_HINT.test(obj) || SUB_EXT.test(obj)) scanTextForSubtitleUrls(obj);
      return;
    }
    if (Array.isArray(obj)) { for (const v of obj) scanJson(v, depth + 1); return; }
    if (typeof obj === "object") {
      const url = obj.url || obj.uri || obj.src || obj.subtitleUrl;
      const lang = obj.languageCode || obj.language || obj.lang || obj.displayName || obj.langCode;
      const typeStr = JSON.stringify(obj.type || obj.subtype || obj.format || "");
      const resolvedUrl = typeof url === "string" ? candidateUrl(url) : "";
      if (resolvedUrl &&
          (SUB_EXT.test(resolvedUrl) || SUB_HINT.test(resolvedUrl) || /subtitle|caption|timedtext|dfxp|ttml|srt|ass|ssa/i.test(typeStr))) {
        grab(resolvedUrl, typeof lang === "string" ? lang : "");
      }
      try {
        const preview = JSON.stringify(obj).slice(0, 12000);
        if (SUB_HINT.test(preview) || SUB_EXT.test(preview)) {
          scanTextForSubtitleUrls(preview, typeof lang === "string" ? lang : "");
        }
      } catch (e) {}
      for (const k in obj) { try { scanJson(obj[k], depth + 1); } catch (e) {} }
    }
  };

  const scanPlayerConfig = (value) => {
    try { scanJson(value, 0); } catch (e) {}
    if (typeof value === "string") scanTextForSubtitleUrls(value);
    else {
      try {
        const text = JSON.stringify(value);
        if (SUB_HINT.test(text) || SUB_EXT.test(text)) scanTextForSubtitleUrls(text);
      } catch (e) {}
    }
  };

  const scanInlineScripts = (root = document) => {
    try {
      const scripts = [];
      if (root.matches?.("script")) scripts.push(root);
      if (root.querySelectorAll) scripts.push(...root.querySelectorAll("script"));
      for (const script of scripts) {
        if (scannedScripts.has(script)) continue;
        scannedScripts.add(script);
        const text = script.textContent || "";
        if (text && (SUB_HINT.test(text) || SUB_EXT.test(text) || /Playerjs/i.test(text))) {
          scanTextForSubtitleUrls(text);
        }
      }
    } catch (e) {}
  };

  let wrappedPlayerjs = null;
  const wrapPlayerjsConstructor = () => {
    const Orig = window.Playerjs;
    if (typeof Orig !== "function" || Orig === wrappedPlayerjs || Orig.__kpdsWrapped) return;
    try {
      const Wrapped = function (...args) {
        for (const arg of args) scanPlayerConfig(arg);
        if (new.target) return Reflect.construct(Orig, args, new.target);
        return Orig.apply(this, args);
      };
      Object.setPrototypeOf(Wrapped, Orig);
      Wrapped.prototype = Orig.prototype;
      Wrapped.__kpdsWrapped = true;
      wrappedPlayerjs = Wrapped;
      window.Playerjs = Wrapped;
      dbg("PlayerJS constructor wrapped");
    } catch (e) {}
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
          const ctText = /ttml|dfxp|vtt|srt|ass|ssa|xml|text\/plain/.test(ct);
          const ctJson = /json/.test(ct);
          if (urlMatch || ctText) {
            res.clone().text().then(t => {
              handleText(url, t);
              if (!isTimedText(t) && (SUB_HINT.test(t) || SUB_EXT.test(t) || /Playerjs/i.test(t))) {
                scanTextForSubtitleUrls(t);
              }
            }).catch(() => {});
          } else if (ctJson && (!url || MANIFEST_HINT.test(url))) {
            res.clone().json().then(j => scanJson(j, 0)).catch(() => {});
          } else if (/javascript|html|text\/plain/.test(ct) || (url && /ajax|cdn|series|subtitle|player/i.test(url))) {
            res.clone().text().then(t => {
              if (SUB_HINT.test(t) || SUB_EXT.test(t) || /Playerjs/i.test(t)) scanTextForSubtitleUrls(t);
            }).catch(() => {});
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
          if ((url && (SUB_EXT.test(url) || SUB_HINT.test(url))) || /ttml|dfxp|vtt|srt|ass|ssa|xml|text\/plain/.test(ct)) {
            handleText(url, text);
            if (!isTimedText(text) && (SUB_HINT.test(text) || SUB_EXT.test(text) || /Playerjs/i.test(text))) {
              scanTextForSubtitleUrls(text);
            }
          } else if (/json/.test(ct) && (!url || MANIFEST_HINT.test(url))) {
            try { scanJson(JSON.parse(text), 0); } catch (e) {}
          } else if (/javascript|html|text\/plain/.test(ct) || (url && /ajax|cdn|series|subtitle|player/i.test(url))) {
            if (SUB_HINT.test(text) || SUB_EXT.test(text) || /Playerjs/i.test(text)) scanTextForSubtitleUrls(text);
          }
        } catch (e) {}
      });
      return send.apply(this, args);
    };
  }

  postPrimeMeta();
  postYoutubeMeta();
  postPrimeTime();
  wrapPlayerjsConstructor();
  scanInlineScripts();
  try {
    new MutationObserver((records) => {
      wrapPlayerjsConstructor();
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.nodeType === 1) scanInlineScripts(node);
        }
      }
    }).observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
  setInterval(postPrimeMeta, 1000);
  setInterval(postYoutubeMeta, 1000);
  setInterval(postPrimeTime, 500);
  setInterval(wrapPlayerjsConstructor, 1000);
  dbg("subtitle hooks installed");
})();

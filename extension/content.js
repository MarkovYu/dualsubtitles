(() => {
  if (window.__KPDS_V13__) return;
  window.__KPDS_V13__ = true;

  const state = {
    cues: [],
    mode: "site",
    selectedTrackUrl: "",
    selectedTrackLabel: "",
    offset: 0,
    size: 28,
    bottom: 11,
    clickable: true,
    sourceLang: "auto",
    targetLang: "ru",
    provider: "auto",
    deeplKey: "",
    endpoint: "",
    lastText: "",
    loaded: false,
    currentPopupPayload: null,
    loadedCache: new Map(),
    dualTranslate: false,
    dualCache: new Map(),
    failedTranslations: new Map(),
    pending: new Set(),
    transToken: 0,
    capturedTracks: [],
    syncing: false,
    autoLoaded: false,
    trackLang: "",
    lastError: "",
    mismatchFrames: 0,
    panelHidden: false,
    mediaSrc: "",
    loadedSrc: "",
    pendingSrc: "",
    pendingSrcFrames: 0,
    recoverIv: 0,
    primeTitleId: "",
    loadedPrimeTitleId: "",
    lastPrimeMetaAt: 0,
    primePlayerTime: 0,
    primePlayerTimeAt: 0,
    loadSeq: 0
  };
  let settingsSaveTimer = 0;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---- Per-site adapters -------------------------------------------------
  function detectSite() {
    const host = location.hostname;
    if (/(^|\.)primevideo\.com$/.test(host) || /(^|\.)amazon\.[a-z.]+$/.test(host)) {
      return {
        id: "prime",
        name: "Prime Video",
        videoSelectors: ["#dv-web-player video", ".webPlayerContainer video", "video"],
        captionSelectors: [
          ".atvwebplayersdk-captions-text",
          ".atvwebplayersdk-captions-overlay",
          "[class*='captions-text']"
        ],
        nativeCaptionSelector: ".atvwebplayersdk-captions-text, .atvwebplayersdk-captions-overlay",
        siteTracks: true,
        trackSource: "capture",
        // Prime exposes the current episode's subtitle stream list in the
        // player context. We use that metadata first, and keep mirroring as a
        // fallback if a specific file can't be loaded.
        defaultMode: "site"
      };
    }
    return {
      id: "kinopub",
      name: "Kino.pub",
      videoSelectors: ["media-player#player video", "video"],
      captionSelectors: ["media-captions.player-captions"],
      nativeCaptionSelector: "media-captions.player-captions",
      siteTracks: true,
      trackSource: "dom",
      defaultMode: "site"
    };
  }
  const SITE = detectSite();

  // Languages offered in the From/To pickers.
  const LANGS = [
    ["en", "English"], ["de", "German"], ["ru", "Russian"], ["uk", "Ukrainian"],
    ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["pt", "Portuguese"],
    ["nl", "Dutch"], ["pl", "Polish"], ["tr", "Turkish"], ["el", "Greek"],
    ["cs", "Czech"], ["sv", "Swedish"], ["da", "Danish"], ["fi", "Finnish"],
    ["no", "Norwegian"], ["ro", "Romanian"], ["hu", "Hungarian"], ["bg", "Bulgarian"],
    ["hr", "Croatian"], ["sr", "Serbian"], ["sk", "Slovak"], ["ar", "Arabic"],
    ["he", "Hebrew"], ["hi", "Hindi"], ["ja", "Japanese"], ["ko", "Korean"],
    ["zh", "Chinese"]
  ];
  const langOptions = (sel) => LANGS.map(([c, n]) => `<option value="${c}"${c === sel ? " selected" : ""}>${n}</option>`).join("");

  function sendMessage(msg) {
    return new Promise((resolve) => {
      const contextError = (err) => /Extension context invalidated|context invalidated|Receiving end does not exist/i.test(String(err || ""));
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        resolve({ ok: false, error: "Extension context invalidated. Reload this page after updating the extension.", contextInvalidated: true });
        return;
      }
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          let err = "";
          try {
            err = chrome.runtime.lastError?.message || "";
          } catch (e) {
            err = e?.message || String(e);
          }
          if (err) {
            resolve({ ok: false, error: err, contextInvalidated: contextError(err) });
          } else {
            resolve(resp || { ok: false, error: "Empty response" });
          }
        });
      } catch (e) {
        const err = e.message || String(e);
        resolve({ ok: false, error: err, contextInvalidated: contextError(err) });
      }
    });
  }

  const chromeTranslatorCache = new Map();

  function chromeTranslatorApi() {
    if (globalThis.Translator) {
      return {
        availability: (globalThis.Translator.availability || globalThis.Translator.canTranslate)?.bind(globalThis.Translator),
        create: globalThis.Translator.create?.bind(globalThis.Translator)
      };
    }
    if (globalThis.translation?.createTranslator) {
      return {
        availability: globalThis.translation.canTranslate?.bind(globalThis.translation),
        create: globalThis.translation.createTranslator.bind(globalThis.translation)
      };
    }
    if (globalThis.ai?.translator?.create) {
      return {
        availability: globalThis.ai.translator.capabilities,
        create: globalThis.ai.translator.create.bind(globalThis.ai.translator)
      };
    }
    return null;
  }

  function toChromeTranslatorLanguage(lang) {
    const l = String(lang || "").trim();
    if (!l) return "";
    if (/^he\b/i.test(l)) return "iw";
    return l.toLowerCase().split(/[-_]/)[0];
  }

  function normalizeTranslatorAvailability(value) {
    if (value === true || value === "available" || value === "readily") return "available";
    if (value === "downloadable" || value === "downloading" || value === "after-download") return "downloadable";
    return "unavailable";
  }

  async function translateWithChromeBuiltIn(text, source, target) {
    const api = chromeTranslatorApi();
    if (!api) throw new Error("Chrome built-in Translator is not available");

    const sourceLanguage = source && source !== "auto"
      ? toChromeTranslatorLanguage(source)
      : (toChromeTranslatorLanguage(state.trackLang) || "en");
    const targetLanguage = toChromeTranslatorLanguage(target || "ru");
    if (!sourceLanguage || sourceLanguage === targetLanguage) {
      throw new Error("Choose different source and target languages");
    }

    const options = { sourceLanguage, targetLanguage };
    const availabilityFn = api.availability || api.canTranslate;
    if (typeof availabilityFn === "function") {
      const availability = normalizeTranslatorAvailability(await availabilityFn.call(api, options));
      if (availability === "unavailable") {
        throw new Error(`Language pair unavailable in Chrome (${sourceLanguage} -> ${targetLanguage})`);
      }
    }

    const cacheKey = `${sourceLanguage}:${targetLanguage}`;
    let translator = chromeTranslatorCache.get(cacheKey);
    if (!translator) {
      translator = await api.create(options);
      chromeTranslatorCache.set(cacheKey, translator);
    }

    const translatedText = await translator.translate(text);
    if (!translatedText) throw new Error("No translation from Chrome built-in Translator");
    return {
      ok: true,
      provider: "Chrome built-in",
      translatedText: String(translatedText).trim(),
      alternatives: [],
      detected: sourceLanguage
    };
  }

  async function translateText(text) {
    const provider = (state.provider || "auto").toLowerCase();
    const shouldTryChrome = provider === "auto" || provider === "chrome";
    if (shouldTryChrome) {
      try {
        return await translateWithChromeBuiltIn(text, state.sourceLang, state.targetLang);
      } catch (e) {
        const message = e?.message || String(e);
        return {
          ok: false,
          error: provider === "auto"
            ? `${message}. Choose "Free online fallback" or add an API key if you want online translation.`
            : message
        };
      }
    }

    const onlineProvider = provider === "online" ? "auto" : state.provider;
    return sendMessage({
      type: "translate",
      text,
      source: state.sourceLang,
      target: state.targetLang,
      endpoint: state.endpoint,
      provider: onlineProvider,
      deeplKey: state.deeplKey
    });
  }

  function videoCandidates() {
    const found = [];
    for (const sel of SITE.videoSelectors) {
      for (const v of $$(sel)) {
        if (v && !found.includes(v)) found.push(v);
      }
    }
    return found;
  }

  function videoScore(v) {
    if (!v) return -1;
    const r = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: 0, height: 0 };
    const area = Math.max(0, r.width || 0) * Math.max(0, r.height || 0);
    let score = 0;
    if (Number.isFinite(v.duration) && v.duration > 0) score += 40;
    if (Number.isFinite(v.currentTime) && v.currentTime > 0.25) score += 30;
    if (v.readyState >= 2) score += 20;
    if (!v.paused) score += 20;
    if (!v.ended) score += 10;
    if (area > 10000) score += 10;
    if (r.width > 0 && r.height > 0) score += 5;
    return score + Math.min(area / 100000, 10);
  }

  function getVideo() {
    const videos = videoCandidates();
    if (!videos.length) return null;

    let best = videos[0];
    let bestScore = videoScore(best);
    for (const v of videos.slice(1)) {
      const score = videoScore(v);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  // Prime's detail/description page autoplays a muted hero-trailer preview that
  // carries the player's own captions. Only treat a video as real playback the
  // user chose to watch when it's the dedicated watch player (#dv-web-player),
  // is fullscreen, or genuinely fills the viewport — so we never mirror the
  // background preview before the user presses play.
  function isPrimaryPlayback(video) {
    if (!video) return false;
    if (SITE.id !== "prime") return true;
    try {
      // Fail open: show subtitles unless this is clearly the detail-page hero
      // preview, which autoplays MUTED, windowed, and small. Anything
      // fullscreen, unmuted, or large counts as real playback — so watching in
      // a window (even not fullscreen) always shows subtitles.
      if (document.fullscreenElement || document.webkitFullscreenElement) return true;
      if (!video.muted) return true;
      const r = video.getBoundingClientRect();
      if (r.height >= window.innerHeight * 0.5) return true;
      return false;
    } catch (e) {
      return true;
    }
  }

  function getFullscreenRoot() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
  }

  function ensureOverlay() {
    let overlay = document.getElementById("kpds-overlay");
    const root = getFullscreenRoot();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "kpds-overlay";
    }
    if (overlay.parentNode !== root) root.appendChild(overlay);
    overlay.style.fontSize = `${state.size}px`;
    overlay.style.bottom = `${state.bottom}vh`;
    return overlay;
  }

  function ensurePopup() {
    let popup = document.getElementById("kpds-translate-popup");
    const root = getFullscreenRoot();
    if (!popup) {
      popup = document.createElement("div");
      popup.id = "kpds-translate-popup";
      popup.className = "kpds-hidden";
    }
    if (popup.parentNode !== root) root.appendChild(popup);
    return popup;
  }

  function hidePopup() {
    const popup = document.getElementById("kpds-translate-popup");
    if (popup) popup.classList.add("kpds-hidden");
  }

  function setStatus(text) {
    const el = document.getElementById("kpds-status");
    if (el) el.textContent = text || "";
  }

  function settingsPayload() {
    return {
      sourceLang: state.sourceLang,
      targetLang: state.targetLang,
      provider: state.provider,
      deeplKey: state.deeplKey,
      endpoint: state.endpoint,
      offset: state.offset,
      size: state.size,
      bottom: state.bottom,
      clickable: state.clickable,
      dualTranslate: state.dualTranslate,
      panelHidden: state.panelHidden
    };
  }

  function saveSettings() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return Promise.resolve();
    return chrome.storage.local.set({ kpdsSettings: settingsPayload() }).catch(() => {});
  }

  function saveSettingsSoon() {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(() => {
      settingsSaveTimer = 0;
      saveSettings();
    }, 150);
  }

  function applyPanelHidden() {
    const panel = document.getElementById("kpds-panel");
    if (panel) panel.style.display = state.panelHidden ? "none" : "";
  }

  function setPanelHidden(hidden) {
    state.panelHidden = !!hidden;
    if (!state.panelHidden) {
      createPanel();
      syncPanelInputs();
      setStatus(`${SITE.name} panel restored.`);
    }
    applyPanelHidden();
    saveSettingsSoon();
  }

  function resetTranslations() {
    state.dualCache.clear();
    state.failedTranslations.clear();
    state.pending.clear();
    state.lastText = "";
  }

  // Identifies the current title so we can detect SPA navigation between films.
  // Returns "" when no title id is present — an empty key never triggers a
  // reset, so ref-parameter / player-URL noise won't wipe a loaded track.
  function contentKey() {
    const m = location.href.match(/\/(?:detail|watch)\/([A-Za-z0-9]{8,})/i)
      || location.href.match(/[?&]gti=([A-Za-z0-9._-]+)/i);
    return m ? m[1] : "";
  }

  // Prime/Amazon are SPAs: switching films doesn't reload the page, so wipe
  // everything tied to the previous title.
  function resetForNavigation() {
    state.cues = [];
    state.capturedTracks = [];
    state.loadedCache.clear();
    state.dualCache.clear();
    state.pending.clear();
    state.lastText = "";
    state.selectedTrackUrl = "";
    state.selectedTrackLabel = "";
    state.loaded = false;
    state.autoLoaded = false;
    state.trackLang = "";
    state.loadedSrc = "";
    state.loadedPrimeTitleId = "";
    state.primeTitleId = "";
    state.loadSeq++;
    state.mode = SITE.defaultMode;
    document.documentElement.classList.remove("kpds-hide-native");
    renderSubtitle("");
    refreshTrackList();
    if (SITE.trackSource === "capture") {
      requestHookInjection();
      setStatus(`New title detected. Turn subtitles ON in the player.`);
    }
  }

  // A new media source loaded in the same page (typically the next episode).
  // Clear everything tied to the previous episode but keep the user's mode, then
  // let the new episode's subtitle track be captured and auto-shown.
  function onMediaChanged(newSrc) {
    // Already showing subtitles that belong to this exact media? Nothing to do.
    if (newSrc && state.loadedSrc === newSrc) return;
    // In mirror mode we read the player's live on-screen captions, which already
    // follow the new episode — just clear the last line and keep mirroring.
    if (state.mode === "mirror") { state.lastText = ""; renderSubtitle(""); return; }

    state.cues = [];
    state.dualCache.clear();
    state.pending.clear();
    state.loadedCache.clear();
    state.lastText = "";
    state.selectedTrackUrl = "";
    state.selectedTrackLabel = "";
    state.loaded = false;
    state.autoLoaded = false;
    state.mismatchFrames = 0;
    state.loadedPrimeTitleId = "";
    state.loadSeq++;
    // Drop only the PREVIOUS episode's captured tracks; keep anything already
    // captured for the new source so it can be shown without a reload.
    state.capturedTracks = state.capturedTracks.filter(t => !newSrc || !t.src || t.src === newSrc);
    renderSubtitle("");
    refreshTrackList();
    if (SITE.trackSource === "capture") requestHookInjection();
    attemptRecovery();
  }

  function nativeCaptionsPresent() {
    return !!document.querySelector(".atvwebplayersdk-captions-text, [class*='captions-text']");
  }

  // Bring subtitles back for the current media: first via capture/auto-load,
  // and if that can't produce a track (common on Amazon after an ad break or
  // episode change, where the player never re-requests the subtitle file), fall
  // back to mirroring the player's own on-screen captions. Once mirroring,
  // later episodes keep working automatically.
  function attemptRecovery() {
    if (state.recoverIv) { clearInterval(state.recoverIv); state.recoverIv = 0; }
    let tries = 0, capSeen = 0;
    state.recoverIv = setInterval(() => {
      tries++;
      if (state.mode === "mirror" || state.cues.length) { clearInterval(state.recoverIv); state.recoverIv = 0; return; }
      maybeAutoLoad();
      if (state.cues.length) { clearInterval(state.recoverIv); state.recoverIv = 0; return; }
      if (SITE.trackSource === "capture") {
        const primeHasRecentMeta = SITE.id === "prime"
          && (state.capturedTracks.length || (state.lastPrimeMetaAt && Date.now() - state.lastPrimeMetaAt < 10000));
        const goMirror = () => {
          clearInterval(state.recoverIv); state.recoverIv = 0;
          setMode("mirror");
          setStatus("Showing the player's subtitles. Tap a word to translate.");
        };
        // On Prime, React metadata usually appears a moment after the new
        // episode starts. Avoid switching to mirror while those tracks are
        // available or have just been reported.
        if (!primeHasRecentMeta && tries >= 14 && mirrorVisibleCaptions()) return goMirror();
        if (!primeHasRecentMeta && nativeCaptionsPresent()) {
          if (++capSeen >= 12) return goMirror();
        } else {
          capSeen = 0;
          if (SITE.id === "prime" && tries === 4) setStatus("Finding this episode's Prime subtitle tracks...");
        }
      }
      if (tries >= 24) {   // ~12s
        clearInterval(state.recoverIv); state.recoverIv = 0;
        if (SITE.trackSource === "capture" && state.mode !== "mirror" && !state.cues.length) {
          setStatus("Turn on this episode's subtitles in the player, then press Reload.");
        }
      }
    }, 500);
  }

  // Manual "Reload" from the panel — hard reset for the current media, then
  // recover (capture, else mirror the player's own captions). No page refresh.
  function reloadSubtitles() {
    const v = getVideo();
    state.cues = [];
    state.dualCache.clear();
    state.pending.clear();
    state.loadedCache.clear();
    state.lastText = "";
    state.selectedTrackUrl = "";
    state.selectedTrackLabel = "";
    state.loaded = false;
    state.autoLoaded = false;
    state.mismatchFrames = 0;
    state.loadedSrc = "";
    state.loadedPrimeTitleId = "";
    state.loadSeq++;
    state.mediaSrc = (v && v.currentSrc) || "";
    if (state.mode === "mirror") state.mode = SITE.defaultMode;
    document.documentElement.classList.remove("kpds-hide-native");
    state.capturedTracks = state.capturedTracks.filter(t => !t.src || t.src === state.mediaSrc);
    renderSubtitle("");
    refreshTrackList();
    if (SITE.trackSource === "capture") requestHookInjection();
    setStatus("Reloading subtitles…");
    attemptRecovery();
  }

  function setMode(mode) {
    state.mode = mode;
    // In mirror mode we read the site's own captions, so dim them visually
    // (opacity keeps innerText readable) and show only our clickable overlay.
    document.documentElement.classList.toggle("kpds-hide-native", mode === "mirror");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function stripWord(s) {
    return String(s || "")
      .replace(/^[\s"'“”‘’«»()[\]{}.,!?;:—–-]+|[\s"'“”‘’«»()[\]{}.,!?;:—–-]+$/g, "")
      .trim();
  }

  // Split a line into separators + words. Apostrophes are NOT separators, so
  // "don't" stays whole; periods/dashes/etc. are, so "αυτό.Θα" and "rekord?-Nem"
  // become two words. Plain regex only (no \p{} / matchAll) so it runs on older
  // Chrome too.
  const KPDS_SEP_RE = /[\s.,!?;:"“”«»()\[\]{}…—–\/\\|<>@#$%^&*=+~`-]+/;

  function renderClickableText(text) {
    text = String(text || "");
    const sepRe = new RegExp("^(?:" + KPDS_SEP_RE.source + ")$");
    const parts = text.split(new RegExp("(" + KPDS_SEP_RE.source + ")"));
    let out = "";
    for (const part of parts) {
      if (!part) continue;
      if (sepRe.test(part)) {
        out += escapeHtml(part).replace(/\n/g, "<br>");
      } else {
        out += `<span class="kpds-word" data-word="${escapeHtml(part)}">${escapeHtml(part)}</span>`;
      }
    }
    return out;
  }

  function renderSubtitle(text) {
    const overlay = ensureOverlay();
    if (!text) {
      overlay.innerHTML = "";
      state.lastText = "";
      return;
    }

    if (text === state.lastText) return;
    state.lastText = text;

    let origHtml;
    if (state.clickable) {
      try {
        origHtml = renderClickableText(text);
      } catch (e) {
        // Never let word-splitting hide the subtitles — fall back to plain text.
        console.warn("[KPDS] clickable render fallback:", e);
        origHtml = escapeHtml(text).replace(/\n/g, "<br>");
      }
    } else {
      origHtml = escapeHtml(text).replace(/\n/g, "<br>");
    }

    if (!state.dualTranslate) {
      overlay.innerHTML = `<div class="kpds-line kpds-line-orig">${origHtml}</div>`;
      return;
    }

    const has = state.dualCache.has(text);
    const cached = has ? state.dualCache.get(text) : "";
    overlay.innerHTML =
      `<div class="kpds-line kpds-line-orig">${origHtml}</div>` +
      `<div class="kpds-line kpds-line-trans">${has ? escapeHtml(cached) : "·····"}</div>`;

    if (!has) ensureTranslation(text, true);
  }

  const TRANS_CACHE_MAX = 400;

  function cacheTranslation(text, val) {
    state.dualCache.set(text, val);
    // Keep memory bounded: drop the oldest entries (Map preserves order).
    while (state.dualCache.size > TRANS_CACHE_MAX) {
      const oldest = state.dualCache.keys().next().value;
      state.dualCache.delete(oldest);
    }
  }

  function fillTransLine(text, val) {
    if (state.lastText !== text) return;
    const el = document.querySelector("#kpds-overlay .kpds-line-trans");
    if (el) el.textContent = val;
  }

  // Translate a line, caching the result. updateDom=true also fills the
  // currently shown line. Used both for the active line and for prefetching
  // upcoming lines, so by the time they appear the translation is ready.
  function ensureTranslation(text, updateDom) {
    if (!text) return;
    if (state.dualCache.has(text)) {
      if (updateDom) fillTransLine(text, state.dualCache.get(text));
      return;
    }
    const failedAt = state.failedTranslations.get(text) || 0;
    if (failedAt && Date.now() - failedAt < 30000) return;
    if (state.pending.has(text)) return;
    state.pending.add(text);

    translateText(text).then((resp) => {
      state.pending.delete(text);
      if (!resp?.ok) {
        state.lastError = `translate: ${resp?.error || "unknown"}`;
        console.warn("[KPDS] line translation failed:", resp?.error || "unknown");
        state.failedTranslations.set(text, Date.now());
        if (resp?.contextInvalidated) {
          setStatus("Extension was updated. Reload this page once to reconnect translation.");
        }
      } else {
        state.failedTranslations.delete(text);
        cacheTranslation(text, resp.translatedText);
        fillTransLine(text, state.dualCache.get(text) || "");
      }
    }).catch(() => { state.pending.delete(text); });
  }

  // Warm the cache for the current and next couple of cues.
  function prefetchUpcoming(time) {
    if (!state.dualTranslate || state.mode === "mirror" || !state.cues.length) return;
    const t = time + Number(state.offset || 0);
    let i = 0;
    while (i < state.cues.length && state.cues[i].end < t) i++;
    for (let j = 0; j < 1 && i + j < state.cues.length; j++) {
      const c = state.cues[i + j];
      if (c && c.text) ensureTranslation(c.text, false);
    }
  }

  function parseTime(t) {
    const m = String(t).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
    if (!m) return 0;
    const h = Number(m[1] || 0);
    const min = Number(m[2] || 0);
    const sec = Number(m[3] || 0);
    const ms = Number((m[4] || "0").padEnd(3, "0").slice(0, 3));
    return h * 3600 + min * 60 + sec + ms / 1000;
  }

  function parseSrtOrVtt(text, baseOffset = 0) {
    text = String(text || "")
      .replace(/^\uFEFF/, "")
      .replace(/^WEBVTT[^\n]*(\n|$)/i, "")
      .replace(/\r/g, "");

    const blocks = text.split(/\n{2,}/);
    const cues = [];

    for (const block of blocks) {
      const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
      if (!lines.length) continue;

      const timeIdx = lines.findIndex(l => l.includes("-->"));
      if (timeIdx < 0) continue;

      const [startRaw, endRaw] = lines[timeIdx]
        .split("-->")
        .map(s => s.trim().split(/\s+/)[0]);

      const start = parseTime(startRaw) + baseOffset;
      const end = parseTime(endRaw) + baseOffset;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      const cueText = lines.slice(timeIdx + 1).join("\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();

      if (cueText) cues.push({ start, end, text: cueText });
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  function parseTtmlTime(v, tickRate, frameRate) {
    v = String(v || "").trim();
    if (/^\d+(\.\d+)?s$/i.test(v)) return parseFloat(v);
    if (/^\d+(\.\d+)?ms$/i.test(v)) return parseFloat(v) / 1000;
    if (/^\d+(\.\d+)?m$/i.test(v)) return parseFloat(v) * 60;
    if (/^\d+(\.\d+)?h$/i.test(v)) return parseFloat(v) * 3600;
    // Tick-based time (common in Amazon DFXP), needs ttp:tickRate.
    if (/^\d+(\.\d+)?t$/i.test(v)) {
      const rate = tickRate || 10000000; // 100ns default if unspecified
      return parseFloat(v) / rate;
    }
    const fps = frameRate || 25;
    const clock = v.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/);
    if (clock) {
      return (+clock[1]) * 3600 + (+clock[2]) * 60 + (+clock[3]) +
        (clock[4] ? parseFloat("0." + clock[4]) : 0);
    }
    const frames = v.match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/);
    if (frames) {
      return (+frames[1]) * 3600 + (+frames[2]) * 60 + (+frames[3]) + (+frames[4]) / fps;
    }
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function ttmlOwnBegin(node, tickRate, frameRate) {
    if (!node || !node.getAttribute) return 0;
    const begin = node.getAttribute("begin");
    return begin ? parseTtmlTime(begin, tickRate, frameRate) : 0;
  }

  function ttmlInheritedBegin(node, root, tickRate, frameRate) {
    let t = 0;
    const chain = [];
    for (let n = node; n && n !== root; n = n.parentNode) {
      if (n.nodeType === 1) chain.push(n);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      t += ttmlOwnBegin(chain[i], tickRate, frameRate);
    }
    return t;
  }

  function parseTtml(xml, baseOffset = 0) {
    const cues = [];
    let doc;
    try {
      doc = new DOMParser().parseFromString(xml, "text/xml");
    } catch {
      return cues;
    }

    // Read timing parameters from the <tt> root (ticks/frames).
    const tt = doc.getElementsByTagNameNS("*", "tt")[0] || doc.documentElement;
    const ttAttr = (name) =>
      (tt && (tt.getAttribute("ttp:" + name) || tt.getAttribute(name))) || "";
    const tickRate = parseFloat(ttAttr("tickRate")) || 0;
    const frameRate = parseFloat(ttAttr("frameRate")) || 0;

    let ps = [...doc.getElementsByTagNameNS("*", "p")];
    if (!ps.length) ps = [...doc.getElementsByTagName("p")];
    for (const p of ps) {
      const begin = p.getAttribute("begin");
      if (!begin) continue;
      const end = p.getAttribute("end");
      const dur = p.getAttribute("dur");

      const parentOffset = ttmlInheritedBegin(p.parentNode, tt, tickRate, frameRate);
      const start = parentOffset + parseTtmlTime(begin, tickRate, frameRate) + baseOffset;
      let stop;
      if (end) stop = parentOffset + parseTtmlTime(end, tickRate, frameRate) + baseOffset;
      else if (dur) stop = start + parseTtmlTime(dur, tickRate, frameRate);
      else stop = start + 3;

      const text = (p.innerHTML || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+\n/g, "\n")
        .trim();

      if (text && Number.isFinite(start)) cues.push({ start, end: stop, text });
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  function parseSubtitle(text, baseOffset = 0) {
    if (/<tt[\s>]/i.test(text)) return parseTtml(text, baseOffset);
    return parseSrtOrVtt(text, baseOffset);
  }

  function parseHlsPlaylist(text, baseUrl) {
    const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const segments = [];
    let offset = 0;
    let pendingDuration = 0;

    for (const line of lines) {
      if (line.startsWith("#EXTINF:")) {
        pendingDuration = parseFloat(line.slice(8).split(",")[0]) || 0;
        continue;
      }
      if (line.startsWith("#")) continue;

      segments.push({
        url: resolveUrl(line, baseUrl),
        offset
      });
      offset += pendingDuration;
      pendingDuration = 0;
    }

    return segments;
  }

  function resolveUrl(url, base) {
    try {
      return new URL(url, base).toString();
    } catch {
      return url;
    }
  }

  async function fetchTextViaBg(url) {
    if (state.loadedCache?.has(url)) return state.loadedCache.get(url);

    const resp = await sendMessage({ type: "fetchText", url });
    if (!resp?.ok) throw new Error(resp?.error || `Extension fetch failed for ${url.slice(0, 80)}`);

    state.loadedCache.set(url, resp.text);
    return resp.text;
  }

  async function loadSubtitleUrl(url) {
    const text = await fetchTextViaBg(url);

    if (/^\s*#EXTM3U/m.test(text) || /\.m3u8(\?|$)/i.test(url)) {
      const segments = parseHlsPlaylist(text, url);

      if (!segments.length) throw new Error("m3u8 has no subtitle segments");

      const cues = [];
      const seen = new Set();
      for (const seg of segments) {
        const segText = await fetchTextViaBg(seg.url);
        const parsed = parseSubtitle(segText, 0);
        const firstStart = parsed.find(c => Number.isFinite(c.start))?.start || 0;
        const addOffset = seg.offset > 0 && firstStart < Math.max(60, seg.offset - 5);
        for (const cue of parsed) {
          const shifted = addOffset
            ? { start: cue.start + seg.offset, end: cue.end + seg.offset, text: cue.text }
            : cue;
          const key = `${Math.round(shifted.start * 1000)}|${Math.round(shifted.end * 1000)}|${shifted.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cues.push(shifted);
        }
      }

      cues.sort((a, b) => a.start - b.start);
      return cues;
    }

    return parseSubtitle(text, 0);
  }

  function activeCueAt(time) {
    const t = time + Number(state.offset || 0);
    // Linear scan is fine for short subtitle lists; keeps code stable.
    for (const cue of state.cues) {
      if (t >= cue.start && t <= cue.end) return cue;
    }
    return null;
  }

  function playbackTime(video) {
    if (SITE.id === "prime" && Number.isFinite(state.primePlayerTime) && Date.now() - state.primePlayerTimeAt < 1500) {
      return state.primePlayerTime;
    }
    return Number.isFinite(video?.currentTime) ? video.currentTime : 0;
  }

  function mirrorVisibleCaptions() {
    for (const sel of SITE.captionSelectors) {
      const nodes = $$(sel);
      if (!nodes.length) continue;
      const text = nodes
        .map(n => (n.innerText || n.textContent || "").trim())
        .filter(Boolean)
        .join("\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
      if (text) return text;
    }
    return "";
  }

  let panelCheck = 0;
  let lastContentKey = contentKey();
  function tick() {
    try {
      ensureOverlay();
      ensurePopup();
      // Cheap, but no need every frame — check ~3x/sec that the panel survived.
      if (++panelCheck % 20 === 0) {
        ensurePanel();
        const key = contentKey();
        if (key && !lastContentKey) {
          lastContentKey = key;                 // first time we learn the title
        } else if (key && key !== lastContentKey) {
          lastContentKey = key;                 // genuine switch to another title
          resetForNavigation();
        }
      }

      const video = getVideo();
      if (!video) {
        requestAnimationFrame(tick);
        return;
      }

      // Don't show subtitles for a detail-page autoplay preview — only for the
      // player the user is actually watching.
      if (!isPrimaryPlayback(video)) {
        renderSubtitle("");
        requestAnimationFrame(tick);
        return;
      }

      // New episode / new source: the player often loads the next episode
      // without changing the URL, so contentKey() doesn't catch it. Detect the
      // media source changing and drop the previous episode's cues/tracks so we
      // never render stale subtitles from the last episode.
      // Amazon also changes currentSrc on ad boundaries, so only react once the
      // new source has stayed stable for a moment — otherwise ad breaks trigger
      // a reset storm ("infinite searching").
      const src = video.currentSrc || video.src || "";
      if (src && src === state.mediaSrc) {
        state.pendingSrc = ""; state.pendingSrcFrames = 0;
      } else if (src) {
        if (!state.mediaSrc) {
          state.mediaSrc = src;                    // first media, no reset
        } else if (src === state.pendingSrc) {
          if (++state.pendingSrcFrames >= 40) {    // stable ~40 frames
            state.pendingSrc = ""; state.pendingSrcFrames = 0;
            state.mediaSrc = src;
            onMediaChanged(src);
          }
        } else {
          state.pendingSrc = src; state.pendingSrcFrames = 0;
        }
      }

      let text = "";
      if (state.mode === "mirror") {
        text = mirrorVisibleCaptions();
      } else if (state.cues.length) {
        if (SITE.id === "prime" && state.loadedPrimeTitleId && state.primeTitleId && state.loadedPrimeTitleId !== state.primeTitleId) {
          state.cues = [];
          state.loaded = false;
          state.autoLoaded = false;
          state.loadedSrc = "";
          state.loadedPrimeTitleId = "";
          state.lastText = "";
          renderSubtitle("");
          maybeAutoLoad();
          requestAnimationFrame(tick);
          return;
        }
        const t = playbackTime(video);
        text = activeCueAt(t)?.text || "";
        prefetchUpcoming(t);

        // Safety net: if the player IS showing its own subtitles but our loaded
        // track never lines up (wrong timing/format), fall back to mirroring so
        // subtitles always appear.
        if (!text && !video.paused && mirrorVisibleCaptions()) {
          state.mismatchFrames = (state.mismatchFrames || 0) + 1;
          if (state.mismatchFrames > 120) {
            state.mismatchFrames = 0;
            setMode("mirror");
            setStatus("Loaded track didn't match the video — mirroring the player's subtitles instead.");
            text = mirrorVisibleCaptions();
          }
        } else {
          state.mismatchFrames = 0;
        }
      }

      renderSubtitle(text);
    } catch (e) {
      // Do not kill the page.
      console.debug("[KPDS] tick skipped", e);
    }

    requestAnimationFrame(tick);
  }

  function findTrackElements() {
    if (SITE.trackSource === "capture") {
      return state.capturedTracks.map((t, idx) => ({
        label: t.label || `Subtitles ${idx + 1}`,
        lang: t.lang || "",
        url: t.url,
        id: `cap-${idx}`
      }));
    }
    const video = getVideo();
    if (!video) return [];
    return [...video.querySelectorAll("track")].map((tr, idx) => ({
      label: tr.getAttribute("label") || `Track ${idx + 1}`,
      lang: tr.getAttribute("srclang") || "",
      url: tr.getAttribute("src") || "",
      id: tr.id || `track-${idx}`
    })).filter(t => t.url);
  }

  function refreshTrackList() {
    const select = document.getElementById("kpds-track-select");
    if (!select) return;
    const tracks = findTrackElements();

    select.innerHTML = "";
    for (const t of tracks) {
      const opt = document.createElement("option");
      opt.value = t.url;
      // t.label is already a clean human name; don't re-append the raw code.
      const display = t.label || langLabel(t.lang) || t.lang || "Subtitles";
      opt.textContent = display;
      opt.dataset.label = display;
      opt.dataset.lang = t.lang || "";
      select.appendChild(opt);
    }

    if (tracks.length) {
      state.selectedTrackUrl = select.value;
      state.selectedTrackLabel = select.selectedOptions[0]?.dataset?.label || "";
      if (!state.cues.length && !state.autoLoaded) {
        setStatus(`Found ${tracks.length} track${tracks.length > 1 ? "s" : ""} · loading…`);
      }
      maybeAutoLoad();
    } else if (SITE.trackSource === "capture") {
      setStatus("No tracks yet. Turn subtitles ON in the player once to capture them.");
    } else {
      setStatus("No site tracks found yet. Start playback or open subtitles once.");
    }
  }

  async function loadSelectedTrack() {
    const select = document.getElementById("kpds-track-select");
    // Fall back to the remembered url so auto-load works even if the panel
    // (and its <select>) was momentarily removed by the player's DOM churn.
    const url = (select && select.value) || state.selectedTrackUrl;
    if (!url) {
      setStatus("Choose a track first.");
      return;
    }

    setMode("site");
    state.selectedTrackUrl = url;
    state.selectedTrackLabel =
      (select && select.selectedOptions[0]?.dataset?.label) ||
      (select && select.selectedOptions[0]?.textContent) ||
      state.capturedTracks.find(t => t.url === url)?.label ||
      "subtitles";

    setStatus("Loading subtitle track…");
    const loadSeq = ++state.loadSeq;
    const primeTitleAtStart = state.primeTitleId;
    try {
      let cues;
      let trackLang = "";
      let capTrack = null;
      if (SITE.trackSource === "capture") {
        capTrack = state.capturedTracks.find(t => t.url === url);
        if (!capTrack) throw new Error("Track not captured yet");
        const currentSrc = (getVideo() && getVideo().currentSrc) || state.mediaSrc || "";
        const samePrimeMedia = capTrack.src && currentSrc && capTrack.src === currentSrc;
        if (SITE.id === "prime" && capTrack.primeTitleId && state.primeTitleId && capTrack.primeTitleId !== state.primeTitleId && !samePrimeMedia) {
          throw new Error("Track belongs to another Prime title");
        }
        if (capTrack.cues && capTrack.cues.length) {
          cues = capTrack.cues;
        } else if (capTrack.text) {
          cues = parseSubtitle(capTrack.text, 0);
          capTrack.cues = cues;
        } else {
          cues = await loadSubtitleUrl(capTrack.url);
          capTrack.cues = cues;
        }
        trackLang = capTrack.lang || "";
      } else {
        cues = await loadSubtitleUrl(url);
        trackLang = select?.selectedOptions[0]?.dataset?.lang || "";
      }
      if (loadSeq !== state.loadSeq || state.selectedTrackUrl !== url) return;
      if (SITE.id === "prime") {
        const capTitleId = capTrack?.primeTitleId || "";
        const currentSrc = (getVideo() && getVideo().currentSrc) || state.mediaSrc || "";
        const samePrimeMedia = capTrack?.src && currentSrc && capTrack.src === currentSrc;
        if (capTitleId && state.primeTitleId && capTitleId !== state.primeTitleId && !samePrimeMedia) return;
        if (!capTitleId && primeTitleAtStart && state.primeTitleId && primeTitleAtStart !== state.primeTitleId) return;
      }
      // Remember the track's language so saved words / the popup show the real
      // source even when "From" is Auto. (We don't force the From selector here
      // — doing that during load proved fragile.)
      state.trackLang = (trackLang || "").toLowerCase().split(/[-_]/)[0];
      state.cues = cues;
      state.loaded = true;
      state.mismatchFrames = 0;
      state.loadedSrc = capTrack?.src
        || (getVideo() && getVideo().currentSrc) || state.mediaSrc || "";
      state.loadedPrimeTitleId = capTrack?.primeTitleId || state.primeTitleId || "";
      const tip = state.dualTranslate ? "" : " · turn on “Show translation” for a second line";
      setStatus(`Showing ${state.selectedTrackLabel || "subtitles"} · ${cues.length} lines${tip}`);
    } catch (e) {
      state.lastError = `load: ${e.message || e}`;
      console.error("[KPDS] load track failed", e);
      setStatus(`Couldn't load subtitles: ${e.message || e}`);
    }
  }

  function normForMatch(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(new RegExp(KPDS_SEP_RE.source, "g"), " ")
      .replace(/['’‘]/g, "")
      .trim();
  }

  // Align the loaded track to whatever the player's own captions show on
  // screen: sample (visible text + video time), find the same line in our
  // cues, and take the median of (cueStart - currentTime) as the offset.
  async function autoSync() {
    if (state.syncing) return;
    if (!state.cues.length) { setStatus("Load a subtitle track first, then Auto-sync."); return; }

    const video = getVideo();
    if (!video) { setStatus("No video found for sync."); return; }

    const index = new Map();
    for (const c of state.cues) {
      const k = normForMatch(c.text);
      if (!k) continue;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(c.start);
    }
    if (!index.size) { setStatus("Loaded track has no usable text."); return; }

    state.syncing = true;
    setStatus("Auto-sync: turn the player's subtitles ON and wait…");

    const offsets = [];
    let lastKey = "";
    const startedAt = performance.now();

    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const t = playbackTime(video);
        const key = normForMatch(mirrorVisibleCaptions());

        if (key && key !== lastKey && key.length >= 3) {
          lastKey = key;
          const starts = index.get(key);
          if (starts && starts.length) {
            let best = starts[0];
            for (const s of starts) {
              if (Math.abs(s - t) < Math.abs(best - t)) best = s;
            }
            offsets.push(best - t);
            setStatus(`Auto-sync: matched ${offsets.length} line(s)…`);
          }
        }

        if (offsets.length >= 5 || performance.now() - startedAt > 15000) {
          clearInterval(iv);
          resolve();
        }
      }, 200);
    });

    state.syncing = false;

    if (!offsets.length) {
      setStatus("Auto-sync failed: no on-screen subtitles matched. Make sure the player's own subtitles are ON.");
      return;
    }

    offsets.sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)];
    state.offset = Math.round(median * 10) / 10;
    const offEl = $("#kpds-offset");
    if (offEl) offEl.value = state.offset;
    state.lastText = "";
    const sign = state.offset >= 0 ? "+" : "";
    setStatus(`Synced · offset ${sign}${state.offset}s (from ${offsets.length} lines).`);
  }

  function langLabel(code) {
    if (!code) return "";
    const names = {
      en: "English", de: "German", ru: "Russian", fr: "French", es: "Spanish",
      it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish", tr: "Turkish",
      ja: "Japanese", jp: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic",
      uk: "Ukrainian", cs: "Czech", sv: "Swedish", da: "Danish", fi: "Finnish",
      no: "Norwegian", nb: "Norwegian", nn: "Norwegian", ro: "Romanian",
      hu: "Hungarian", id: "Indonesian", ms: "Malay", eu: "Basque", gl: "Galician",
      ca: "Catalan", el: "Greek", he: "Hebrew", hi: "Hindi", th: "Thai",
      vi: "Vietnamese", bg: "Bulgarian", hr: "Croatian", sr: "Serbian",
      sk: "Slovak", sl: "Slovenian", et: "Estonian", lv: "Latvian", lt: "Lithuanian",
      fa: "Persian", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam",
      is: "Icelandic"
    };
    // Only these languages have meaningfully different regional variants worth showing.
    const showRegion = new Set(["pt", "en", "fr", "es", "zh"]);
    const parts = code.toLowerCase().split(/[-_]/);
    const base = parts[0];
    let region = parts[1] ? parts[1].toUpperCase() : "";
    const name = names[base];
    if (!name) return code; // unknown — show the raw code once, no duplication
    if (!showRegion.has(base) || /^\d/.test(region) || region === base.toUpperCase()) region = "";
    return region ? `${name} (${region})` : name;
  }

  function looksLikeThumbnails(cues) {
    const sample = cues.slice(0, 6);
    const imageish = sample.filter(c => /\.(jpe?g|png|webp)(\?|#|$)|#xywh=/i.test(c.text)).length;
    return imageish >= 2;
  }

  function normalizeTrackUrl(url) {
    try {
      const u = new URL(url, location.href);
      u.hash = "";
      return u.toString();
    } catch {
      return String(url || "");
    }
  }

  function addPrimeMetadataTrack(track, meta) {
    const url = normalizeTrackUrl(track?.url);
    if (!url) return false;

    const lang = String(track.lang || "").trim();
    const label = langLabel(lang) || String(track.label || "").trim() ||
      `Subtitles ${state.capturedTracks.length + 1}`;
    const src = meta.videoSrc || state.mediaSrc || ((getVideo() && getVideo().currentSrc) || "");
    const titleId = meta.titleId || "";

    const existing = state.capturedTracks.find(t =>
      normalizeTrackUrl(t.url) === url || (t.label === label && t.primeTitleId === titleId)
    );
    if (existing) {
      existing.label = label;
      existing.lang = lang || existing.lang || "";
      existing.src = src || existing.src || "";
      existing.primeTitleId = titleId || existing.primeTitleId || "";
      existing.source = existing.source || "prime-meta";
      return false;
    }

    state.capturedTracks.push({
      url,
      text: "",
      lang,
      label,
      cues: null,
      src,
      primeTitleId: titleId,
      source: "prime-meta"
    });
    return true;
  }

  function onPrimeMetadata(meta) {
    if (!meta || !Array.isArray(meta.tracks) || !meta.tracks.length) return;
    state.lastPrimeMetaAt = Date.now();
    const videoSrcChanged = meta.videoSrc && state.mediaSrc && meta.videoSrc !== state.mediaSrc;
    const titleChanged = meta.titleId && state.primeTitleId && meta.titleId !== state.primeTitleId;
    if (titleChanged || videoSrcChanged) {
      state.capturedTracks = [];
      state.loadedCache.clear();
      state.dualCache.clear();
      state.pending.clear();
      state.lastText = "";
      state.selectedTrackUrl = "";
      state.selectedTrackLabel = "";
      state.loaded = false;
      state.autoLoaded = false;
      state.trackLang = "";
      state.loadedSrc = "";
      state.loadedPrimeTitleId = "";
      state.loadSeq++;
      state.cues = [];
      renderSubtitle("");
    }

    if (meta.titleId) state.primeTitleId = meta.titleId;
    if (meta.videoSrc) state.mediaSrc = meta.videoSrc;
    if (meta.titleId) {
      state.capturedTracks = state.capturedTracks.filter(t => !t.primeTitleId || t.primeTitleId === meta.titleId);
    }

    let added = false;
    for (const t of meta.tracks) {
      if (addPrimeMetadataTrack(t, meta)) added = true;
    }
    if (added || titleChanged || videoSrcChanged) {
      refreshTrackList();
      if (!state.cues.length && state.mode !== "mirror" && state.mode !== "file") {
        maybeAutoLoad();
      }
      if (state.capturedTracks.length) {
        setStatus(`Found ${state.capturedTracks.length} Prime subtitle track${state.capturedTracks.length > 1 ? "s" : ""}.`);
      }
    }
  }

  function readPrimeMetadataSnapshots() {
    if (SITE.id !== "prime") return;
    const currentSrc = (getVideo() && getVideo().currentSrc) || state.mediaSrc || "";
    const metas = [];
    const nodes = $$("div.kpds-prime-meta");
    for (const node of nodes) {
      try {
        const meta = JSON.parse(node.getAttribute("data-kpds-meta") || "{}");
        if (meta && meta.titleId && Array.isArray(meta.tracks)) metas.push(meta);
      } catch (e) {}
    }
    if (!metas.length) return;
    const exact = currentSrc ? metas.filter(m => m.videoSrc === currentSrc) : [];
    const candidates = exact.length ? exact : metas.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-1);
    for (const meta of candidates) onPrimeMetadata(meta);
  }

  function onCapturedSub(url, text, lang) {
    if (!url || !text) return;
    const normalizedUrl = normalizeTrackUrl(url);
    const existingByUrl = state.capturedTracks.find(t => normalizeTrackUrl(t.url) === normalizedUrl);
    const currentPrimeTitleId = SITE.id === "prime" ? state.primeTitleId : "";
    const currentSrcForCapture = (getVideo() && getVideo().currentSrc) || state.mediaSrc || "";
    const samePrimeMedia = existingByUrl?.src && currentSrcForCapture && existingByUrl.src === currentSrcForCapture;
    if (currentPrimeTitleId && existingByUrl?.primeTitleId && existingByUrl.primeTitleId !== currentPrimeTitleId && !samePrimeMedia) return;

    let cues;
    try { cues = parseSubtitle(text, 0); } catch { cues = []; }

    // Drop trickplay/thumbnail VTT, forced/partial tracks and fragments.
    if (cues.length < 10 || looksLikeThumbnails(cues)) return;

    const label = langLabel(lang) || `Subtitles ${state.capturedTracks.length + 1}`;
    const src = currentSrcForCapture;

    if (existingByUrl) {
      if (existingByUrl.cues && existingByUrl.cues.length >= cues.length) return;
      existingByUrl.text = text;
      existingByUrl.lang = lang || existingByUrl.lang || "";
      existingByUrl.label = existingByUrl.label || label;
      existingByUrl.cues = cues;
      existingByUrl.src = src || existingByUrl.src || "";
      existingByUrl.primeTitleId = existingByUrl.primeTitleId || currentPrimeTitleId;
      refreshTrackList();
      return;
    }

    // Dedupe by display name. Within the SAME media (episode) keep the larger
    // track; a same-label track from a DIFFERENT source (the previous episode)
    // is replaced, so switching episodes never keeps the old subtitles.
    const idx = state.capturedTracks.findIndex(t => t.label === label);
    if (idx >= 0) {
      const ex = state.capturedTracks[idx];
      if (ex.src === src && (ex.cues?.length || 0) >= cues.length) return;
      state.capturedTracks.splice(idx, 1);
    }
    state.capturedTracks.push({ url, text, lang, label, cues, src, primeTitleId: currentPrimeTitleId });
    refreshTrackList();

    // Auto-show this track immediately (don't depend on the <select> value).
    if (!state.cues.length && state.mode !== "mirror" && state.mode !== "file") {
      state.autoLoaded = true;
      state.selectedTrackUrl = url;
      const sel = $("#kpds-track-select");
      if (sel) sel.value = url;
      loadSelectedTrack();
    }
  }

  // Show subtitles automatically once a track is available, so the user
  // never has to hunt for the "Show" button. They can still switch tracks.
  function maybeAutoLoad() {
    if (state.autoLoaded || state.cues.length) return;
    if (state.mode === "mirror" || state.mode === "file") return;
    const sel = $("#kpds-track-select");
    if (sel && sel.value) {
      state.autoLoaded = true;
      loadSelectedTrack();
    }
  }

  function injectPageHookViaTag() {
    // Fallback: inject the hook via a <script> tag (works only if the page
    // CSP allows extension resource scripts).
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("inject.js");
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.debug("[KPDS] page hook inject failed", e);
    }
  }

  function requestHookInjection() {
    // Primary: ask the service worker to inject into the MAIN world. This is
    // not subject to the page CSP. Fall back to a <script> tag if it fails.
    sendMessage({ type: "injectHook" })
      .then((r) => { if (!r?.ok) injectPageHookViaTag(); })
      .catch(() => injectPageHookViaTag());
  }

  function installSubtitleCapture() {
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.__kpds !== true) return;
      if (d.type === "sub") {
        onCapturedSub(d.url, d.text, d.lang || "");
      } else if (d.type === "prime-meta") {
        onPrimeMetadata(d);
      } else if (d.type === "prime-time") {
        const time = Number(d.time);
        if (Number.isFinite(time) && time >= 0) {
          state.primePlayerTime = time;
          state.primePlayerTimeAt = Date.now();
        }
      } else if (d.type === "dbg") {
        console.debug("[KPDS inject]", d.msg);
        if (/hooks installed/.test(d.msg) && !state.capturedTracks.length) {
          setStatus("Listening for subtitles… turn them ON in the player.");
        }
      }
    });
    requestHookInjection();
    if (SITE.id === "prime") {
      readPrimeMetadataSnapshots();
      setInterval(readPrimeMetadataSnapshots, 1000);
    }
  }

  async function loadFile(file) {
    if (!file) return;
    const text = await file.text();
    setMode("file");
    state.cues = parseSubtitle(text, 0).sort((a, b) => a.start - b.start);
    setStatus(`Loaded ${state.cues.length} cues from file.`);
  }

  async function translateWord(word, x, y) {
    const popup = ensurePopup();
    state.currentPopupPayload = null;

    popup.style.left = Math.min(Math.max(12, x), window.innerWidth - 360) + "px";
    popup.style.top = Math.min(Math.max(12, y - 90), window.innerHeight - 170) + "px";
    popup.classList.remove("kpds-hidden");
    popup.innerHTML = `
      <div class="kpds-popup-word">${escapeHtml(word)}</div>
      <div class="kpds-skeleton"></div>
      <div class="kpds-popup-translation loading">Translating…</div>
      <div class="kpds-popup-actions">
        <button type="button" class="kpds-popup-btn" data-kpds-action="open-vocabulary">${ICONS.book}Book</button>
        <button type="button" class="kpds-popup-btn" data-kpds-action="close-popup">Close</button>
      </div>
    `;

    const resp = await translateText(word);

    if (!resp?.ok) {
      if (resp?.contextInvalidated) {
        setStatus("Extension was updated. Reload this page once to reconnect translation.");
      }
      popup.innerHTML = `
        <div class="kpds-popup-word">${escapeHtml(word)}</div>
        <div class="kpds-popup-translation error">${resp?.contextInvalidated ? "Reload this page once." : "Couldn't translate this word."}</div>
        <div class="kpds-popup-meta">${escapeHtml(resp?.error || "Unknown error")}</div>
        <div class="kpds-popup-actions">
          <button type="button" class="kpds-popup-btn" data-kpds-action="open-vocabulary">${ICONS.book}Book</button>
          <button type="button" class="kpds-popup-btn" data-kpds-action="close-popup">Close</button>
        </div>
      `;
      return;
    }

    // Resolve the source language: explicit choice, else what the translator
    // detected, else the loaded track's language.
    const resolvedSource = state.sourceLang !== "auto"
      ? state.sourceLang
      : ((resp.detected || state.trackLang || "").toLowerCase().split(/[-_]/)[0] || "auto");

    const item = {
      word,
      translation: resp.translatedText,
      sourceLang: resolvedSource,
      targetLang: state.targetLang,
      provider: resp.provider || "",
      context: state.lastText || "",
      addedAt: new Date().toISOString()
    };
    state.currentPopupPayload = item;

    const altsHtml = Array.isArray(resp.alternatives) && resp.alternatives.length
      ? `<div class="kpds-popup-alts">${resp.alternatives.map(a => escapeHtml(a)).join("<br>")}</div>`
      : "";

    const srcLabel = langLabel(resolvedSource) || resolvedSource;
    const tgtLabel = langLabel(state.targetLang) || state.targetLang;
    popup.innerHTML = `
      <div class="kpds-popup-word">${escapeHtml(word)}</div>
      <div class="kpds-popup-translation">${escapeHtml(resp.translatedText)}</div>
      ${altsHtml}
      <div class="kpds-popup-meta">${escapeHtml(srcLabel)} → ${escapeHtml(tgtLabel)} · ${escapeHtml(cleanProvider(resp.provider))}</div>
      <div class="kpds-popup-actions three">
        <button type="button" class="kpds-popup-btn success" data-kpds-action="save-word">${ICONS.plus}Save</button>
        <button type="button" class="kpds-popup-btn" data-kpds-action="open-vocabulary">${ICONS.book}</button>
        <button type="button" class="kpds-popup-btn icon-only" data-kpds-action="close-popup" title="Close">${ICONS.close}</button>
      </div>
    `;
  }

  function cleanProvider(provider) {
    if (!provider) return "auto";
    if (provider === "MyMemory") return "MyMemory";
    try { return new URL(provider).hostname.replace(/^www\./, ""); } catch { return provider; }
  }

  async function saveCurrentWord() {
    const item = state.currentPopupPayload;
    if (!item) return;

    const key = "kpdsVocabulary";
    const data = await chrome.storage.local.get(key);
    const list = Array.isArray(data[key]) ? data[key] : [];

    const exists = list.some(x =>
      x.word?.toLowerCase() === item.word.toLowerCase() &&
      x.targetLang === item.targetLang
    );

    if (!exists) list.unshift(item);
    await chrome.storage.local.set({ [key]: list });

    const popup = ensurePopup();
    const meta = popup.querySelector(".kpds-popup-meta");
    if (meta) {
      meta.textContent = exists ? "Already in your vocabulary" : "Saved to vocabulary";
      meta.classList.add("saved");
    }
    const saveBtn = popup.querySelector('[data-kpds-action="save-word"]');
    if (saveBtn) { saveBtn.innerHTML = "Saved"; saveBtn.disabled = true; saveBtn.style.opacity = "0.7"; }
  }

  async function openVocabulary() {
    const resp = await sendMessage({ type: "openVocabulary" });
    if (!resp?.ok) {
      setStatus(`Could not open vocabulary: ${resp?.error || "unknown error"}`);
      console.error("[KPDS] open vocabulary failed", resp);
    }
  }

  function buildBugReport() {
    let version = "?";
    try { version = chrome.runtime.getManifest().version; } catch {}
    const tracks = state.capturedTracks
      .map(t => `${t.label}(${(t.cues && t.cues.length) || 0})`).join(", ") || "none";
    const v = getVideo();
    const c0 = state.cues[0];
    const cN = state.cues[state.cues.length - 1];
    const fmt = (n) => (typeof n === "number" ? n.toFixed(1) : "?");
    const currentTime = v ? playbackTime(v) : 0;
    const timing = c0
      ? `first ${fmt(c0.start)}-${fmt(c0.end)}s, last ${fmt(cN.start)}s, offset ${state.offset}, videoTime ${fmt(currentTime)}`
      : "no cues";
    return [
      "Dual Subtitles — bug report",
      `Version: ${version}`,
      `Page: ${location.host}${location.pathname}`,
      `Site: ${SITE.id} · Mode: ${state.mode}`,
      `Tracks: ${state.capturedTracks.length} [${tracks}]`,
      `Loaded: ${state.selectedTrackLabel || "-"} · ${state.cues.length} lines · trackLang ${state.trackLang || "-"}`,
      `Timing: ${timing}`,
      `From: ${state.sourceLang} · To: ${state.targetLang} · Translator: ${state.provider} · Dual: ${state.dualTranslate}`,
      `Last error: ${state.lastError || "none"}`,
      `Browser: ${navigator.userAgent}`,
      "",
      "What went wrong (please describe):",
      ""
    ].join("\n");
  }

  async function reportBug() {
    const report = buildBugReport();
    try {
      await navigator.clipboard.writeText(report);
      setStatus("Bug report copied to clipboard — paste it into a message or issue.");
    } catch (e) {
      console.log("[KPDS] bug report:\n" + report);
      setStatus("Couldn't copy — open the console (F12) and copy the report from there.");
    }
  }

  const ICONS = {
    logo: `<svg class="kpds-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M6 16h5M14 16h4"/><path d="M6 12h2"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    minimize: `<svg class="kpds-min-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line class="bar-1" x1="5" y1="12" x2="19" y2="12"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`,
    eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A11 11 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 12s3 8 10 8a11 11 0 0 0 5.4-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    sync: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9c-2.5 0-4.8-1-6.4-2.7M3 12a9 9 0 0 1 9-9c2.5 0 4.8 1 6.4 2.7"/><polyline points="3 4 3 9 8 9"/><polyline points="21 20 21 15 16 15"/></svg>`,
    bug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 7l-3 2M5 7l3 2M19 13h-3M8 13H5M19 19l-3-2M5 19l3-2M12 3v3"/></svg>`
  };

  function createPanel() {
    if (document.getElementById("kpds-panel")) return;

    const panel = document.createElement("div");
    panel.id = "kpds-panel";
    panel.innerHTML = `
      <div class="kpds-header" id="kpds-drag">
        <div class="kpds-title-wrap">
          ${ICONS.logo}
          <div class="kpds-title">Dual Subtitles</div>
        </div>
        <div class="kpds-header-actions">
          <button type="button" class="kpds-icon-btn" data-kpds-action="open-vocabulary" title="Open vocabulary">${ICONS.book}</button>
          <button type="button" class="kpds-icon-btn" data-kpds-action="minimize" title="Collapse">${ICONS.minimize}</button>
        </div>
      </div>
      <div class="kpds-body">

        <div class="kpds-guide" id="kpds-status">Ready.</div>

        <div class="kpds-section">
          <span class="kpds-section-label"><span class="kpds-step">1</span>Subtitles</span>
          <div class="kpds-row kpds-inline">
            <select id="kpds-track-select"></select>
            <button type="button" class="kpds-icon-btn bordered" data-kpds-action="refresh-tracks" title="Reload subtitles (re-detect, or mirror the player's own)">${ICONS.refresh}</button>
          </div>
          <div class="kpds-grid2 kpds-row">
            <button type="button" class="kpds-btn" data-kpds-action="load-track">${ICONS.download}Show subtitles</button>
            <button type="button" class="kpds-btn ghost" data-kpds-action="mirror" title="Read the subtitles the player already shows and make them clickable">Replace player subs</button>
          </div>
          <div class="kpds-disclosure" id="kpds-more-src">
            <button type="button" class="kpds-disclosure-btn" data-kpds-action="toggle-src">${ICONS.chevron}Load a file instead</button>
            <div class="kpds-disclosure-content">
              <label class="kpds-file-label" for="kpds-file">
                ${ICONS.file}<span class="kpds-file-name" id="kpds-file-name">Choose .srt / .vtt…</span>
              </label>
              <input type="file" id="kpds-file" accept=".srt,.vtt,text/plain">
            </div>
          </div>
        </div>

        <div class="kpds-section">
          <span class="kpds-section-label"><span class="kpds-step">2</span>Translation</span>
          <label class="kpds-switch-row kpds-row kpds-emphasis">
            <span>Show translation under subtitles</span>
            <span class="kpds-switch">
              <input type="checkbox" id="kpds-dual">
              <span class="track"></span><span class="thumb"></span>
            </span>
          </label>
          <div class="kpds-grid2 kpds-row">
            <div>
              <label class="kpds-field-label">From</label>
              <select id="kpds-source">
                <option value="auto">Auto-detect</option>
                ${langOptions()}
              </select>
            </div>
            <div>
              <label class="kpds-field-label">To</label>
              <select id="kpds-target">
                ${langOptions("ru")}
              </select>
            </div>
          </div>
          <div class="kpds-row">
            <label class="kpds-field-label">Translator</label>
            <select id="kpds-provider">
              <option value="auto">Auto (Chrome, private)</option>
              <option value="chrome">Chrome built-in (free)</option>
              <option value="online">Free online fallback</option>
              <option value="deepl">DeepL (API key)</option>
              <option value="libre">LibreTranslate</option>
              <option value="mymemory">MyMemory</option>
            </select>
          </div>
          <div class="kpds-disclosure" id="kpds-advanced">
            <button type="button" class="kpds-disclosure-btn" data-kpds-action="toggle-advanced">
              ${ICONS.chevron}Translator keys / servers
            </button>
            <div class="kpds-disclosure-content">
              <label class="kpds-field-label">DeepL API key</label>
              <input type="text" id="kpds-deepl" placeholder="xxxxxxxx:fx (free plan)">
              <label class="kpds-field-label" style="margin-top:9px">Custom LibreTranslate URL</label>
              <input type="text" id="kpds-endpoint" placeholder="Leave empty for built-in fallbacks">
            </div>
          </div>
        </div>

        <div class="kpds-section">
          <div class="kpds-disclosure" id="kpds-display">
            <button type="button" class="kpds-disclosure-btn" data-kpds-action="toggle-display">
              ${ICONS.chevron}Display &amp; timing
            </button>
            <div class="kpds-disclosure-content">
              <button type="button" class="kpds-btn secondary kpds-row" data-kpds-action="auto-sync">${ICONS.sync}Auto-sync to screen</button>
              <div class="kpds-grid3 kpds-row">
                <div class="kpds-stepper">
                  <label class="kpds-field-label">Offset s</label>
                  <input type="number" id="kpds-offset" value="0" step="0.1">
                </div>
                <div class="kpds-stepper">
                  <label class="kpds-field-label">Size px</label>
                  <input type="number" id="kpds-size" value="28" min="12" max="64">
                </div>
                <div class="kpds-stepper">
                  <label class="kpds-field-label">Bottom %</label>
                  <input type="number" id="kpds-bottom" value="11" min="1" max="40">
                </div>
              </div>
              <label class="kpds-switch-row kpds-row">
                <span>Tap words to translate</span>
                <span class="kpds-switch">
                  <input type="checkbox" id="kpds-clickable" checked>
                  <span class="track"></span><span class="thumb"></span>
                </span>
              </label>
            </div>
          </div>
          <div class="kpds-grid2 kpds-row">
            <button type="button" class="kpds-btn secondary" data-kpds-action="open-vocabulary">${ICONS.book}Vocabulary</button>
            <button type="button" class="kpds-btn danger" data-kpds-action="hide-panel" title="Hide the control panel. Subtitles stay visible.">${ICONS.eyeOff}Hide panel</button>
          </div>
          <button type="button" class="kpds-btn ghost kpds-row" data-kpds-action="report-bug">${ICONS.bug}Report a bug</button>
        </div>
      </div>
    `;

    getFullscreenRoot().appendChild(panel);

    // Inputs
    $("#kpds-track-select")?.addEventListener("change", (e) => {
      state.selectedTrackUrl = e.target.value;
      state.selectedTrackLabel = e.target.selectedOptions[0]?.dataset?.label || "";
      // Picking a language shows it right away — no extra click needed.
      loadSelectedTrack();
    });
    $("#kpds-file").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      const nameEl = $("#kpds-file-name");
      if (nameEl) nameEl.textContent = file ? file.name : "Choose .srt or .vtt…";
      loadFile(file);
    });
    $("#kpds-offset").addEventListener("input", (e) => { state.offset = Number(e.target.value || 0); saveSettingsSoon(); });
    $("#kpds-size").addEventListener("input", (e) => { state.size = Number(e.target.value || 28); ensureOverlay(); saveSettingsSoon(); });
    $("#kpds-bottom").addEventListener("input", (e) => { state.bottom = Number(e.target.value || 11); ensureOverlay(); saveSettingsSoon(); });
    $("#kpds-source").addEventListener("change", (e) => { state.sourceLang = e.target.value; resetTranslations(); saveSettingsSoon(); });
    $("#kpds-target").addEventListener("change", (e) => { state.targetLang = e.target.value; resetTranslations(); saveSettingsSoon(); });
    $("#kpds-endpoint").addEventListener("input", (e) => { state.endpoint = e.target.value.trim(); saveSettingsSoon(); });
    $("#kpds-provider")?.addEventListener("change", (e) => { state.provider = e.target.value; resetTranslations(); saveSettingsSoon(); });
    $("#kpds-deepl")?.addEventListener("input", (e) => { state.deeplKey = e.target.value.trim(); resetTranslations(); saveSettingsSoon(); });
    $("#kpds-clickable").addEventListener("change", (e) => {
      state.clickable = !!e.target.checked;
      state.lastText = "";
      saveSettingsSoon();
    });
    $("#kpds-dual")?.addEventListener("change", (e) => {
      state.dualTranslate = !!e.target.checked;
      state.lastText = "";
      saveSettingsSoon();
    });

    refreshTrackList();
    makePanelDraggable(panel);
    syncPanelInputs();
  }

  function syncPanelInputs() {
    const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
    const check = (sel, val) => { const el = $(sel); if (el) el.checked = !!val; };
    set("#kpds-source", state.sourceLang);
    set("#kpds-target", state.targetLang);
    set("#kpds-provider", state.provider);
    set("#kpds-deepl", state.deeplKey);
    set("#kpds-endpoint", state.endpoint);
    set("#kpds-offset", state.offset);
    set("#kpds-size", state.size);
    set("#kpds-bottom", state.bottom);
    check("#kpds-clickable", state.clickable);
    check("#kpds-dual", state.dualTranslate);
  }

  // Prime Video is a SPA and rewrites the DOM on navigation, which can remove
  // our panel. Recreate it if it's gone and keep it attached to the active
  // (possibly fullscreen) root — same self-healing the overlay already has.
  function ensurePanel() {
    let panel = document.getElementById("kpds-panel");
    if (!panel) {
      createPanel();
      panel = document.getElementById("kpds-panel");
    }
    const root = getFullscreenRoot();
    if (panel && panel.parentNode !== root) root.appendChild(panel);
    applyPanelHidden();
  }

  const drag = { active: false, panel: null, sx: 0, sy: 0, ox: 0, oy: 0, installed: false };

  function makePanelDraggable(panel) {
    const handle = panel.querySelector("#kpds-drag");
    if (!handle) return;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      drag.active = true;
      drag.panel = panel;
      drag.sx = e.clientX;
      drag.sy = e.clientY;
      const rect = panel.getBoundingClientRect();
      drag.ox = rect.left;
      drag.oy = rect.top;
      panel.style.left = `${drag.ox}px`;
      panel.style.top = `${drag.oy}px`;
      panel.style.right = "auto";
      e.preventDefault();
    });

    // Document-level listeners installed only once, shared across recreations.
    if (!drag.installed) {
      drag.installed = true;
      document.addEventListener("mousemove", (e) => {
        if (!drag.active || !drag.panel) return;
        drag.panel.style.left = `${Math.max(4, drag.ox + e.clientX - drag.sx)}px`;
        drag.panel.style.top = `${Math.max(4, drag.oy + e.clientY - drag.sy)}px`;
      });
      document.addEventListener("mouseup", () => { drag.active = false; });
    }
  }

  function installGlobalClickHandler() {
    document.addEventListener("click", async (e) => {
      const actionEl = e.target.closest("[data-kpds-action]");
      if (actionEl) {
        const action = actionEl.dataset.kpdsAction;
        e.preventDefault();
        e.stopPropagation();

        if (action === "refresh-tracks") {
          reloadSubtitles();
        }
        else if (action === "load-track") await loadSelectedTrack();
        else if (action === "mirror") { setMode("mirror"); setStatus(`Mirroring ${SITE.name} captions. Tap a word to translate.`); }
        else if (action === "auto-sync") await autoSync();
        else if (action === "minimize") $("#kpds-panel")?.classList.toggle("kpds-minimized");
        else if (action === "toggle-advanced") $("#kpds-advanced")?.classList.toggle("open");
        else if (action === "toggle-src") $("#kpds-more-src")?.classList.toggle("open");
        else if (action === "toggle-display") $("#kpds-display")?.classList.toggle("open");
        else if (action === "hide-overlay") { state.cues = []; setMode("off"); renderSubtitle(""); setStatus("Subtitles hidden."); }
        else if (action === "hide-panel") setPanelHidden(true);
        else if (action === "close-popup") hidePopup();
        else if (action === "save-word") await saveCurrentWord();
        else if (action === "open-vocabulary") await openVocabulary();
        else if (action === "report-bug") await reportBug();
        return;
      }

      const wordEl = e.target.closest("#kpds-overlay .kpds-word");
      if (wordEl) {
        e.preventDefault();
        e.stopPropagation();
        const word = stripWord(wordEl.dataset.word || wordEl.textContent);
        if (word) await translateWord(word, e.clientX, e.clientY);
      }
    }, true);
  }

  function observeFullscreenChanges() {
    const move = () => {
      ensureOverlay();
      ensurePopup();
      // Fullscreen shows only the fullscreen element's subtree, so move the
      // control panel inside it too — otherwise it vanishes in fullscreen.
      const panel = document.getElementById("kpds-panel");
      const root = getFullscreenRoot();
      if (panel && panel.parentNode !== root) root.appendChild(panel);
      applyPanelHidden();
    };
    document.addEventListener("fullscreenchange", move);
    document.addEventListener("webkitfullscreenchange", move);
  }

  async function restoreSettings() {
    try {
      const data = await chrome.storage.local.get("kpdsSettings");
      const s = data.kpdsSettings || {};
      const savedProvider = (s.provider === "google" || s.provider === "lingva")
        ? "auto"
        : s.provider;
      Object.assign(state, {
        sourceLang: s.sourceLang || state.sourceLang,
        targetLang: s.targetLang || state.targetLang,
        provider: savedProvider || state.provider,
        deeplKey: s.deeplKey || state.deeplKey,
        endpoint: s.endpoint || state.endpoint,
        offset: Number.isFinite(Number(s.offset)) ? Number(s.offset) : state.offset,
        size: Number.isFinite(Number(s.size)) ? Number(s.size) : state.size,
        bottom: Number.isFinite(Number(s.bottom)) ? Number(s.bottom) : state.bottom,
        clickable: typeof s.clickable === "boolean" ? s.clickable : state.clickable,
        dualTranslate: typeof s.dualTranslate === "boolean" ? s.dualTranslate : state.dualTranslate,
        panelHidden: typeof s.panelHidden === "boolean" ? s.panelHidden : state.panelHidden
      });
    } catch {}
  }

  function persistSettingsPeriodically() {
    setInterval(() => { saveSettings(); }, 2000);
    window.addEventListener("pagehide", () => { saveSettings(); });
    window.addEventListener("beforeunload", () => { saveSettings(); });
  }

  function installRuntimeMessageHandler() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "togglePanel") {
        setPanelHidden(!state.panelHidden);
        sendResponse({ ok: true, hidden: state.panelHidden });
        return true;
      }
      if (msg?.type === "showPanel") {
        setPanelHidden(false);
        sendResponse({ ok: true, hidden: state.panelHidden });
        return true;
      }
      return false;
    });
  }

  async function init() {
    // We match all of amazon.* (the matcher can't reliably target the video
    // path across locale prefixes and SPA navigation), so just initialise
    // everywhere. On non-video pages the panel simply sits idle.
    await restoreSettings();
    createPanel();
    applyPanelHidden();

    setMode(SITE.defaultMode);
    ensureOverlay();
    ensurePopup();
    installGlobalClickHandler();
    installRuntimeMessageHandler();
    observeFullscreenChanges();
    persistSettingsPeriodically();

    if (SITE.trackSource === "capture") {
      installSubtitleCapture();
      setStatus(`${SITE.name} detected. Turn on the player's own subtitles — they become clickable with a translation.`);
    }
    if (SITE.trackSource === "dom") {
      setTimeout(refreshTrackList, 1000);
      setTimeout(refreshTrackList, 3000);
    }
    requestAnimationFrame(tick);
  }

  init().catch(e => console.error("[KPDS] init failed", e));
})();

const KEY = "kpdsVocabulary";
let allItems = [];

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

async function load() {
  const data = await chrome.storage.local.get(KEY);
  allItems = Array.isArray(data[KEY]) ? data[KEY] : [];
  render();
}

async function save(items) {
  allItems = items;
  await chrome.storage.local.set({ [KEY]: allItems });
  render();
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(items) {
  const rows = [["word", "translation", "sourceLang", "targetLang", "provider", "context", "addedAt"]];
  for (const x of items) {
    rows.push([x.word, x.translation, x.sourceLang, x.targetLang, x.provider, x.context, x.addedAt]);
  }
  return rows.map(row => row.map(cell => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function filteredItems() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const tgt = document.getElementById("targetFilter").value;
  const src = document.getElementById("sourceFilter").value;

  return allItems.filter(x => {
    if (tgt && x.targetLang !== tgt) return false;
    if (src && (x.sourceLang || "auto") !== src) return false;
    if (!q) return true;
    return [x.word, x.translation, x.context, x.provider]
      .some(v => String(v || "").toLowerCase().includes(q));
  });
}

function fillFilter(sel, langs, allLabel) {
  const current = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    langs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(langName(l))}</option>`).join("");
  sel.value = current;
}

function renderFilters() {
  const targets = [...new Set(allItems.map(x => x.targetLang).filter(Boolean))].sort();
  const sources = [...new Set(allItems.map(x => x.sourceLang || "auto").filter(Boolean))].sort();
  fillFilter(document.getElementById("targetFilter"), targets, "All target languages");
  fillFilter(document.getElementById("sourceFilter"), sources, "All source languages");
}

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

function langName(code) {
  if (!code || code === "auto") return "Auto";
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
  const base = String(code).toLowerCase().split(/[-_]/)[0];
  return names[base] || code;
}

function cleanProvider(provider) {
  if (!provider || provider === "MyMemory") return provider || "";
  try { return new URL(provider).hostname.replace(/^www\./, ""); } catch { return provider; }
}

function fmtDate(value) {
  const d = new Date(value || Date.now());
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function render() {
  renderFilters();

  const items = filteredItems();
  const q = document.getElementById("search").value.trim();
  document.getElementById("stats").innerHTML = `
    <span class="stat-chip"><b>${allItems.length}</b> saved</span>
    ${q || items.length !== allItems.length ? `<span class="stat-chip"><b>${items.length}</b> shown</span>` : ""}
  `;

  const list = document.getElementById("list");
  if (!items.length) {
    const empty = allItems.length
      ? { title: "No matches", text: "Try a different search or language filter." }
      : { title: "No words yet", text: "Click a word in the subtitles, then press Save." };
    list.innerHTML = `
      <div class="empty">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>
        <div class="empty-title">${escapeHtml(empty.title)}</div>
        <div>${escapeHtml(empty.text)}</div>
      </div>`;
    return;
  }

  list.innerHTML = items.map((x) => {
    const index = allItems.indexOf(x);
    return `
      <article class="card">
        <div class="card-top">
          <div>
            <div class="word">${escapeHtml(x.word)}</div>
            <div class="translation">${escapeHtml(x.translation)}</div>
          </div>
          <button class="del" data-delete="${index}" title="Delete" aria-label="Delete ${escapeHtml(x.word)}">${TRASH_ICON}</button>
        </div>
        <div class="meta">
          <span class="tag lang">${escapeHtml(langName(x.sourceLang))} → ${escapeHtml(langName(x.targetLang))}</span>
          ${x.provider ? `<span class="tag">${escapeHtml(cleanProvider(x.provider))}</span>` : ""}
          <span class="tag date">${escapeHtml(fmtDate(x.addedAt))}</span>
        </div>
        ${x.context ? `<div class="context">${escapeHtml(x.context)}</div>` : ""}
      </article>
    `;
  }).join("");
}

document.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-delete]");
  if (del) {
    const idx = Number(del.dataset.delete);
    const next = allItems.slice();
    next.splice(idx, 1);
    await save(next);
  }
});

document.getElementById("search").addEventListener("input", render);
document.getElementById("targetFilter").addEventListener("change", render);
document.getElementById("sourceFilter").addEventListener("change", render);

document.getElementById("exportCsv").addEventListener("click", () => {
  download("kpds-vocabulary.csv", toCsv(allItems), "text/csv;charset=utf-8");
});

document.getElementById("exportJson").addEventListener("click", () => {
  download("kpds-vocabulary.json", JSON.stringify(allItems, null, 2), "application/json;charset=utf-8");
});

document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("Clear all saved words?")) return;
  await save([]);
});

load().catch(err => {
  document.getElementById("list").innerHTML = `<div class="empty">Failed to load vocabulary: ${escapeHtml(err.message || err)}</div>`;
});

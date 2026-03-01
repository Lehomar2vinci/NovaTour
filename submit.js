const API_URL ="https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";
const COUNTRY_TSV_URL = "https://unpkg.com/world-atlas@1.1.4/world/110m.tsv";
const CLIENT_COOLDOWN_MS = 800;

// ========= DOM =========
const pseudoEl = document.getElementById("pseudo");
const qEl = document.getElementById("q");
const selectEl = document.getElementById("countrySelect");
const statusEl = document.getElementById("status");
const addBtn = document.getElementById("addBtn");
const removeBtn = document.getElementById("removeBtn");
const pinBtn = document.getElementById("pinBtn");
const pinLabelEl = document.getElementById("pinLabel");

// ========= STATE =========
let allCountries = [];
let filteredCountries = [];
let lastClientSendTs = 0;

function setStatus(msg, kind = "") {
  statusEl.className = kind ? `status ${kind}` : "status";
  statusEl.textContent = msg;
}

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
    }

    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("JSONP load error")); };

    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;
    document.head.appendChild(script);
  });
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * TSV has many columns; we use:
 *  - name
 *  - iso_n3 (numeric id)
 *  - iso_a2 (optional display)
 */
function parseTSV(tsvText) {
  const lines = tsvText.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split("\t").map(h => h.trim().toLowerCase());

  const idxName = header.indexOf("name");
  const idxIsoN3 = header.indexOf("iso_n3");
  const idxIsoA2 = header.indexOf("iso_a2");

  if (idxName < 0 || idxIsoN3 < 0) {
    throw new Error("TSV invalide: colonnes name/iso_n3 introuvables");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const name = (cols[idxName] || "").trim();
    const isoN3 = (cols[idxIsoN3] || "").trim();
    const iso2 = idxIsoA2 >= 0 ? (cols[idxIsoA2] || "").trim().toUpperCase() : "";

    if (!name) continue;
    if (!isoN3 || !/^\d{1,4}$/.test(isoN3)) continue;

    rows.push({ id: isoN3, name, iso2 });
  }

  const seen = new Set();
  const uniq = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }

  uniq.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  return uniq;
}

function renderSelect(list) {
  selectEl.innerHTML = "";
  for (const c of list) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.iso2 ? `${c.name} (${c.iso2}, ${c.id})` : `${c.name} (${c.id})`;
    selectEl.appendChild(opt);
  }
  if (selectEl.options.length > 0) selectEl.selectedIndex = 0;
}

function applyFilter() {
  const q = (qEl.value || "").trim().toLowerCase();
  if (!q) filteredCountries = allCountries.slice(0, 250);
  else {
    filteredCountries = allCountries
      .filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.id.includes(q) ||
        (c.iso2 || "").toLowerCase().includes(q)
      )
      .slice(0, 250);
  }
  renderSelect(filteredCountries);
}

function getSelectedCountryId() {
  return (selectEl.value || "").trim();
}

function canSendNow() {
  const now = Date.now();
  if (now - lastClientSendTs < CLIENT_COOLDOWN_MS) return false;
  lastClientSendTs = now;
  return true;
}

async function sendVisited(action) {
  if (!canSendNow()) {
    setStatus("Trop rapide 🙂 attends un instant.", "err");
    return;
  }

  const pseudo = normalizePseudo(pseudoEl.value);
  if (!isValidPseudo(pseudo)) {
    setStatus("Pseudo invalide (3–25, lettres/chiffres/_).", "err");
    return;
  }

  const countryId = getSelectedCountryId();
  if (!/^\d{1,4}$/.test(countryId)) {
    setStatus("Choisis un pays dans la liste.", "err");
    return;
  }

  setStatus("Envoi…");

  const url = `${API_URL}?route=updateGet`
    + `&pseudo=${encodeURIComponent(pseudo)}`
    + `&countryId=${encodeURIComponent(countryId)}`
    + `&action=${encodeURIComponent(action)}`;

  try {
    const data = await jsonp(url);
    if (!data.ok) {
      if (data.error === "RATE_LIMIT") setStatus(`Rate-limit 🙂 réessaie dans ${data.retryAfterSec || 1}s.`, "err");
      else if (data.error === "LOCKED") setStatus("Contributions fermées (LOCK).", "err");
      else if (data.error === "BANNED") setStatus("Pseudo bloqué.", "err");
      else setStatus(`Erreur: ${data.error || "UNKNOWN"}`, "err");
      return;
    }
    setStatus(action === "add" ? "Ajouté ✅" : "Retiré ✅", "ok");
  } catch (e) {
    console.error(e);
    setStatus("Erreur réseau (JSONP).", "err");
  }
}

async function addPin() {
  if (!canSendNow()) {
    setStatus("Trop rapide 🙂 attends un instant.", "err");
    return;
  }

  const pseudo = normalizePseudo(pseudoEl.value);
  if (!isValidPseudo(pseudo)) {
    setStatus("Pseudo invalide (3–25, lettres/chiffres/_).", "err");
    return;
  }

  const countryId = getSelectedCountryId();
  if (!/^\d{1,4}$/.test(countryId)) {
    setStatus("Choisis un pays dans la liste.", "err");
    return;
  }

  const label = (pinLabelEl.value || "").trim().slice(0, 40);

  setStatus("Ajout du pin…");

  const url = `${API_URL}?route=pinAddGet`
    + `&pseudo=${encodeURIComponent(pseudo)}`
    + `&countryId=${encodeURIComponent(countryId)}`
    + `&label=${encodeURIComponent(label)}`;

  try {
    const data = await jsonp(url);
    if (!data.ok) {
      if (data.error === "RATE_LIMIT") setStatus(`Rate-limit 🙂 réessaie dans ${data.retryAfterSec || 1}s.`, "err");
      else if (data.error === "LOCKED") setStatus("Pins fermés (LOCK).", "err");
      else if (data.error === "BANNED") setStatus("Pseudo bloqué.", "err");
      else setStatus(`Erreur pin: ${data.error || "UNKNOWN"}`, "err");
      return;
    }
    setStatus("Pin ajouté 📍", "ok");
  } catch (e) {
    console.error(e);
    setStatus("Erreur réseau (pin JSONP).", "err");
  }
}

// Events
qEl.addEventListener("input", applyFilter);
addBtn.addEventListener("click", () => sendVisited("add"));
removeBtn.addEventListener("click", () => sendVisited("remove"));
pinBtn.addEventListener("click", addPin);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    if (ev.shiftKey) sendVisited("remove");
    else sendVisited("add");
  }
});

async function init() {
  setStatus("Chargement des pays…");
  try {
    const tsv = await fetchText(COUNTRY_TSV_URL);
    allCountries = parseTSV(tsv);
    applyFilter();
    setStatus(`Pays chargés: ${allCountries.length}.`, "ok");
  } catch (e) {
    console.error(e);
    setStatus(`Impossible de charger les pays: ${e.message}`, "err");
  }
}
init();
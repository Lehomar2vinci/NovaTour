// =======================
// CONFIG
// =======================
const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";

// Pays (noms + id numeric) depuis world-atlas v1.1.4 (TSV présent)
const COUNTRY_TSV_URL = "https://unpkg.com/world-atlas@1.1.4/world/110m.tsv";

// Anti-spam côté client (en plus du backend)
const CLIENT_COOLDOWN_MS = 1500;

// =======================
// DOM
// =======================
const pseudoEl = document.getElementById("pseudo");
const qEl = document.getElementById("q");
const selectEl = document.getElementById("countrySelect");
const statusEl = document.getElementById("status");
const addBtn = document.getElementById("addBtn");
const removeBtn = document.getElementById("removeBtn");

let allCountries = [];     // [{id:"250", name:"France"}, ...]
let filteredCountries = []; // idem
let lastClientSendTs = 0;

function setStatus(msg, kind = "") {
  statusEl.className = kind ? `status ${kind}` : "status";
  statusEl.textContent = msg;
}

function normalizePseudo(p) {
  return (p || "").trim().toLowerCase();
}

function isValidPseudo(p) {
  return /^[a-z0-9_]{3,25}$/.test(p);
}

function escapeText(s) {
  return String(s || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function parseTSV(tsvText) {
  // TSV columns in world-atlas@1.1.4/world/110m.tsv include at least: id, name
  // We'll be defensive.
  const lines = tsvText.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split("\t").map(h => h.trim().toLowerCase());
  const idxId = header.indexOf("id");
  const idxName = header.indexOf("name");

  if (idxId < 0 || idxName < 0) {
    throw new Error(`TSV invalide: colonnes id/name introuvables (header: ${header.join(",")})`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const id = (cols[idxId] || "").trim();
    const name = (cols[idxName] || "").trim();
    if (!id || !name) continue;
    if (!/^\d{1,4}$/.test(id)) continue;
    rows.push({ id, name });
  }

  // Deduplicate by id
  const seen = new Set();
  const uniq = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }

  // Sort alphabetical for nicer UX
  uniq.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  return uniq;
}

function renderSelect(list) {
  selectEl.innerHTML = "";
  for (const c of list) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.id})`;
    selectEl.appendChild(opt);
  }
  // Auto-select first
  if (selectEl.options.length > 0) selectEl.selectedIndex = 0;
}

function applyFilter() {
  const q = (qEl.value || "").trim().toLowerCase();
  if (!q) {
    filteredCountries = allCountries.slice(0, 250); // avoid massive select for weak devices
  } else {
    filteredCountries = allCountries
      .filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q))
      .slice(0, 250);
  }
  renderSelect(filteredCountries);
}

function getSelectedCountryId() {
  const v = selectEl.value;
  return (v || "").trim();
}

async function sendUpdate(action) {
  const now = Date.now();
  if (now - lastClientSendTs < CLIENT_COOLDOWN_MS) {
    setStatus("Trop rapide 🙂 attends 1–2 secondes.", "err");
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

  lastClientSendTs = now;
  setStatus("Envoi…");

  try {
    const res = await fetch(`${API_URL}?route=update`, {
      method: "POST",
      // Apps Script est parfois plus stable avec text/plain
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pseudo, countryId, action })
    });

    const data = await res.json();
    if (!data.ok) {
      if (data.error === "RATE_LIMIT") {
        setStatus(`Rate-limit 🙂 réessaie dans ${data.retryAfterSec || 1}s.`, "err");
      } else if (data.error === "LOCKED") {
        setStatus("Contributions fermées (LOCK).", "err");
      } else if (data.error === "BANNED") {
        setStatus("Pseudo bloqué.", "err");
      } else {
        setStatus(`Erreur: ${escapeText(data.error || "UNKNOWN")}`, "err");
      }
      return;
    }

    setStatus(action === "add" ? "Ajouté ✅" : "Retiré ✅", "ok");
  } catch (e) {
    setStatus("Erreur réseau / API_URL incorrecte.", "err");
  }
}

async function init() {
  setStatus("Chargement des pays…");
  try {
    const tsv = await fetchText(COUNTRY_TSV_URL);
    allCountries = parseTSV(tsv);
    applyFilter();
    setStatus(`Pays chargés: ${allCountries.length}.`, "ok");
  } catch (e) {
    console.error(e);
    setStatus("Impossible de charger la liste des pays (TSV).", "err");
  }
}

// Events
qEl.addEventListener("input", applyFilter);
addBtn.addEventListener("click", () => sendUpdate("add"));
removeBtn.addEventListener("click", () => sendUpdate("remove"));

// Start
init();

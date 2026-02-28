// overlay.js
function getApiUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  if (fromQuery) {
    localStorage.setItem("api_url", fromQuery);
    return fromQuery;
  }
  return localStorage.getItem("api_url") || "";
}

const API_URL = getApiUrl();
const REFRESH_MS = 7000;

const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");
const svgObj = document.getElementById("svgObj");

let state = { globalCountries: [], byUser: {}, updatedAt: 0 };
let svgDoc = null;

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }

function setStats() {
  const globalCount = state.globalCountries?.length || 0;
  const userCount = Object.keys(state.byUser || {}).length;
  statsEl.textContent = `Commune: ${globalCount} pays • ${userCount} viewers`;
}

function clearClasses() {
  if (!svgDoc) return;
  svgDoc.querySelectorAll(".country").forEach(n => {
    n.classList.remove("visitedGlobal");
    n.classList.remove("visitedUser");
  });
}

function applyGlobal() {
  if (!svgDoc) return;
  for (const code of state.globalCountries || []) {
    const el = svgDoc.getElementById(code);
    if (el) el.classList.add("visitedGlobal");
  }
}

function applyUser(pseudo) {
  if (!svgDoc) return;
  const countries = (state.byUser && state.byUser[pseudo]) ? state.byUser[pseudo] : [];
  for (const code of countries) {
    const el = svgDoc.getElementById(code);
    if (el) el.classList.add("visitedUser");
  }
  if (pseudo && isValidPseudo(pseudo)) {
    userInfoEl.textContent = countries.length
      ? `Pseudo: ${pseudo} • ${countries.length} pays`
      : `Pseudo: ${pseudo} • 0 pays (ou inconnu)`;
  } else {
    userInfoEl.textContent = `Mode: Communauté + Pseudo`;
  }
}

function render() {
  clearClasses();
  applyGlobal();
  const p = normalizePseudo(searchEl.value);
  if (isValidPseudo(p)) applyUser(p);
  else applyUser("");
}

async function fetchState() {
  if (!API_URL) {
    statsEl.textContent = "API non configurée (ajoute ?api=.../exec).";
    return;
  }
  try {
    const res = await fetch(`${API_URL}?route=state`, { cache: "no-store" });
    const data = await res.json();
    if (data && data.ok) {
      state = data;
      setStats();
      render();
    } else {
      statsEl.textContent = "Erreur state.";
    }
  } catch (e) {
    statsEl.textContent = "Erreur réseau / URL API incorrecte.";
  }
}

svgObj.addEventListener("load", () => {
  svgDoc = svgObj.contentDocument;
  if (!svgDoc) return;

  // Ajoute class country aux éléments id=ISO2/ISO3
  svgDoc.querySelectorAll("[id]").forEach(el => {
    if (/^[A-Z]{2,3}$/.test(el.id)) el.classList.add("country");
  });

  fetchState();
  setInterval(fetchState, REFRESH_MS);
  render();
});

searchEl.addEventListener("input", () => render());

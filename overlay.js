// =======================
// CONFIG
// =======================
const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";
const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const ISO_CODES_URL = "./assets/codes.json"; // mapping complet numeric -> alpha2
const REFRESH_MS = 7000;

// =======================
// DOM
// =======================
const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");

// =======================
// STATE
// =======================
let state = { globalCountries: [], byUser: {}, updatedAt: 0 };
let features = [];
let numericToAlpha2 = {}; // "528" -> "NL" ...
let alpha2OfFeature = new Map(); // featureIndex -> "FR"

// Projection
const projection = d3.geoMercator();
const path = d3.geoPath(projection);

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }

function setStats() {
  const globalCount = state.globalCountries?.length || 0;
  const userCount = Object.keys(state.byUser || {}).length;
  statsEl.textContent = `Commune: ${globalCount} pays • ${userCount} viewers`;
}

function setUserInfo(pseudo) {
  if (!pseudo) {
    userInfoEl.textContent = "Mode: Communauté + Pseudo";
    return;
  }
  const arr = state.byUser?.[pseudo] || [];
  userInfoEl.textContent = `Pseudo: ${pseudo} • ${arr.length} pays`;
}

async function fetchState() {
  try {
    const res = await fetch(`${API_URL}?route=state`, { cache: "no-store" });
    const data = await res.json();
    if (data?.ok) {
      state = data;
      setStats();
      paint();
    } else {
      statsEl.textContent = "Erreur API state.";
    }
  } catch (e) {
    statsEl.textContent = "Erreur réseau / API_URL.";
    console.error(e);
  }
}

function fitProjectionToFeatures() {
  const fc = { type: "FeatureCollection", features };
  const b = path.bounds(fc);
  const dx = b[1][0] - b[0][0];
  const dy = b[1][1] - b[0][1];
  const x = (b[0][0] + b[1][0]) / 2;
  const y = (b[0][1] + b[1][1]) / 2;

  const w = 1920, h = 1080;
  const scale = 0.95 / Math.max(dx / w, dy / h);
  const translate = [w / 2 - scale * x, h / 2 - scale * y];

  projection.scale(scale).translate(translate);
}

function paint() {
  // Sets
  const globalSet = new Set((state.globalCountries || []).map(s => String(s).toUpperCase()));
  const pseudo = normalizePseudo(searchEl.value);
  const userSet = new Set(
    (isValidPseudo(pseudo) ? (state.byUser?.[pseudo] || []) : []).map(s => String(s).toUpperCase())
  );

  setUserInfo(isValidPseudo(pseudo) ? pseudo : "");

  // Reset classes by data-driven approach
  svg.selectAll("path.country")
    .classed("visitedGlobal", (d) => globalSet.has(alpha2OfFeature.get(d.__idx) || ""))
    .classed("visitedUser", (d) => userSet.has(alpha2OfFeature.get(d.__idx) || ""));
}

async function loadMapping() {
  // codes.json contient des maps alpha2/alpha3/numeric
  // On veut numeric -> alpha2
  const codes = await fetch(ISO_CODES_URL, { cache: "no-store" }).then(r => r.json());
  // Structure de codes.json: { alpha2: {...}, alpha3: {...}, numeric: {...} }
  numericToAlpha2 = codes.numeric || {};
}

async function loadMap() {
  const topo = await fetch(WORLD_ATLAS_URL).then(r => r.json());
  features = topojson.feature(topo, topo.objects.countries).features;

  // Fit projection before drawing
  fitProjectionToFeatures();

  // Enrich features with an index and alpha2 (via numeric id)
  features.forEach((f, i) => {
    f.__idx = i;
    const numeric = String(f.id);       // ex "528"
    const a2 = numericToAlpha2[numeric]; // ex "NL"
    alpha2OfFeature.set(i, a2 || "");
  });

  svg.append("g")
    .attr("id", "countries")
    .selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "country")
    .attr("d", d => path(d));

  // Premier rendu (avant state)
  paint();
}

async function boot() {
  try {
    // Si ce fichier manque → overlay “vide”
    await loadMapping();
    await loadMap();
    await fetchState();
    setInterval(fetchState, REFRESH_MS);

    statsEl.textContent = "OK";
    setStats();
  } catch (e) {
    statsEl.textContent = "Erreur chargement (console).";
    console.error(e);
  }
}

searchEl.addEventListener("input", paint);
boot();

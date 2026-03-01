https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec


// =======================
// CONFIG
// =======================
const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec
";

// CDN (si tu veux rester CDN)

const WORLD_ATLAS_URL = "./assets/countries-110m.json";
const ISO_CODES_URL = "./assets/codes.json"; // DOIT exister dans ton repo

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
let numericToAlpha2 = {};          // "528" -> "NL"
let alpha2OfFeature = new Map();   // idx -> "FR"

// Projection
const projection = d3.geoMercator();
const path = d3.geoPath(projection);

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }

function setStatsText(t) { statsEl.textContent = t; }
function setUserInfo(pseudo) {
  if (!pseudo) userInfoEl.textContent = "Mode: Communauté + Pseudo";
  else userInfoEl.textContent = `Pseudo: ${pseudo}`;
}

async function safeFetchJson(url, label) {
  setStatsText(`Chargement: ${label}…`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status} (${url})`);
  }
  return await res.json();
}

async function fetchState() {
  try {
    const data = await safeFetchJson(`${API_URL}?route=state`, "API state");
    if (data?.ok) {
      state = data;
      paint();
      const globalCount = state.globalCountries?.length || 0;
      const userCount = Object.keys(state.byUser || {}).length;
      setStatsText(`OK • ${globalCount} pays • ${userCount} viewers`);
    } else {
      setStatsText("API state: ok=false");
    }
  } catch (e) {
    setStatsText(`API ERROR: ${e.message}`);
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
  const globalSet = new Set((state.globalCountries || []).map(s => String(s).toUpperCase()));

  const pseudo = normalizePseudo(searchEl.value);
  const userCountries = (isValidPseudo(pseudo) ? (state.byUser?.[pseudo] || []) : []);
  const userSet = new Set(userCountries.map(s => String(s).toUpperCase()));

  setUserInfo(isValidPseudo(pseudo) ? pseudo : "");

  svg.selectAll("path.country")
    .classed("visitedGlobal", d => globalSet.has(alpha2OfFeature.get(d.__idx) || ""))
    .classed("visitedUser",   d => userSet.has(alpha2OfFeature.get(d.__idx) || ""));
}

async function boot() {
  try {
    // 1) Vérifier mapping
    const codes = await safeFetchJson(ISO_CODES_URL, "codes.json");
    numericToAlpha2 = codes.numeric || {};
    if (!numericToAlpha2 || Object.keys(numericToAlpha2).length < 200) {
      throw new Error("codes.json chargé mais mapping numeric incomplet");
    }

    // 2) Charger carte topojson
    const topo = await safeFetchJson(WORLD_ATLAS_URL, "world-atlas");
    features = topojson.feature(topo, topo.objects.countries).features;

    // 3) Ajuster projection
    fitProjectionToFeatures();

    // 4) Enrichir + dessiner
    features.forEach((f, i) => {
      f.__idx = i;
      const numeric = String(f.id);
      const a2 = numericToAlpha2[numeric]; // "FR"
      alpha2OfFeature.set(i, a2 || "");
    });

    svg.selectAll("*").remove();
    svg.append("g")
      .attr("id", "countries")
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", d => path(d));

    paint();

    // 5) API state
    await fetchState();
    setInterval(fetchState, REFRESH_MS);

  } catch (e) {
    setStatsText(`LOAD ERROR: ${e.message}`);
    console.error(e);
  }
}

searchEl.addEventListener("input", paint);
boot();

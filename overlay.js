
// =======================
// CONFIG
// =======================
const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";
const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const ISO_CODES_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/country-names.tsv";
const REFRESH_MS = 7000;

const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");

let state = { globalCountries: [], byUser: {}, updatedAt: 0 };
let features = [];
let numericToAlpha2 = {};
let alpha2OfFeature = new Map();

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }

function setStatsText(t) { statsEl.textContent = t; }

async function fetchText(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return txt;
}

async function fetchJson(url, label) {
  const txt = await fetchText(url, label);
  try { return JSON.parse(txt); }
  catch { throw new Error(`${label} JSON invalide (début: ${txt.slice(0, 40)})`); }
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
  const userCountries = isValidPseudo(pseudo) ? (state.byUser?.[pseudo] || []) : [];
  const userSet = new Set(userCountries.map(s => String(s).toUpperCase()));

  userInfoEl.textContent = isValidPseudo(pseudo)
    ? `Pseudo: ${pseudo} • ${userCountries.length} pays`
    : "Mode: Communauté + Pseudo";

  svg.selectAll("path.country")
    .classed("visitedGlobal", d => globalSet.has(alpha2OfFeature.get(d.__idx) || ""))
    .classed("visitedUser",   d => userSet.has(alpha2OfFeature.get(d.__idx) || ""));
}

async function fetchState() {
  try {
    const data = await fetchJson(`${API_URL}?route=state`, "API state");
    if (data?.ok) {
      state = data;
      paint();
      const g = state.globalCountries?.length || 0;
      const u = Object.keys(state.byUser || {}).length;
      setStatsText(`OK • ${g} pays • ${u} viewers`);
    } else {
      setStatsText("API state: ok=false");
    }
  } catch (e) {
    setStatsText(`API ERROR: ${e.message}`);
  }
}

async function loadNumericToAlpha2() {
  // TSV columns include: id (iso_n3), name, iso2, iso3 (selon version)
  // On construit: "250" -> "FR"
  const res = await fetch(ISO_CODES_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`mapping TSV HTTP ${res.status}`);
  const tsvText = await res.text();

  const rows = d3.tsvParse(tsvText);
  const map = {};

  for (const r of rows) {
    // Selon les versions, les colonnes peuvent être "id" et "iso2"
    // id = numeric, iso2 = alpha2
    const id = (r.id || "").trim();       // ex "250"
    const iso2 = (r.iso2 || "").trim();   // ex "FR"
    if (id && iso2 && /^[0-9]+$/.test(id) && /^[A-Z]{2}$/.test(iso2)) {
      map[id] = iso2;
    }
  }

  if (Object.keys(map).length < 200) {
    throw new Error(`mapping TSV incomplet (${Object.keys(map).length})`);
  }
  return map;
}


async function boot() {
  try {
    setStatsText("Chargement mapping…");
    numericToAlpha2 = await loadNumericToAlpha2();

    setStatsText("Chargement carte…");
    const topo = await fetchJson(WORLD_ATLAS_URL, "world-atlas");
    features = topojson.feature(topo, topo.objects.countries).features;

    fitProjectionToFeatures();

    features.forEach((f, i) => {
      f.__idx = i;
      alpha2OfFeature.set(i, numericToAlpha2[String(f.id)] || "");
    });

    svg.selectAll("*").remove();
    svg.append("g")
      .attr("id", "countries")
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", d => path(d));

    setStatsText("Carte OK, lecture API…");
    paint();

    await fetchState();
    setInterval(fetchState, REFRESH_MS);
  } catch (e) {
    setStatsText(`LOAD ERROR: ${e.message}`);
    console.error(e);
  }
}

searchEl.addEventListener("input", paint);
boot();


// =======================
// CONFIG
// =======================
const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";

// LOCAL (fiable OBS)
const WORLD_TOPO_URL = "./assets/110m.json";
const WORLD_TSV_URL  = "./assets/110m.tsv";
const REFRESH_MS = 7000;

const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");

let state = { globalCountries: [], byUser: {}, updatedAt: 0 };
let features = [];
let idToIso2 = {};      // "250" -> "FR" (si dispo dans TSV)
let iso2OfIdx = new Map();

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }
function setStatsText(t) { statsEl.textContent = t; }

async function fetchText(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status} (${url})`);
  return txt;
}
async function fetchJson(url, label) {
  const txt = await fetchText(url, label);
  return JSON.parse(txt);
}

async function loadIdToIso2FromTSV() {
  const tsvText = await fetchText(WORLD_TSV_URL, "110m.tsv");
  const rows = d3.tsvParse(tsvText);

  // Selon les versions, les colonnes peuvent varier.
  // On tente "id" + "iso2" (le cas idéal).
  const map = {};
  for (const r of rows) {
    const id = (r.id || "").trim();
    const iso2 = (r.iso2 || "").trim().toUpperCase();
    if (id && /^[0-9]+$/.test(id) && /^[A-Z]{2}$/.test(iso2)) map[id] = iso2;
  }

  // Si iso2 n’existe pas, on laisse map vide et on te dira quoi faire (voir note)
  return map;
}

function fitProjection() {
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
    .classed("visitedGlobal", d => globalSet.has(iso2OfIdx.get(d.__idx) || ""))
    .classed("visitedUser",   d => userSet.has(iso2OfIdx.get(d.__idx) || ""));
}

async function fetchState() {
  try {
    const res = await fetch(`${API_URL}?route=state`, { cache: "no-store" });
    const data = await res.json();
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

async function boot() {
  try {
    setStatsText("Chargement TSV…");
    idToIso2 = await loadIdToIso2FromTSV();

    setStatsText("Chargement carte…");
    const topo = await fetchJson(WORLD_TOPO_URL, "110m.json");
    features = topojson.feature(topo, topo.objects.countries).features;

    fitProjection();

    features.forEach((f, i) => {
      f.__idx = i;
      const id = String(f.id);
      iso2OfIdx.set(i, idToIso2[id] || ""); // si TSV n’a pas iso2 -> ""
    });

    svg.selectAll("*").remove();
    svg.append("g")
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", d => path(d));

    paint();

    setStatsText("Carte OK, lecture API…");
    await fetchState();
    setInterval(fetchState, REFRESH_MS);

  } catch (e) {
    setStatsText(`LOAD ERROR: ${e.message}`);
    console.error(e);
  }
}

searchEl.addEventListener("input", paint);
boot();

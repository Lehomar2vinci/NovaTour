const API_URL ="https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";
const WORLD_ATLAS_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const REFRESH_MS = 7000;

const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");

let state = { globalCountries: [], byUser: {}, updatedAt: 0 };
let features = [];

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

function normalizePseudo(p) {
  return (p || "").trim().toLowerCase();
}
function isValidPseudo(p) {
  return /^[a-z0-9_]{3,25}$/.test(p);
}
function setStatsText(t) {
  statsEl.textContent = t;
}

async function fetchJson(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return await res.json();
}

function fitProjectionToFeatures() {
  const fc = { type: "FeatureCollection", features };
  const b = path.bounds(fc);
  const dx = b[1][0] - b[0][0];
  const dy = b[1][1] - b[0][1];
  const x = (b[0][0] + b[1][0]) / 2;
  const y = (b[0][1] + b[1][1]) / 2;

  const w = 1920,
    h = 1080;
  const scale = 0.95 / Math.max(dx / w, dy / h);
  const translate = [w / 2 - scale * x, h / 2 - scale * y];

  projection.scale(scale).translate(translate);
}

function paint() {
  const globalSet = new Set((state.globalCountries || []).map(String));

  const pseudo = normalizePseudo(searchEl.value);
  const userList = isValidPseudo(pseudo) ? state.byUser?.[pseudo] || [] : [];
  const userSet = new Set(userList.map(String));

  userInfoEl.textContent = isValidPseudo(pseudo)
    ? `Pseudo: ${pseudo} • ${userList.length} pays`
    : "Mode: Communauté + Pseudo";

  svg
    .selectAll("path.country")
    .classed("visitedGlobal", (d) => globalSet.has(String(d.id)))
    .classed("visitedUser", (d) => userSet.has(String(d.id)));
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

async function boot() {
  try {
    setStatsText("Chargement carte…");
    const topo = await fetchJson(WORLD_ATLAS_URL, "world-atlas");
    features = topojson.feature(topo, topo.objects.countries).features;

    fitProjectionToFeatures();

    svg.selectAll("*").remove();
    svg
      .append("g")
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", (d) => path(d));

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

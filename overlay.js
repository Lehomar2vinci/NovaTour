
// =======================
// CONFIG
// =======================
const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";
const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const REFRESH_MS = 7000;

const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");

let state = { globalCountries: [], byUser: {}, pinsByCountry: {}, updatedAt: 0 };
let features = [];

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }
function setStatsText(t) { statsEl.textContent = t; }

async function fetchJson(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return await res.json();
}

// Scene group: tout ce qui doit zoomer/panner ensemble
let scene, countriesLayer, pinsLayer;

function getSvgSize() {
  const el = svg.node();
  const r = el.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function fitProjection() {
  const { w, h } = getSvgSize();
  const fc = { type: "FeatureCollection", features };
  projection.fitSize([w, h], fc);
  // Recalcul des d (chemins)
  countriesLayer.selectAll("path.country").attr("d", d => path(d));
  // Repositionne pins
  paintPins();
}

function paintCountries() {
  const globalSet = new Set((state.globalCountries || []).map(String));

  const pseudo = normalizePseudo(searchEl.value);
  const userList = isValidPseudo(pseudo) ? (state.byUser?.[pseudo] || []) : [];
  const userSet = new Set(userList.map(String));

  userInfoEl.textContent = isValidPseudo(pseudo)
    ? `Pseudo: ${pseudo} • ${userList.length} pays`
    : "Mode: Communauté + Pseudo";

  countriesLayer.selectAll("path.country")
    .classed("visitedGlobal", d => globalSet.has(String(d.id)))
    .classed("visitedUser",   d => userSet.has(String(d.id)));
}

function paintPins() {
  if (!pinsLayer) return;

  const pinsByCountry = state.pinsByCountry || {};
  const entries = Object.entries(pinsByCountry); // [ [id, count], ... ]
  const byId = new Map(features.map(f => [String(f.id), f]));

  const pinsData = entries
    .map(([id, count]) => {
      const f = byId.get(String(id));
      if (!f) return null;
      const c = d3.geoCentroid(f);
      const xy = projection(c);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) return null;
      return { id: String(id), count: Number(count) || 0, x: xy[0], y: xy[1] };
    })
    .filter(Boolean);

  const sel = pinsLayer.selectAll("g.pin")
    .data(pinsData, d => d.id);

  const enter = sel.enter().append("g").attr("class", "pin");
  enter.append("circle");
  enter.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", 4)
    .style("font-size", "10px");

  sel.merge(enter)
    .attr("transform", d => `translate(${d.x},${d.y})`);

  sel.merge(enter).select("circle")
    .attr("r", d => 6 + Math.min(18, Math.sqrt(d.count) * 3));

  sel.merge(enter).select("text")
    .text(d => d.count >= 2 ? String(d.count) : "");

  sel.exit().remove();
}

function paint() {
  paintCountries();
  paintPins();
}

async function fetchState() {
  try {
    const data = await fetchJson(`${API_URL}?route=state`, "API state");
    if (data?.ok) {
      state = data;
      paint();

      const g = state.globalCountries?.length || 0;
      const u = Object.keys(state.byUser || {}).length;
      const p = Object.keys(state.pinsByCountry || {}).length;
      setStatsText(`OK • ${g} pays • ${u} viewers • ${p} pays pinnés`);
    } else {
      setStatsText("API state: ok=false");
    }
  } catch (e) {
    setStatsText(`API ERROR: ${e.message}`);
  }
}

function enableZoom() {
  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
      scene.attr("transform", event.transform);
    });

  // Appliquer zoom sur le SVG (molette + drag)
  svg.call(zoom);

  // Double-clic zoom désactivé (optionnel)
  svg.on("dblclick.zoom", null);
}

async function boot() {
  try {
    setStatsText("Chargement carte…");

    // Prépare SVG (important pour fitSize)
    const { w, h } = getSvgSize();
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    // Charger topojson
    const topo = await fetchJson(WORLD_ATLAS_URL, "world-atlas");
    features = topojson.feature(topo, topo.objects.countries).features;

    // Nettoyage + layers
    svg.selectAll("*").remove();
    scene = svg.append("g").attr("id", "scene");
    countriesLayer = scene.append("g").attr("id", "countries");
    pinsLayer = scene.append("g").attr("id", "pins");

    // Fit projection au vrai viewport
    fitProjection();

    // Dessin pays
    countriesLayer.selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", d => path(d));

    // Zoom/pan
    enableZoom();

    // Initial paint + boucle API
    paint();
    setStatsText("Carte OK, lecture API…");

    await fetchState();
    setInterval(fetchState, REFRESH_MS);

    // Refit au resize
    window.addEventListener("resize", () => {
      const { w, h } = getSvgSize();
      svg.attr("viewBox", `0 0 ${w} ${h}`);
      fitProjection();
    });

  } catch (e) {
    setStatsText(`LOAD ERROR: ${e.message}`);
    console.error(e);
  }
}

searchEl.addEventListener("input", paint);
boot();

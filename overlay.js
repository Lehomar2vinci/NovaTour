
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

let state = { globalCountries: [], byUser: {}, pinsByCountry: {}, recentPins: [], updatedAt: 0 };
let features = [];

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

// Scene group: tout ce qui doit zoomer/panner ensemble
let scene, countriesLayer, pinsLayer, tooltipLayer;
let selectedPinId = null;

function normalizePseudo(p) { return (p || "").trim().toLowerCase(); }
function isValidPseudo(p) { return /^[a-z0-9_]{3,25}$/.test(p); }
function setStatsText(t) { statsEl.textContent = t; }

async function fetchJson(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return await res.json();
}

function getSvgSize() {
  const el = svg.node();
  const r = el.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function fitProjection() {
  const { w, h } = getSvgSize();
  const fc = { type: "FeatureCollection", features };
  projection.fitSize([w, h], fc);

  // Recalcul des chemins
  countriesLayer.selectAll("path.country").attr("d", d => path(d));
  // Repositionne pins + tooltip
  paintPins();
  paintTooltip();
}

function buildPinLabelMap() {
  // dernier label non-vide par pays (d'après recentPins)
  const map = {};
  const arr = state.recentPins || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    const id = String(p.country || "");
    const label = String(p.label || "").trim();
    if (!id) continue;
    if (label && map[id] == null) map[id] = label;
  }
  return map;
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
  const labelMap = buildPinLabelMap();
  const entries = Object.entries(pinsByCountry); // [ [id, count], ... ]
  const byId = new Map(features.map(f => [String(f.id), f]));

  const pinsData = entries
    .map(([id, count]) => {
      const f = byId.get(String(id));
      if (!f) return null;
      const c = d3.geoCentroid(f);
      const xy = projection(c);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) return null;
      return {
        id: String(id),
        count: Number(count) || 0,
        x: xy[0],
        y: xy[1],
        label: labelMap[String(id)] || ""  // dernier label connu
      };
    })
    .filter(Boolean);

  const sel = pinsLayer.selectAll("g.pin")
    .data(pinsData, d => d.id);

  const enter = sel.enter().append("g")
    .attr("class", "pin")
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      selectedPinId = (selectedPinId === d.id) ? null : d.id;
      paintTooltip();
      // met à jour classe selected
      pinsLayer.selectAll("g.pin").classed("selected", p => p.id === selectedPinId);
    });

  enter.append("circle");
  enter.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", 4)
    .style("font-size", "10px")
    .style("pointer-events", "none");

  sel.merge(enter)
    .attr("transform", d => `translate(${d.x},${d.y})`);

  sel.merge(enter).select("circle")
    .attr("r", d => 6 + Math.min(18, Math.sqrt(d.count) * 3));

  sel.merge(enter).select("text")
    .text(d => d.count >= 2 ? String(d.count) : "");

  sel.exit().remove();

  // Maj selected class après refresh
  pinsLayer.selectAll("g.pin").classed("selected", p => p.id === selectedPinId);
}

function formatShortDate(iso) {
  // ISO string -> "DD/MM HH:MM" (simple)
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function paintTooltip() {
  if (!tooltipLayer) return;
  tooltipLayer.selectAll("*").remove();
  if (!selectedPinId) return;

  // Données pin courantes (position)
  const pinNode = pinsLayer.selectAll("g.pin").filter(d => d.id === selectedPinId);
  const d = pinNode.datum();
  if (!d) return;

  const count = Number(state.pinsByCountry?.[selectedPinId] || 0);

  // Liste complète (cap 50 par pays) renvoyée par l’API
  const fullList = (state.pinsFullByCountry && state.pinsFullByCountry[selectedPinId])
    ? state.pinsFullByCountry[selectedPinId]
    : [];

  // Tooltip group
  const g = tooltipLayer.append("g")
    .attr("class", "pinTooltip")
    .attr("transform", `translate(${d.x},${d.y})`);

  // Titre
  const title = `Pays ${selectedPinId} • ${count} pin(s)`;
  const header = g.append("text")
    .attr("class", "pinTooltipText")
    .attr("x", 0)
    .attr("y", 0);

  header.append("tspan").attr("x", 0).attr("dy", 0).text(title);

  // Liste (labels)
  const maxShow = Math.min(12, fullList.length); // on affiche 12 dans le tooltip
  const lines = [];

  for (let i = 0; i < maxShow; i++) {
    const p = fullList[i]; // déjà “du plus récent au plus ancien”
    const label = String(p.label || "").trim();
    const pseudo = String(p.pseudo || "").trim();
    const dt = formatShortDate(p.t || "");
    const line = label
      ? `• ${label} — ${pseudo}${dt ? " (" + dt + ")" : ""}`
      : `• (sans label) — ${pseudo}${dt ? " (" + dt + ")" : ""}`;
    lines.push(line);
  }

  if (fullList.length > maxShow) {
    lines.push(`… +${fullList.length - maxShow} autre(s)`);
  }

  const body = g.append("text")
    .attr("class", "pinTooltipSmall")
    .attr("x", 0)
    .attr("y", 0);

  lines.forEach((line, i) => {
    body.append("tspan")
      .attr("x", 0)
      .attr("dy", i === 0 ? 18 : 16)
      .text(line);
  });

  // Mesure bbox du groupe texte (header + body)
  const bbox = g.node().getBBox();
  const paddingX = 12;
  const paddingY = 10;

  g.insert("rect", ":first-child")
    .attr("class", "pinTooltipBox")
    .attr("x", bbox.x - paddingX)
    .attr("y", bbox.y - paddingY)
    .attr("width", bbox.width + paddingX * 2)
    .attr("height", bbox.height + paddingY * 2)
    .attr("rx", 10)
    .attr("ry", 10);

  // petit “stem”
  g.append("path")
    .attr("class", "pinTooltipStem")
    .attr("d", `M 0 ${bbox.y + bbox.height + paddingY} L -8 ${bbox.y + bbox.height + paddingY + 10} L 8 ${bbox.y + bbox.height + paddingY + 10} Z`);

  // Place tooltip au-dessus du pin, centré
  const xShift = -bbox.width / 2;
  const yShift = -bbox.height - 28;
  g.attr("transform", `translate(${d.x},${d.y}) translate(${xShift}, ${yShift})`);
}

function paint() {
  paintCountries();
  paintPins();
  paintTooltip();
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

  svg.call(zoom);
  svg.on("dblclick.zoom", null);
}

async function boot() {
  try {
    setStatsText("Chargement carte…");

    const { w, h } = getSvgSize();
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    const topo = await fetchJson(WORLD_ATLAS_URL, "world-atlas");
    features = topojson.feature(topo, topo.objects.countries).features;

    svg.selectAll("*").remove();

    scene = svg.append("g").attr("id", "scene");
    countriesLayer = scene.append("g").attr("id", "countries");
    pinsLayer = scene.append("g").attr("id", "pins");
    tooltipLayer = scene.append("g").attr("id", "tooltips");

    fitProjection();

    countriesLayer.selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", d => path(d));

    // click anywhere -> close tooltip
    svg.on("click", () => {
      selectedPinId = null;
      pinsLayer.selectAll("g.pin").classed("selected", false);
      paintTooltip();
    });

    enableZoom();

    paint();
    setStatsText("Carte OK, lecture API…");

    await fetchState();
    setInterval(fetchState, REFRESH_MS);

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

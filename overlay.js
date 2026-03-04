// =======================
// CONFIG
// =======================
const API_URL =
  "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";
const WORLD_ATLAS_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const REFRESH_MS = 7000;

const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const tooltip = document.getElementById("tooltip");

let state = { pinsByCountry: {}, recentPins: [], updatedAt: 0 };
let features = [];

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

let scene, countriesLayer, pinsLayer;

function setStatsText(t) {
  statsEl.textContent = t;
}

async function fetchJson(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return await res.json();
}

function getSvgSize() {
  const r = svg.node().getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function fitProjection() {
  const { w, h } = getSvgSize();
  projection.fitSize([w, h], { type: "FeatureCollection", features });
  countriesLayer.selectAll("path.country").attr("d", (d) => path(d));
  paintPins();
}

function hideTooltip() {
  tooltip.style.display = "none";
}
function showTooltip(x, y, html) {
  tooltip.innerHTML = html;
  tooltip.style.display = "block";
  tooltip.style.left = `${Math.min(window.innerWidth - 380, x + 12)}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - 160, y + 12)}px`;
}

function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function paintPins() {
  const pinsByCountry = state.pinsByCountry || {};
  const entries = Object.entries(pinsByCountry);

  // ✅ Normalise map keys: feature.id may be numeric; use Number->String
  const byId = new Map(features.map((f) => [String(Number(f.id)), f]));

  const pinsData = entries
    .map(([id, count]) => {
      const key = String(Number(id)); // "004" -> "4"
      const f = byId.get(key);
      if (!f) return null;

      const c = d3.geoCentroid(f);
      const xy = projection(c);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) return null;

      const recent = (state.recentPins || [])
        .filter((p) => String(Number(p.country)) === key)
        .slice(-10)
        .reverse();

      return { id: key, count: Number(count) || 0, x: xy[0], y: xy[1], recent };
    })
    .filter(Boolean);

  const sel = pinsLayer.selectAll("g.pin").data(pinsData, (d) => d.id);

  const enter = sel.enter().append("g").attr("class", "pin");
  enter.append("circle");
  enter
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", 4)
    .style("font-size", "10px");

  sel
    .merge(enter)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .on("click", (event, d) => {
      const lines = d.recent.length
        ? d.recent
            .map((p) => {
              const when = p.t ? escapeHtml(p.t) : "";
              return `<div class="m">• <b>${escapeHtml(p.pseudo)}</b> — ${escapeHtml(p.label)}<br/><span style="opacity:.75">${when}</span></div>`;
            })
            .join("")
        : `<div class="m">Aucun détail récent.</div>`;

      showTooltip(
        event.clientX,
        event.clientY,
        `<div class="t">📍 Pays ID ${escapeHtml(d.id)} — ${d.count} pin(s)</div>${lines}`,
      );
    });

  sel
    .merge(enter)
    .select("circle")
    .attr("r", (d) => 6 + Math.min(18, Math.sqrt(d.count) * 3));

  sel
    .merge(enter)
    .select("text")
    .text((d) => (d.count >= 2 ? String(d.count) : ""));

  sel.exit().remove();
}

async function fetchState() {
  try {
    const data = await fetchJson(`${API_URL}?route=state`, "API state");
    if (data?.ok) {
      state = data;

      const p = Object.keys(state.pinsByCountry || {}).length;
      const totalPins = Object.values(state.pinsByCountry || {}).reduce(
        (a, b) => a + Number(b || 0),
        0,
      );
      setStatsText(`OK • ${p} pays pinnés • ${totalPins} pins`);

      paintPins();
    } else {
      setStatsText("API state: ok=false");
    }
  } catch (e) {
    setStatsText(`API ERROR: ${e.message}`);
  }
}

function enableZoom() {
  const zoom = d3
    .zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => scene.attr("transform", event.transform));
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

    fitProjection();

    countriesLayer
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "country")
      .attr("d", (d) => path(d));

    enableZoom();

    window.addEventListener("click", (ev) => {
      if (!ev.target.closest || !ev.target.closest(".pin")) hideTooltip();
    });

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

boot();
const API_URL =
  "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";

const WORLD_ATLAS_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const COUNTRY_TSV_URL = "https://unpkg.com/world-atlas@1.1.4/world/110m.tsv";
const REFRESH_MS = 5000;

// ===== Pin sizing behaviour =====
// k = zoom scale. We shrink pins as you zoom in: scalePin = 1 / k^PIN_SHRINK_POWER
// 0.0 => constant size; 1.0 => fully inverse; 0.6 is a good compromise.
const PIN_SHRINK_POWER = 0.65;
// clamp radii
const PIN_R_MIN = 2.5;
const PIN_R_MAX = 16;

const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const tooltip = document.getElementById("tooltip");

let state = { pinsByCountry: {}, recentPins: [], updatedAt: 0 };
let features = [];
let idToCountryName = new Map(); // "250" -> "France"

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

let scene, countriesLayer, pinsLayer;
let tooltipLocked = false;
let currentZoomK = 1;

// ===== Utils =====
function setStatsText(t) {
  statsEl.textContent = t;
}

async function fetchJson(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return await res.json();
}

async function fetchText(url, label) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return await res.text();
}

function getSvgSize() {
  const r = svg.node().getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
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

function hideTooltip() {
  tooltip.style.display = "none";
}
function showTooltip(x, y, html) {
  tooltip.innerHTML = html;
  tooltip.style.display = "block";
  tooltip.style.left = `${Math.min(window.innerWidth - 380, x + 12)}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - 160, y + 12)}px`;
}

function countryNameFromId(id) {
  const key = String(Number(id)); // "004" -> "4"
  return idToCountryName.get(key) || `Pays #${key}`;
}

async function loadCountryNames() {
  const tsv = await fetchText(COUNTRY_TSV_URL, "country TSV");
  const rows = d3.tsvParse(tsv);

  const map = new Map();
  for (const r of rows) {
    const name = (r.name || "").trim();
    const isoN3 = (r.iso_n3 || "").trim();
    if (!name) continue;
    if (!isoN3 || !/^\d{1,4}$/.test(isoN3)) continue;
    map.set(String(Number(isoN3)), name);
  }
  idToCountryName = map;
}

function buildTooltipHtml(d) {
  const lines = d.recent.length
    ? d.recent
        .map((p) => {
          const when = p.t ? escapeHtml(p.t) : "";
          return `<div class="m">• <b>${escapeHtml(p.pseudo)}</b> — ${escapeHtml(p.label)}<br/><span style="opacity:.75">${when}</span></div>`;
        })
        .join("")
    : `<div class="m">Aucun détail récent.</div>`;

  return `<div class="t">📍 ${escapeHtml(d.countryName)} — ${d.count} pin(s)</div>${lines}`;
}

// ===== Projection fit =====
function fitProjection() {
  const { w, h } = getSvgSize();
  projection.fitSize([w, h], { type: "FeatureCollection", features });

  // update country paths
  countriesLayer.selectAll("path.country").attr("d", (d) => path(d));

  // reposition pins
  paintPins(true);
}

// ===== Pin sizing (depends on zoom) =====
function pinScaleForZoom(k) {
  return 1 / Math.pow(Math.max(1e-6, k), PIN_SHRINK_POWER);
}

function pinRadiusBase(count) {
  // base radius by count (before zoom scaling)
  return 5.5 + Math.min(16, Math.sqrt(count) * 2.6);
}

function pinRadiusFinal(count, k) {
  const r = pinRadiusBase(count) * pinScaleForZoom(k);
  return Math.max(PIN_R_MIN, Math.min(PIN_R_MAX, r));
}

// ===== Paint pins =====
function paintPins(withAnimation = false) {
  const pinsByCountry = state.pinsByCountry || {};
  const entries = Object.entries(pinsByCountry);

  const byId = new Map(features.map((f) => [String(Number(f.id)), f]));
  const k = currentZoomK;

  const pinsData = entries
    .map(([id, count]) => {
      const key = String(Number(id));
      const f = byId.get(key);
      if (!f) return null;

      const c = d3.geoCentroid(f);
      const xy = projection(c);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) return null;

      const recent = (state.recentPins || [])
        .filter((p) => String(Number(p.country)) === key)
        .slice(-10)
        .reverse();

      return {
        id: key,
        countryName: countryNameFromId(key),
        count: Number(count) || 0,
        x: xy[0],
        y: xy[1],
        recent,
      };
    })
    .filter(Boolean);

  const sel = pinsLayer.selectAll("g.pin").data(pinsData, (d) => d.id);

  const enter = sel.enter().append("g").attr("class", "pin");

  enter.append("circle").attr("r", 0).attr("opacity", 0);

  enter
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", 4)
    .style("font-size", "10px")
    .style("opacity", 0);

  // IMPORTANT:
  // We apply zoom to the whole scene (countries + pins).
  // To prevent pins from becoming huge on zoom, we apply an inverse scale inside each pin group.
  // scene scales by k, pin group scales by s=1/k^p => net size shrinks/controls.
  const scaleInside = pinScaleForZoom(k);

  const merged = sel
    .merge(enter)
    .attr("transform", (d) => `translate(${d.x},${d.y}) scale(${scaleInside})`);

  // Interactions: hover shows tooltip; click toggles lock
  merged
    .on("mouseenter", (event, d) => {
      if (tooltipLocked) return;
      showTooltip(event.clientX, event.clientY, buildTooltipHtml(d));
    })
    .on("mousemove", (event, d) => {
      if (tooltipLocked) return;
      showTooltip(event.clientX, event.clientY, buildTooltipHtml(d));
    })
    .on("mouseleave", () => {
      if (tooltipLocked) return;
      hideTooltip();
    })
    .on("click", (event, d) => {
      tooltipLocked = !tooltipLocked;
      if (tooltipLocked)
        showTooltip(event.clientX, event.clientY, buildTooltipHtml(d));
      else hideTooltip();
    });

  // Update radius + count text with animation
  const applyUpdate = (s) => {
    s.select("circle")
      .attr("r", (d) => pinRadiusFinal(d.count, 1)) // radius computed in "pin local scale space"
      .attr("opacity", 1);

    s.select("text")
      .text((d) => (d.count >= 2 ? String(d.count) : ""))
      .style("opacity", (d) => (d.count >= 2 ? 1 : 0));
  };

  if (withAnimation) {
    // Enter "pop" animation and smooth updates
    enter
      .select("circle")
      .transition()
      .duration(320)
      .ease(d3.easeBackOut)
      .attr("opacity", 1)
      .attr("r", (d) => pinRadiusFinal(d.count, 1));

    enter
      .select("text")
      .transition()
      .duration(250)
      .style("opacity", (d) => (d.count >= 2 ? 1 : 0));

    sel
      .select("circle")
      .transition()
      .duration(250)
      .attr("r", (d) => pinRadiusFinal(d.count, 1));
  } else {
    applyUpdate(merged);
  }

  sel.exit().transition().duration(200).style("opacity", 0).remove();

  // NOTE:
  // We keep radius calculation in local (post-scale) space: radiusFinal(count,1).
  // The size adjustment relative to zoom is handled by the group scale(scaleInside).
}

// ===== Fetch state =====
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

      paintPins(true);
    } else {
      setStatsText("API state: ok=false");
    }
  } catch (e) {
    setStatsText(`API ERROR: ${e.message}`);
  }
}

// ===== Zoom =====
function enableZoom() {
  const zoom = d3
    .zoom()
    .scaleExtent([1, 12])
    .on("zoom", (event) => {
      scene.attr("transform", event.transform);
      currentZoomK = event.transform.k;

      // Update pin inner scale to shrink with zoom smoothly
      const s = pinScaleForZoom(currentZoomK);
      pinsLayer
        .selectAll("g.pin")
        .attr("transform", (d) => `translate(${d.x},${d.y}) scale(${s})`);
    });

  svg.call(zoom);
  svg.on("dblclick.zoom", null);
}

// ===== Boot =====
async function boot() {
  try {
    setStatsText("Chargement carte…");

    const { w, h } = getSvgSize();
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    await loadCountryNames();

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

    // Click hors pin = unlock + hide
    window.addEventListener("click", (ev) => {
      if (ev.target.closest && ev.target.closest(".pin")) return;
      tooltipLocked = false;
      hideTooltip();
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
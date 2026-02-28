/**
 * Viewer World Map - overlay.js
 * - Renders world map from world-atlas TopoJSON
 * - Colors global visited countries + outlines countries of a searched viewer
 */

// 1) PUT your Apps Script Web App URL here (ends with /exec)
const API_URL = "PUT_YOUR_APPS_SCRIPT_WEBAPP_URL_HERE";

// 2) Map source (TopoJSON)
const TOPOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// 3) Refresh
const REFRESH_MS = 7000;

const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");
const svg = d3.select("#map");

let geoFeatures = [];
let byName = new Map(); // name -> svg path selection
let state = { ok:true, globalCountries: [], byUser: {}, updatedAt: 0 };

function normalizePseudo(p){ return (p || "").trim().toLowerCase(); }
function isValidPseudo(p){ return /^[a-z0-9_]{3,25}$/.test(p); }

function setStats(){
  const globalCount = state.globalCountries?.length || 0;
  const userCount = Object.keys(state.byUser || {}).length;
  statsEl.textContent = `Commune: ${globalCount} pays • ${userCount} viewers`;
}

function render(){
  // clear
  svg.selectAll("path.country")
    .classed("visited-global", false)
    .classed("visited-user", false);

  // apply global fill
  for (const name of (state.globalCountries || [])){
    const sel = byName.get(name);
    if (sel) sel.classed("visited-global", true);
  }

  // apply user outline
  const p = normalizePseudo(searchEl.value);
  if (isValidPseudo(p)){
    const list = (state.byUser && state.byUser[p]) ? state.byUser[p] : [];
    for (const name of list){
      const sel = byName.get(name);
      if (sel) sel.classed("visited-user", true);
    }
    userInfoEl.textContent = list.length
      ? `Pseudo: ${p} • ${list.length} pays`
      : `Pseudo: ${p} • 0 pays (ou inconnu)`;
  } else {
    userInfoEl.textContent = "Mode: Communauté + Pseudo";
  }
}

async function fetchState(){
  if (!API_URL || API_URL.includes("PUT_YOUR_")){
    statsEl.textContent = "API_URL non configurée (colle l’URL Apps Script dans overlay.js).";
    return;
  }
  try{
    const res = await fetch(`${API_URL}?route=state`, { cache: "no-store" });
    const data = await res.json();
    if (data && data.ok){
      state = data;
      setStats();
      render();
    } else {
      statsEl.textContent = "Erreur state.";
    }
  } catch(e){
    statsEl.textContent = "Erreur réseau / URL API incorrecte.";
  }
}

async function initMap(){
  // Load topojson and draw the world map
  const topo = await fetch(TOPOJSON_URL, { cache: "no-store" }).then(r => r.json());
  const geo = topojson.feature(topo, topo.objects.countries);
  geoFeatures = geo.features;

  // Projection and path
  const projection = d3.geoNaturalEarth1()
    .fitSize([1200, 620], geo);

  const path = d3.geoPath(projection);

  // Draw
  svg.selectAll("path.country")
    .data(geoFeatures)
    .enter()
    .append("path")
    .attr("class", "country")
    .attr("d", path)
    .each(function(d){
      const name = d?.properties?.name;
      if (typeof name === "string" && name.trim()){
        byName.set(name.trim(), d3.select(this));
      }
    });

  // Hover tooltip (simple, via title)
  svg.selectAll("path.country")
    .append("title")
    .text(d => d?.properties?.name || "");

  // Start polling
  await fetchState();
  setInterval(fetchState, REFRESH_MS);

  // Search render
  searchEl.addEventListener("input", render);
}

initMap().catch(() => {
  statsEl.textContent = "Impossible de charger la carte (CDN).";
});

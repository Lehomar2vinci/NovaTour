const API_URL = "https://script.google.com/macros/s/AKfycbzQTDDOX-KYHfHDNpLYDRlBDxaFPb7SjsAPiMzEWl3l3JMQXdQ8agk5_jKMlsweLo--wA/exec";

// Sources carte (gratuits)
const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Refresh overlay
const REFRESH_MS = 7000;

// DOM
const svg = d3.select("#map");
const statsEl = document.getElementById("stats");
const searchEl = document.getElementById("search");
const userInfoEl = document.getElementById("userInfo");

let state = { globalCountries: [], byUser: {}, updatedAt: 0 };

// Projection (Mercator)
const projection = d3.geoMercator()
  .scale(300)
  .translate([960, 580]);

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
  const arr = (state.byUser && state.byUser[pseudo]) ? state.byUser[pseudo] : [];
  userInfoEl.textContent = `Pseudo: ${pseudo} • ${arr.length} pays`;
}

async function fetchState() {
  try {
    const res = await fetch(`${API_URL}?route=state`, { cache: "no-store" });
    const data = await res.json();
    if (data && data.ok) {
      state = data;
      setStats();
      paint();
    } else {
      statsEl.textContent = "Erreur state.";
    }
  } catch (e) {
    statsEl.textContent = "Erreur réseau / API_URL.";
  }
}

/**
 * IMPORTANT:
 * World-atlas "countries-110m" contient des pays en TopoJSON,
 * mais n’expose pas directement ISO2. Il utilise des IDs numériques (Natural Earth).
 * Donc pour colorier "FR/JP/US" il faut une table de correspondance ID->ISO.
 *
 * Pour rester simple, on va fonctionner en mode "global count + affichage carte"
 * (carte visible), et on ajoutera la coloration ISO2 dans l’étape suivante via un
 * mapping (je te le fournis ensuite).
 */
let features = [];

async function loadMap() {
  const topo = await fetch(WORLD_ATLAS_URL).then(r => r.json());
  features = topojson.feature(topo, topo.objects.countries).features;

  // Dessin initial
  svg.append("g")
    .attr("id", "countries")
    .selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "country")
    .attr("d", path);

  // Positionnement propre
  // (Optionnel) ajuster la projection automatiquement:
  fitProjection();

  // Premier fetch + interval
  await fetchState();
  setInterval(fetchState, REFRESH_MS);
}

function fitProjection() {
  // Fit to SVG
  const bounds = d3.geoBounds({ type: "FeatureCollection", features });
  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];
  const x = (bounds[0][0] + bounds[1][0]) / 2;
  const y = (bounds[0][1] + bounds[1][1]) / 2;

  const scale = 0.90 / Math.max(dx / 1920, dy / 1080);
  const translate = [1920 / 2 - scale * x, 1080 / 2 - scale * y];

  projection.scale(scale).translate(translate);

  svg.selectAll("path.country").attr("d", path);
}

function paint() {
  // Pour l’instant : on montre la carte, et le HUD fonctionne.
  // La coloration ISO2 demande une table de correspondance.
  const pseudo = normalizePseudo(searchEl.value);
  setUserInfo(isValidPseudo(pseudo) ? pseudo : "");
}

searchEl.addEventListener("input", () => paint());

loadMap().catch(err => {
  statsEl.textContent = "Erreur chargement carte (CDN).";
  console.error(err);
});

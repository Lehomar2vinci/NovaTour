/**
 * Viewer World Map - submit.js
 * - Loads country names from world-atlas TopoJSON (countries-110m)
 * - Viewer selects a country by name and sends add/remove to Apps Script
 */

// 1) PUT your Apps Script Web App URL here (ends with /exec)
const API_URL = "PUT_YOUR_APPS_SCRIPT_WEBAPP_URL_HERE";

// 2) Data source for the full list of countries (TopoJSON)
const TOPOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const pseudoEl = document.getElementById("pseudo");
const countrySearchEl = document.getElementById("countrySearch");
const countryListEl = document.getElementById("countryList");
const countriesMetaEl = document.getElementById("countriesMeta");
const statusEl = document.getElementById("status");

let countryNames = []; // canonical list of names from dataset
let countrySet = new Set();

function setStatus(msg, kind=""){
  statusEl.className = "status" + (kind ? " " + kind : "");
  statusEl.textContent = msg;
}

function normalizePseudo(p){ return (p || "").trim().toLowerCase(); }
function isValidPseudo(p){ return /^[a-z0-9_]{3,25}$/.test(p); }

function normalizeCountryName(name){
  return (name || "").trim();
}

function isValidCountryName(name){
  const n = normalizeCountryName(name);
  return n.length > 0 && n.length <= 80 && countrySet.has(n);
}

async function loadCountries(){
  try{
    const topo = await fetch(TOPOJSON_URL, { cache: "no-store" }).then(r => r.json());
    const geo = topojson.feature(topo, topo.objects.countries);

    const names = [];
    for (const f of geo.features){
      const n = f?.properties?.name;
      if (typeof n === "string" && n.trim()){
        names.push(n.trim());
      }
    }

    // unique + sort
    countryNames = Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b, "fr", { sensitivity:"base" }));
    countrySet = new Set(countryNames);

    // populate datalist
    countryListEl.innerHTML = "";
    for (const n of countryNames){
      const opt = document.createElement("option");
      opt.value = n;
      countryListEl.appendChild(opt);
    }

    countriesMetaEl.textContent = `Liste chargée: ${countryNames.length} entités.`;
    setStatus("Prêt.", "");
  } catch(e){
    countriesMetaEl.textContent = "Impossible de charger la liste des pays (réseau/CDN).";
    setStatus("Erreur: impossible de charger la carte (CDN).", "err");
  }
}

async function sendUpdate(action){
  const pseudo = normalizePseudo(pseudoEl.value);
  const countryName = normalizeCountryName(countrySearchEl.value);

  if (!isValidPseudo(pseudo)){
    setStatus("Pseudo invalide (3–25, lettres/chiffres/_).", "err");
    return;
  }
  if (!isValidCountryName(countryName)){
    setStatus("Pays invalide. Choisis un pays depuis la liste (auto-complétion).", "err");
    return;
  }
  if (!API_URL || API_URL.includes("PUT_YOUR_")){
    setStatus("API_URL non configurée (colle l’URL Apps Script dans submit.js).", "err");
    return;
  }

  setStatus("Envoi…", "");
  try{
    const res = await fetch(`${API_URL}?route=update`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // compatible Apps Script
      body: JSON.stringify({ pseudo, countryName, action })
    });
    const data = await res.json();
    if (!data.ok){
      if (data.error === "RATE_LIMIT") setStatus(`Trop rapide 🙂 Réessaie dans ${data.retryAfterSec}s.`, "err");
      else if (data.error === "LOCKED") setStatus("Contributions fermées (LOCK).", "err");
      else if (data.error === "BANNED") setStatus("Pseudo bloqué.", "err");
      else setStatus(`Erreur: ${data.error || "UNKNOWN"}`, "err");
      return;
    }
    setStatus(action === "add" ? "Ajouté ✅" : "Retiré ✅", "ok");
  } catch(e){
    setStatus("Erreur réseau / URL API incorrecte.", "err");
  }
}

document.getElementById("addBtn").addEventListener("click", ()=>sendUpdate("add"));
document.getElementById("removeBtn").addEventListener("click", ()=>sendUpdate("remove"));

loadCountries();

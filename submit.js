
function getApiUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  if (fromQuery) {
    localStorage.setItem("api_url", fromQuery);
    return fromQuery;
  }
  return localStorage.getItem("api_url") || "";
}

const API_URL = getApiUrl();

const pseudoEl = document.getElementById("pseudo");
const countryEl = document.getElementById("country");
const statusEl = document.getElementById("status");

function setStatus(msg, kind = "") {
  statusEl.className = "status" + (kind ? " " + kind : "");
  statusEl.textContent = msg;
}

function normalizePseudo(p) {
  return (p || "").trim().toLowerCase();
}
function isValidPseudo(p) {
  return /^[a-z0-9_]{3,25}$/.test(p);
}

// Si API_URL manquante, on le demande une fois
if (!API_URL) {
  const entered = prompt(
    "Colle l’URL Apps Script Web App (…/exec) :\n\nEx: https://script.google.com/macros/s/XXXX/exec"
  );
  if (entered) {
    localStorage.setItem("api_url", entered.trim());
    location.reload();
  } else {
    setStatus("API non configurée. Ajoute ?api=.../exec à l’URL ou recharge et colle l’API.", "err");
  }
}

async function sendUpdate(action) {
  const pseudo = normalizePseudo(pseudoEl.value);
  const country = countryEl.value;

  if (!isValidPseudo(pseudo)) {
    setStatus("Pseudo invalide (3–25, lettres/chiffres/_).", "err");
    return;
  }
  if (!API_URL) {
    setStatus("API non configurée.", "err");
    return;
  }

  setStatus("Envoi...", "");
  try {
    const res = await fetch(`${API_URL}?route=update`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // compatible GAS
      body: JSON.stringify({ pseudo, country, action })
    });
    const data = await res.json();

    if (!data.ok) {
      if (data.error === "RATE_LIMIT") {
        setStatus(`Trop rapide 🙂 Réessaie dans ${data.retryAfterSec}s.`, "err");
      } else if (data.error === "LOCKED") {
        setStatus("Contributions fermées (LOCK).", "err");
      } else if (data.error === "BANNED") {
        setStatus("Pseudo bloqué.", "err");
      } else {
        setStatus(`Erreur: ${data.error || "UNKNOWN"}`, "err");
      }
      return;
    }

    setStatus(action === "add" ? "Ajouté ✅" : "Retiré ✅", "ok");
  } catch (e) {
    setStatus("Erreur réseau / URL API incorrecte.", "err");
  }
}

document.getElementById("addBtn").addEventListener("click", () => sendUpdate("add"));
document.getElementById("removeBtn").addEventListener("click", () => sendUpdate("remove"));

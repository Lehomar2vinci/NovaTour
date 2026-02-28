# Viewer World Map (100% gratuit)

Ce pack donne une solution **web** où les viewers indiquent les pays visités, et tu affiches en stream une carte :
- **Mode A** : carte globale (communauté)
- **Mode C** : recherche pseudo => surlignage des pays de ce viewer

##  à faire : Hébergement (gratuit)
- Front: **GitHub Pages**
- Backend: **Google Sheets + Google Apps Script** (Web App)

## Ce que contient ce dossier
- `submit.html` + `submit.js` : page viewers
- `overlay.html` + `overlay.js` : page overlay OBS
- `styles.css` : styles communs
- `backend/apps_script.js` : le script Apps Script à coller dans Google Apps Script

## à faire : Créer le Google Sheet
Créer un Google Sheet avec 4 onglets :
- `visits` : timestamp | pseudo | countryName | action
- `rate_limit` : pseudo | lastTs
- `bans` : pseudo
- `settings` : A1=LOCK, B1=FALSE (mets TRUE pour verrouiller)

## à faire : Déployer l’Apps Script
Dans le Sheet: Extensions → Apps Script → coller `backend/apps_script.js`
Puis Déployer → Nouveau déploiement → **Application Web**
- Exécuter en tant que: toi
- Accès: tout le monde

Copie l’URL du Web App (se termine par `/exec`).

##  Configurer le front
Dans `submit.js` et `overlay.js`, remplacer:
- `API_URL = "PUT_YOUR_APPS_SCRIPT_WEBAPP_URL_HERE"`

## encore et toujours à faire : GitHub Pages
Mettre ces fichiers à la racine d’un repo:
- `submit.html`, `submit.js`, `overlay.html`, `overlay.js`, `styles.css`

Settings → Pages → Deploy from branch → main / root.

## enfin indéniablement à faire : OBS
Ajouter une source “Navigateur”:
- URL: `https://<toncompte>.github.io/<tonrepo>/overlay.html`

## Et Données cartographiques
La carte utilise `topojson/world-atlas` (TopoJSON dérivé de Natural Earth) via CDN jsDelivr.

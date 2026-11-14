// Interface de l'application : 6 écrans autour du moteur (moteur.js).
// Les calculs (binaires et plan) viennent du moteur ; ce fichier ne fait qu'afficher et régler.
import GLPK from "https://cdn.jsdelivr.net/npm/glpk.js@4.0.2/dist/index.js";
import { calculerBinaires, calculerPlan, synthese, CLASSES } from "./moteur.js";

const CLE_STOCKAGE = "outil-classes-scenario";
const LIBELLES = { urgence: "Urgence", surcharge: "Surcharge", vigilance: "Vigilance", stable: "Stable", donneuse: "Donneuse" };
const LETTRES = { urgence: "U", surcharge: "S", vigilance: "V", stable: "·", donneuse: "D" };
const EXPLICATIONS = {
  urgence: "surcharge et signal de crise",
  surcharge: "surcharge sans signal de crise",
  vigilance: "plus de 50 élèves par maître et signal de crise",
  stable: "ni surcharge ni crise",
  donneuse: "peut céder des enseignants",
};
const PLAFONDS = [40, 45, 50, 55, 60, 65, 70];

const etat = { donnees: null, reference: null, p: null, binaires: [], plan: [], glpk: null, graphes: {}, calcul: 0 };
const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat("fr-FR");
const fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : nf.format(Math.round(x * 10 ** d) / 10 ** d));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// « CENTRE-NORD » -> « Centre-Nord », « BOUCLE DU MOUHOUN » -> « Boucle du Mouhoun »
const PETITS = new Set(["du", "de", "des", "la", "le"]);
const titre = (s) => String(s).toLowerCase().replace(/[a-zàâçéèêëîïôûùüÿ]+/g, (m, i) => (i > 0 && PETITS.has(m) ? m : m.charAt(0).toUpperCase() + m.slice(1)));

// ---------- démarrage ----------
async function demarrer() {
  const lire = (f) => fetch(`data/${f}`).then((r) => r.json());
  const [donnees, reference, geo] = await Promise.all([lire("donnees.json"), lire("parametres.json"), lire("provinces.geojson")]);
  etat.donnees = donnees;
  etat.reference = reference;
  etat.geo = geo;
  etat.p = chargerScenario() ?? structuredClone(reference);
  installerTheme();
  installerOnglets();
  installerCarte();
  installerFrise();
  installerReglages();
  installerFiche();
  ecrireMethode();
  recalculerBinaires();
  installerSimulateur();
  lireAdresse();
  etat.glpk = await GLPK();
  await recalculerPlan();
}

function chargerScenario() {
  try { const s = localStorage.getItem(CLE_STOCKAGE); return s ? JSON.parse(s) : null; } catch { return null; }
}
function sauverScenario() {
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat.p)); } catch { /* stockage indisponible */ }
}

function installerTheme() {
  $("#theme").addEventListener("click", () => {
    const sombre = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = sombre ? "light" : "dark";
    toutRedessiner();
  });
}

// Onglets ; l'adresse garde l'écran ouvert (#simulateur, #fiche-LOROUM…) pour partager un lien.
function installerOnglets() {
  document.querySelectorAll("[data-ecran]").forEach((b) => b.addEventListener("click", () => montrer(b.dataset.ecran)));
  addEventListener("hashchange", lireAdresse);
}
function montrer(ecran) {
  document.querySelectorAll("[data-ecran]").forEach((x) => x.setAttribute("aria-selected", x.dataset.ecran === ecran));
  document.querySelectorAll(".ecran").forEach((e) => { e.hidden = e.id !== `ecran-${ecran}`; });
  if (!location.hash.startsWith(`#${ecran}`)) history.replaceState(null, "", `#${ecran}`);
  if (ecran === "situation") etat.carte?.invalidateSize();
}
function lireAdresse() {
  const [ecran, province] = location.hash.slice(1).split("-");
  if (!document.getElementById(`ecran-${ecran}`)) return;
  if (ecran === "fiche" && province && etat.donnees.provinces.some((p) => p.nom === province)) {
    $("#fiche-province").value = province;
    dessinerFiche();
  }
  montrer(ecran);
}

function toutRedessiner() {
  dessinerCarte();
  dessinerGrapheEnseignants();
  dessinerFrise();
  dessinerPlan();
  dessinerFiche();
  if (etat.courbe) dessinerCourbe(etat.courbe);
}

// ---------- binaires ----------
function recalculerBinaires() {
  etat.binaires = calculerBinaires(etat.donnees, etat.p);
  etat.parCle = Object.fromEntries(etat.binaires.map((l) => [`${l.annee}|${l.province}`, l]));
  dessinerTuiles();
  dessinerCarte();
  dessinerGrapheEnseignants();
  dessinerListePriorites();
  dessinerFrise();
  dessinerReglages();
  dessinerFiche();
}

// ---------- 1. la situation ----------
function dessinerTuiles() {
  const d = etat.donnees, a0 = d.annees_historique[0], a1 = d.annees_historique.at(-1);
  const n0 = d.national[a0], n1 = d.national[a1];
  const var_ = (x, y) => `${y >= x ? "+" : ""}${fmt((100 * (y - x)) / x)} % depuis ${a0}`;
  const urg = (a) => etat.binaires.filter((l) => l.annee === a && l.priorite === "urgence").length;
  $("#tuiles").innerHTML = [
    ["Enseignants du primaire public", fmt(n1.enseignants_total), var_(n0.enseignants_total, n1.enseignants_total)],
    ["Enseignants devant une classe", fmt(n1.maitres), var_(n0.maitres, n1.maitres)],
    ["Suppléants (redéployables)", fmt(n1.suppleants), var_(n0.suppleants, n1.suppleants)],
    [`Provinces en urgence en ${a1}`, fmt(urg(a1)), `${fmt(urg(a0))} en ${a0}`],
  ].map(([l, v, e]) => `<div class="tuile"><div class="libelle">${l}</div><div class="valeur">${v}</div><div class="ecart">${e}</div></div>`).join("");
}

function installerCarte() {
  etat.carte = L.map("carte", { zoomSnap: 0.25, attributionControl: false, scrollWheelZoom: false });
  etat.couche = L.geoJSON(etat.geo, {
    style: () => ({ weight: 1, color: css("--surface"), fillOpacity: 0.95 }),
    onEachFeature: (f, couche) => couche.on("click", () => ouvrirFiche(f.properties.province_ancienne.replace("KOMANDJARI", "KOMONDJARI"))),
  }).addTo(etat.carte);
  etat.carte.fitBounds(etat.couche.getBounds(), { padding: [8, 8] });
  const curseur = $("#annee-carte");
  curseur.max = etat.donnees.annees_historique.length - 1;
  curseur.value = curseur.max;
  curseur.addEventListener("input", () => { dessinerCarte(); dessinerListePriorites(); });
  $("#legende-carte").innerHTML = CLASSES.map((c) =>
    `<span><i class="pastille c-${c}">${LETTRES[c]}</i>${LIBELLES[c]} : ${EXPLICATIONS[c]}</span>`).join("");
}

function anneeCarte() { return etat.donnees.annees_historique[+$("#annee-carte").value]; }

function dessinerCarte() {
  if (!etat.couche) return;
  const a = anneeCarte();
  $("#annee-carte-txt").textContent = a;
  etat.couche.eachLayer((couche) => {
    const nom = couche.feature.properties.province_ancienne.replace("KOMANDJARI", "KOMONDJARI");
    const l = etat.parCle?.[`${a}|${nom}`];
    const prov = etat.donnees.provinces.find((p) => p.nom === nom);
    const h = prov?.historique[a];
    couche.setStyle({ fillColor: l ? css(`--${l.priorite}`) : css("--non"), color: css("--surface") });
    couche.bindTooltip(l
      ? `<b>${titre(nom)}</b> (${titre(prov.region_ancienne)})<br>${LIBELLES[l.priorite]}<br>${fmt(h.eleves_par_maitre, 1)} élèves par maître · ${fmt(h.eleves_par_salle, 1)} par salle${l.correction ? `<br><i>Correction : ${esc(l.correction)}</i>` : ""}`
      : `<b>${titre(nom)}</b><br>Pas de données en ${a}`, { sticky: true });
  });
}

function dessinerListePriorites() {
  const a = anneeCarte();
  const groupes = CLASSES.slice(0, 3).map((c) => {
    const l = etat.binaires.filter((x) => x.annee === a && x.priorite === c).sort((x, y) => y.ecart_plafond - x.ecart_plafond);
    return `<p><i class="pastille c-${c}">${LETTRES[c]}</i> <b>${LIBELLES[c]} (${l.length})</b> : ${l.map((x) => titre(x.province)).join(", ") || "aucune"}</p>`;
  });
  const liste = new Set(etat.donnees.provinces.filter((p) => p.zone_officielle).map((p) => p.nom));
  const besoin = new Set(etat.binaires.filter((x) => x.annee === a && ["urgence", "surcharge", "vigilance"].includes(x.priorite)).map((x) => x.province));
  const oubliees = [...besoin].filter((x) => !liste.has(x)).map(titre);
  const sansBesoin = [...liste].filter((x) => !besoin.has(x)).map(titre);
  $("#liste-priorites").innerHTML = `<h3>Provinces à surveiller en ${a}</h3>${groupes.join("")}
    <p class="note">Comparaison avec la liste officielle des 19 provinces « à fort défi sécuritaire » : besoin réel hors liste : ${oubliees.join(", ") || "aucune"} ; dans la liste sans besoin fort cette année : ${sansBesoin.join(", ") || "aucune"}.</p>`;
}

function optionsGraphe(axeY) {
  const texte = css("--texte-2"), grille = css("--grille");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "top", align: "start", labels: { color: texte, boxWidth: 12, boxHeight: 12 } },
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` } } },
    scales: {
      x: { ticks: { color: texte }, grid: { display: false }, border: { color: css("--axe") } },
      y: { beginAtZero: true, title: { display: !!axeY, text: axeY, color: texte }, ticks: { color: texte, callback: (v) => fmt(v) }, grid: { color: grille }, border: { display: false } },
    },
  };
}

function graphe(id, config) {
  etat.graphes[id]?.destroy();
  etat.graphes[id] = new Chart(document.getElementById(id), config);
}

function dessinerGrapheEnseignants() {
  const d = etat.donnees, a = d.annees_historique;
  graphe("g-enseignants", { type: "line", data: { labels: a, datasets: [
    { label: "Enseignants du public", data: a.map((x) => d.national[x].enseignants_total), borderColor: css("--serie-1"), backgroundColor: css("--serie-1"), borderWidth: 2, pointRadius: 4 },
    { label: "Dont devant une classe", data: a.map((x) => d.national[x].maitres), borderColor: css("--serie-2"), backgroundColor: css("--serie-2"), borderWidth: 2, pointRadius: 4 },
  ] }, options: optionsGraphe("enseignants") });
}

// ---------- 2. la frise ----------
function installerFrise() {
  $("#frise-variable").addEventListener("change", dessinerFrise);
  document.addEventListener("pointermove", (e) => {
    const td = e.target.closest?.("td[data-info]");
    const bulle = $("#infobulle");
    if (!td) { bulle.hidden = true; return; }
    bulle.innerHTML = td.dataset.info;
    bulle.hidden = false;
    bulle.style.left = `${Math.min(e.clientX + 14, innerWidth - 310)}px`;
    bulle.style.top = `${e.clientY + 14}px`;
  });
}

function dessinerFrise() {
  if (!etat.binaires.length) return;
  const choix = $("#frise-variable"), courant = choix.value || "priorite";
  choix.innerHTML = `<option value="priorite">Classe de priorité</option>` +
    Object.entries(etat.p.variables).map(([c, v]) => `<option value="${c}">${c} : ${esc(v.nom)}</option>`).join("");
  choix.value = courant in etat.p.variables || courant === "priorite" ? courant : "priorite";
  const v = choix.value, annees = etat.donnees.annees_historique;
  $("#legende-frise").innerHTML = v === "priorite"
    ? CLASSES.map((c) => `<span><i class="pastille c-${c}">${LETTRES[c]}</i>${LIBELLES[c]}</span>`).join("")
    : `<span><i class="pastille c-oui">1</i>oui : ${esc(etat.p.variables[v].explication ?? etat.p.variables[v].nom)}</span><span><i class="pastille c-non">0</i>non</span>`;
  const regions = [...new Set(etat.donnees.provinces.map((p) => p.region_ancienne))].sort();
  let html = `<thead><tr><th></th>${annees.map((a) => `<th>${a.slice(2, 4)}-${a.slice(7)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of regions) {
    html += `<tr><th class="region" colspan="${annees.length + 1}">${titre(r)}</th></tr>`;
    for (const prov of etat.donnees.provinces.filter((p) => p.region_ancienne === r)) {
      html += `<tr><th>${titre(prov.nom)}</th>`;
      for (const a of annees) {
        const l = etat.parCle[`${a}|${prov.nom}`];
        if (!l) { html += `<td class="vide" data-info="${esc(titre(prov.nom))}, ${a} : pas de données">–</td>`; continue; }
        const h = prov.historique[a];
        const vars = Object.keys(etat.p.variables).map((c) => `${c} ${l[c]}`).join(" · ");
        const info = `<b>${esc(titre(prov.nom))}, ${a}</b><br>${LIBELLES[l.priorite]}<br>${fmt(h.eleves_par_maitre, 1)} élèves par maître (plafond ${l.plafond})<br>${vars}${l.correction ? `<br><i>${esc(l.correction)}</i>` : ""}`;
        html += v === "priorite"
          ? `<td class="c-${l.priorite}" data-info="${esc(info)}">${LETTRES[l.priorite]}</td>`
          : `<td class="c-${l[v] ? "oui" : "non"}" data-info="${esc(info)}">${l[v]}</td>`;
      }
      html += "</tr>";
    }
  }
  $("#frise").innerHTML = `${html}</tbody>`;
}

// ---------- 3. le simulateur ----------
function installerSimulateur() {
  const ap = etat.donnees.annees_projection;
  for (const id of ["plafond-1", "plafond-2", "plafond-3"]) $(`#${id}`).innerHTML = PLAFONDS.map((x) => `<option>${x}</option>`).join("");
  $("#df-fin").innerHTML = ap.map((a) => `<option value="${a}">${a}</option>`).join("");
  $("#plan-annee").innerHTML = ap.map((a) => `<option>${a}</option>`).join("");
  lireScenarioDansCommandes();
  let minuterie;
  $("#commandes").addEventListener("input", () => {
    afficherValeurs();
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { ecrireCommandesDansScenario(); recalculerPlan(); }, 450);
  });
  $("#plan-annee").addEventListener("change", dessinerPlan);
  $("#bouton-courbe").addEventListener("click", tracerCourbe);
  $("#export-plan").addEventListener("click", exporterPlan);
}

function lireScenarioDansCommandes() {
  const p = etat.p, ap = etat.donnees.annees_projection, b = p.budgets_par_annee.defaut;
  $("#argent").value = b.argent_salles_fcfa / 1e9;
  $("#postes").value = b.postes_nouveaux_enseignants;
  $("#respect").value = p.taux_respect_affectation_pct;
  $("#reserve").value = p.reserve_suppleants_pct;
  $("#plafond-1").value = p.plafond_par_annee[ap[0]];
  $("#plafond-2").value = p.plafond_par_annee[ap[2]];
  $("#plafond-3").value = p.plafond_par_annee[ap[4]];
  const lev = p.leviers_par_annee;
  $("#df").checked = lev.defaut.double_flux;
  const interdit = ap.find((a) => lev[a]?.double_flux === false);
  $("#df-fin").value = interdit ? ap[Math.max(0, ap.indexOf(interdit) - 1)] : ap.at(-1);
  $("#df-fermetures").checked = lev.defaut.double_flux_si_fermetures;
  $("#cout-eta").value = p.couts.eta_fcfa / 1e6;
  $("#cout-dur").value = p.couts.salle_dur_fcfa / 1e6;
  afficherValeurs();
}

function afficherValeurs() {
  const v = (id) => +$(`#${id}`).value;
  const textes = {
    argent: `${fmt(v("argent"), 1)} milliards FCFA`, postes: fmt(v("postes")), respect: `${v("respect")} %`,
    reserve: `${v("reserve")} %`, "cout-eta": `${fmt(v("cout-eta"), 1)} M FCFA`, "cout-dur": `${fmt(v("cout-dur"), 1)} M FCFA`,
  };
  for (const [k, t] of Object.entries(textes)) document.querySelector(`output[data-pour="${k}"]`).textContent = t;
  $("#df-fin").disabled = !$("#df").checked;
}

function ecrireCommandesDansScenario() {
  const p = etat.p, ap = etat.donnees.annees_projection, v = (id) => +$(`#${id}`).value;
  p.budgets_par_annee = { ...p.budgets_par_annee, defaut: { argent_salles_fcfa: v("argent") * 1e9, postes_nouveaux_enseignants: v("postes") } };
  for (const a of ap) delete p.budgets_par_annee[a];
  p.taux_respect_affectation_pct = v("respect");
  p.reserve_suppleants_pct = v("reserve");
  ap.forEach((a, i) => { p.plafond_par_annee[a] = v(`plafond-${1 + Math.floor(i / 2)}`); });
  const defaut = { ...p.leviers_par_annee.defaut, double_flux: $("#df").checked, double_flux_si_fermetures: $("#df-fermetures").checked };
  p.leviers_par_annee = { defaut };
  const fin = ap.indexOf($("#df-fin").value);
  if ($("#df").checked && fin < ap.length - 1) p.leviers_par_annee[ap[fin + 1]] = { double_flux: false };
  p.couts = { ...p.couts, eta_fcfa: v("cout-eta") * 1e6, salle_dur_fcfa: v("cout-dur") * 1e6 };
  sauverScenario();
}

async function recalculerPlan() {
  if (!etat.glpk) return;
  const numero = ++etat.calcul;
  $("#etat-calcul").textContent = "Calcul du plan…";
  const t0 = performance.now();
  const r = await calculerPlan(etat.donnees, etat.p, etat.binaires, etat.glpk);
  if (numero !== etat.calcul) return;   // un calcul plus récent est en cours
  etat.plan = r.plan;
  $("#etat-calcul").textContent = `Plan ${r.statut}, calculé en ${fmt((performance.now() - t0) / 1000, 1)} s.`;
  dessinerPlan();
  dessinerFiche();
}

function dessinerPlan() {
  if (!etat.plan.length) return;
  const s = synthese(etat.plan), ap = etat.donnees.annees_projection;
  const tot = (k) => s.reduce((x, l) => x + l[k], 0);
  const premiere = s[0], derniere = s.at(-1);
  $("#tuiles-plan").innerHTML = [
    ["Élèves en surnombre la 1re année", fmt(premiere.surnombre_avec_plan), `${fmt(premiere.surnombre_sans_action)} sans action`],
    ["Élèves en surnombre en " + derniere.annee, fmt(derniere.surnombre_avec_plan), `${fmt(derniere.surnombre_sans_action)} sans action`],
    ["Baisse du surnombre sur 6 ans", `${fmt(100 - (100 * tot("surnombre_avec_plan")) / Math.max(1, tot("surnombre_sans_action")))} %`, `${fmt(tot("surnombre_sans_action"))} élèves-années sans action`],
    ["Dépense pour les salles, 6 ans", `${fmt(tot("cout_salles_fcfa") / 1e9, 1)} Md FCFA`, `${fmt(tot("eta"))} ETA, ${fmt(tot("salles_dur"))} salles en dur`],
  ].map(([l, v, e]) => `<div class="tuile"><div class="libelle">${l}</div><div class="valeur">${v}</div><div class="ecart">${e}</div></div>`).join("");

  graphe("g-surnombre", { type: "bar", data: { labels: ap, datasets: [
    { label: "Sans action", data: s.map((l) => l.surnombre_sans_action), backgroundColor: css("--sans-action"), borderRadius: 4, maxBarThickness: 28 },
    { label: "Avec le plan", data: s.map((l) => l.surnombre_avec_plan), backgroundColor: css("--serie-1"), borderRadius: 4, maxBarThickness: 28 },
  ] }, options: optionsGraphe("élèves en surnombre") });

  const lignes = [["Année", "Élèves", "Plafond", "Suppléants devant une classe", "Recrues", "ETA", "Salles en dur", "Classes en double flux", "Provinces au-dessus du plafond", "Dépense (Md FCFA)"]];
  s.forEach((l) => lignes.push([l.annee, fmt(l.eleves), etat.p.plafond_par_annee[l.annee], fmt(l.suppleants), fmt(l.recrues), fmt(l.eta), fmt(l.salles_dur), fmt(l.double_flux), `${l.provinces_avec_plan} (${l.provinces_sans_action} sans action)`, fmt(l.cout_salles_fcfa / 1e9, 2)]));
  $("#t-moyens").innerHTML = tableauHtml(lignes);

  const a = $("#plan-annee").value || ap[0];
  const lp = etat.plan.filter((l) => l.annee === a).sort((x, y) => y.surnombre_sans_action - x.surnombre_sans_action);
  const t = [["Province", "Région (ancienne)", "Élèves", "Élèves par classe sans action", "avec le plan", "Classes en plus", "Suppléants", "Recrues de l'année", "ETA", "Salles en dur", "Double flux"]];
  lp.forEach((l) => t.push([titre(l.province), titre(l.region), fmt(l.eleves), fmt(l.eleves_par_classe_sans_action, 1), fmt(l.eleves_par_classe_avec_plan, 1), fmt(l.classes_supplementaires), fmt(l.suppleants), fmt(l.recrues), fmt(l.eta), fmt(l.salles_dur), fmt(l.double_flux)]));
  $("#t-plan").innerHTML = tableauHtml(t);
}

function tableauHtml(lignes) {
  const [tete, ...corps] = lignes;
  return `<thead><tr>${tete.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${corps.map((l) => `<tr>${l.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

async function tracerCourbe() {
  const bouton = $("#bouton-courbe");
  bouton.disabled = true;
  const niveaux = [0, 1, 2, 5, 10, 15, 20, 30], points = [];
  for (const m of niveaux) {
    $("#etat-calcul").textContent = `Courbe : calcul avec ${m} milliards par an…`;
    const r = await calculerPlan(etat.donnees, etat.p, etat.binaires, etat.glpk, { argent: m * 1e9 });
    points.push({ m, surnombre: r.plan.reduce((s, l) => s + l.surnombre_avec_plan, 0), sans: r.plan.reduce((s, l) => s + l.surnombre_sans_action, 0) });
  }
  etat.courbe = points;
  dessinerCourbe(points);
  $("#etat-calcul").textContent = "Courbe tracée.";
  bouton.disabled = false;
}

function dessinerCourbe(points) {
  $("#bloc-courbe").hidden = false;
  graphe("g-courbe", { type: "line", data: { labels: points.map((x) => `${x.m} Md`), datasets: [
    { label: "Élèves en surnombre sur 6 ans, avec le plan", data: points.map((x) => x.surnombre), borderColor: css("--serie-1"), backgroundColor: css("--serie-1"), borderWidth: 2, pointRadius: 5 },
  ] }, options: { ...optionsGraphe("élèves-années en surnombre"), plugins: { ...optionsGraphe().plugins, legend: { display: false } } } });
  const sans = points[0].sans, zero = points[0].surnombre;
  $("#note-courbe").textContent = `Sans action : ${fmt(sans)} élèves-années en surnombre. Sans dépenser pour les salles (suppléants et double flux seulement), la baisse est déjà de ${fmt(100 - (100 * zero) / sans)} %. Chaque milliard supplémentaire rapporte ensuite de moins en moins.`;
}

function exporterPlan() {
  const cols = Object.keys(etat.plan[0]);
  const csv = [cols.join(";"), ...etat.plan.map((l) => cols.map((c) => l[c]).join(";"))].join("\n");
  telecharger(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), "plan_classes_2025_2031.csv");
}

function telecharger(blob, nom) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 4. les réglages ----------
function installerReglages() {
  const d = etat.donnees;
  const annees = d.annees_historique.map((a) => `<option>${a}</option>`).join("");
  $("#pa-annee").innerHTML = annees;
  $("#c-annee").innerHTML = annees;
  $("#c-annee").value = d.annees_historique.at(-1);
  $("#c-province").innerHTML = d.provinces.map((p) => `<option value="${p.nom}">${titre(p.nom)}</option>`).join("");
  const indicateurs = [...Object.keys(d.provinces[0].historique[d.annees_historique.at(-1)]), "croissance_6_11_relative", "zone_officielle"];
  $("#v-indicateur").innerHTML = indicateurs.map((x) => `<option>${x}</option>`).join("");

  $("#pa-ajouter").addEventListener("click", () => {
    const a = $("#pa-annee").value, v = $("#pa-variable").value;
    const ch = $("#pa-action").value === "retirer" ? { actif: false } : { seuil: +$("#pa-seuil").value };
    etat.p.par_annee = { ...etat.p.par_annee, [a]: { ...(etat.p.par_annee?.[a] ?? {}), [v]: { ...(etat.p.par_annee?.[a]?.[v] ?? {}), ...ch } } };
    appliquerReglages();
  });
  $("#c-ajouter").addEventListener("click", () => {
    const j = $("#c-justification").value.trim(), au = $("#c-auteur").value.trim();
    if (!j || !au) { alert("Merci d'indiquer la justification et l'auteur : chaque correction doit être traçable."); return; }
    etat.p.corrections = [...(etat.p.corrections ?? []).filter((c) => c.province !== "EXEMPLE"),
      { annee: $("#c-annee").value, province: $("#c-province").value, variable: $("#c-variable").value, valeur: +$("#c-valeur").value, justification: j, auteur: au }];
    appliquerReglages();
  });
  $("#v-ajouter").addEventListener("click", () => {
    const code = $("#v-code").value.trim().toUpperCase();
    if (!code || code in etat.p.variables || $("#v-seuil").value === "") { alert("Indiquez un code nouveau et un seuil."); return; }
    etat.p.variables[code] = { nom: $("#v-nom").value.trim() || code, role: $("#v-role").value, actif: true,
      conditions: [{ indicateur: $("#v-indicateur").value, op: $("#v-op").value, seuil: +$("#v-seuil").value }],
      explication: `${$("#v-indicateur").value} ${$("#v-op").value} ${$("#v-seuil").value} (variable créée dans l'application)` };
    appliquerReglages();
  });
  $("#s-exporter").addEventListener("click", () => telecharger(new Blob([JSON.stringify(etat.p, null, 2)], { type: "application/json" }), "scenario.json"));
  $("#s-importer").addEventListener("change", async (e) => {
    try { etat.p = JSON.parse(await e.target.files[0].text()); lireScenarioDansCommandes(); appliquerReglages(); }
    catch { alert("Ce fichier n'est pas un scénario valide."); }
  });
  $("#s-reinitialiser").addEventListener("click", () => {
    etat.p = structuredClone(etat.reference);
    lireScenarioDansCommandes();
    appliquerReglages();
  });
}

function appliquerReglages() {
  sauverScenario();
  recalculerBinaires();
  recalculerPlan();
}

function dessinerReglages() {
  const p = etat.p, codes = Object.keys(p.variables);
  $("#pa-variable").innerHTML = codes.map((c) => `<option>${c}</option>`).join("");
  $("#c-variable").innerHTML = codes.map((c) => `<option>${c}</option>`).join("");
  const lignes = [["Code", "Nom", "Rôle", "Active", "Règle", "Seuil (modifiable)"]];
  for (const [c, v] of Object.entries(p.variables)) {
    const cond = v.conditions.map((x) => `${x.indicateur} ${x.op} ${x.seuil}`).join(" et ");
    const s0 = v.conditions[0].seuil;
    lignes.push([c, esc(v.nom), v.role, `<input type="checkbox" data-actif="${c}" ${v.actif ? "checked" : ""} aria-label="Activer ${c}">`, esc(cond),
      s0 === "plafond" ? "plafond de l'année" : `<input type="number" step="any" data-seuil="${c}" value="${s0}" style="width:6rem">`]);
  }
  $("#t-variables").innerHTML = tableauHtml(lignes);
  document.querySelectorAll("[data-actif]").forEach((x) => x.addEventListener("change", () => { p.variables[x.dataset.actif].actif = x.checked; appliquerReglages(); }));
  document.querySelectorAll("[data-seuil]").forEach((x) => x.addEventListener("change", () => { p.variables[x.dataset.seuil].conditions[0].seuil = +x.value; appliquerReglages(); }));

  const pa = Object.entries(p.par_annee ?? {}).filter(([a]) => !a.startsWith("exemple"))
    .flatMap(([a, vs]) => Object.entries(vs).map(([v, ch]) => ({ a, v, ch })));
  $("#l-par-annee").innerHTML = pa.map(({ a, v, ch }) =>
    `<li>${a} : ${v} ${ch.actif === false ? "retirée" : ""} ${"seuil" in ch ? `seuil ${ch.seuil}` : ""}<button class="bouton-discret" data-retirer-pa="${a}|${v}">Annuler</button></li>`).join("") || "<li>Aucun changement par année.</li>";
  document.querySelectorAll("[data-retirer-pa]").forEach((b) => b.addEventListener("click", () => {
    const [a, v] = b.dataset.retirerPa.split("|");
    delete p.par_annee[a][v];
    appliquerReglages();
  }));
  const corr = (p.corrections ?? []).filter((c) => c.province !== "EXEMPLE");
  $("#l-corrections").innerHTML = corr.map((c, i) =>
    `<li>${c.annee}, ${titre(c.province)} : ${c.variable} = ${c.valeur}. ${esc(c.justification)} (${esc(c.auteur)})<button class="bouton-discret" data-retirer-c="${i}">Retirer</button></li>`).join("") || "<li>Aucune correction.</li>";
  document.querySelectorAll("[data-retirer-c]").forEach((b) => b.addEventListener("click", () => {
    p.corrections = corr.filter((_, i) => i !== +b.dataset.retirerC);
    appliquerReglages();
  }));
}

// ---------- 5. fiche province ----------
function installerFiche() {
  $("#fiche-province").innerHTML = etat.donnees.provinces.map((p) => `<option value="${p.nom}">${titre(p.nom)}</option>`).join("");
  $("#fiche-province").value = "LOROUM";
  $("#fiche-province").addEventListener("change", dessinerFiche);
  $("#imprimer").addEventListener("click", () => print());
}

function ouvrirFiche(nom) {
  $("#fiche-province").value = nom;
  dessinerFiche();
  montrer("fiche");
  history.replaceState(null, "", `#fiche-${nom}`);
}

function dessinerFiche() {
  if (!etat.binaires.length) return;
  const nom = $("#fiche-province").value, prov = etat.donnees.provinces.find((p) => p.nom === nom);
  const ah = etat.donnees.annees_historique, a = ah.at(-1), h = prov.historique[a], l = etat.parCle[`${a}|${nom}`];
  const nouv = prov.nouvelles.map((n) => `${n.province} (région ${n.region}${n.part_pop_2019 < 1 ? `, ${fmt(100 * n.part_pop_2019)} % de la population` : ""})`).join(", ");
  const plan = etat.plan.filter((x) => x.province === nom);
  const actifs = Object.keys(etat.p.variables).filter((c) => l[c] === 1).map((c) => `${c} ${etat.p.variables[c].nom.toLowerCase()}`);
  const t = [["Année", "Élèves projetés", "Plafond", "Élèves par classe sans action", "avec le plan", "Suppléants", "Recrues", "ETA", "Salles en dur", "Double flux"]];
  plan.forEach((x) => t.push([x.annee, fmt(x.eleves), x.plafond, fmt(x.eleves_par_classe_sans_action, 1), fmt(x.eleves_par_classe_avec_plan, 1), fmt(x.suppleants), fmt(x.recrues), fmt(x.eta), fmt(x.salles_dur), fmt(x.double_flux)]));
  $("#fiche").innerHTML = `
    <h2>${titre(nom)}</h2>
    <p class="note">Ancienne région : ${titre(prov.region_ancienne)}. Nouveau découpage (2025) : ${esc(nouv)}.${prov.zone_officielle ? " Dans la liste officielle des zones à fort défi sécuritaire." : ""}</p>
    <div class="tuiles">
      <div class="tuile"><div class="libelle">Priorité en ${a}</div><div class="valeur"><i class="pastille c-${l.priorite}">${LETTRES[l.priorite]}</i> ${LIBELLES[l.priorite]}</div><div class="ecart">${actifs.join(" · ") || "aucun signal"}</div></div>
      <div class="tuile"><div class="libelle">Élèves du public</div><div class="valeur">${fmt(h.eleves)}</div><div class="ecart">${fmt(h.eleves_par_maitre, 1)} par maître · ${fmt(h.eleves_par_salle, 1)} par salle</div></div>
      <div class="tuile"><div class="libelle">Enseignants du public</div><div class="valeur">${fmt(h.enseignants_total)}</div><div class="ecart">${fmt(h.maitres)} devant une classe · ${fmt(h.suppleants)} suppléants</div></div>
      <div class="tuile"><div class="libelle">Salles précaires (paillote)</div><div class="valeur">${fmt(h.paillote_min)} à ${fmt(h.paillote_max)}</div><div class="ecart">sur ${fmt(h.salles)} salles</div></div>
    </div>
    <figure class="graphe-bloc"><figcaption><span class="titre-fig">Élèves par maître, ${ah[0]} à ${a}</span></figcaption><div class="graphe"><canvas id="g-fiche"></canvas></div></figure>
    <h3>Plan proposé (scénario actuel du simulateur)</h3>
    <div class="tableau-defile"><table class="tableau">${tableauHtml(t)}</table></div>
    <p class="note">Sources : annuaires DGESS du primaire ; CONASUR ; INSD (projections) ; OCHA (découpage). Moyennes provinciales : des écoles peuvent rester surchargées. Fiche produite par l'outil, à vérifier avec les données de la direction.</p>`;
  const annees = ah.filter((x) => prov.historique[x]);
  graphe("g-fiche", { type: "line", data: { labels: annees, datasets: [
    { label: "Élèves par maître", data: annees.map((x) => prov.historique[x].eleves_par_maitre), borderColor: css("--serie-1"), backgroundColor: css("--serie-1"), borderWidth: 2, pointRadius: 4 },
    { label: "Plafond", data: annees.map((x) => etat.p.plafond_par_annee[x]), borderColor: css("--discret"), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
  ] }, options: optionsGraphe("élèves par maître") });
}

// ---------- 6. méthode ----------
function ecrireMethode() {
  $("#methode").innerHTML = `
    <h2>À quoi sert cet outil</h2>
    <p>Aider le ministère, à chaque rentrée, à décider où ouvrir des classes du primaire public, avec quels enseignants et quelles salles, pour qu'aucun enfant ne soit dans une classe au-delà d'un plafond donné.</p>
    <h2>Le constat de départ</h2>
    <p>Entre 2017-18 et 2024-25, le nombre d'enseignants du primaire public a augmenté de 10 %, mais le nombre d'enseignants devant une classe a baissé de 13 %. Les suppléants (14 229 en 2024-25) sont souvent là où les classes débordent. Selon l'annuaire DGESS, un suppléant « peut être redéployé à tout moment ». Ce qui manque surtout, ce sont des salles.</p>
    <h2>Les variables « oui / non »</h2>
    <p>Chaque province reçoit chaque année des « oui / non » recalculés à partir des données : surcharge, fuite des maîtres, accueil de déplacés, fermetures d'écoles, manque de salles, croissance durable, donneuse possible. Ils donnent la classe de priorité. La liste officielle des zones à fort défi sécuritaire sert seulement à comparer. Tout est réglable dans l'écran « Les réglages ».</p>
    <h2>Le plan</h2>
    <p>Un programme linéaire décide, pour chaque province et chaque année de 2025-26 à 2030-31, combien de classes ouvrir, avec un suppléant ou une recrue, et dans quelle salle : salle libre, abri temporaire (ETA, 3 ans), salle en dur ou double flux (deux groupes et deux enseignants par salle, en dernier recours, compté à moitié). Il réduit au maximum le nombre d'élèves au-delà du plafond, dans la limite de l'argent pour les salles et des postes de recrues. Les règles viennent des variables : ETA là où le besoin est lié aux déplacés ou aux fermetures, salle en dur là où la population va durablement croître.</p>
    <h2>Les limites</h2>
    <ul>
      <li>Ce sont des moyennes par province : des écoles peuvent rester surchargées dans une province « correcte ». Le même calcul peut se faire école par école avec les données internes du ministère.</li>
      <li>Les projections de l'INSD datent d'avant les grands déplacements. Les déplacés sont connus jusqu'en mars 2023.</li>
      <li>Le coût d'un ETA est une estimation fragile (environ 3 M FCFA) ; il est réglable.</li>
      <li>Les classes sous paillote sont données en fourchette : murs et toits sont publiés dans deux tableaux séparés.</li>
    </ul>
    <h2>Vérifications</h2>
    <p>Les totaux des provinces retombent sur les totaux nationaux publiés par la DGESS (par exemple 13 558 écoles en 2023-24). Le moteur de l'application redonne exactement les résultats des calculs faits en Python (0 écart sur les priorités ; moins de 0,03 % sur la courbe de rendement).</p>
    <h2>Les sources</h2>
    <ul>${etat.donnees.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
}

demarrer().catch((e) => {
  console.error(e);
  $("#etat-calcul").textContent = "Erreur au chargement : " + e.message;
});

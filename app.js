// Interface de l'application : 6 écrans autour du moteur (moteur.js).
// Les calculs (binaires et plan) viennent du moteur ; ce fichier ne fait qu'afficher et régler.
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
const ACCENTS = { SENO: "Séno", PASSORE: "Passoré", BOULKIEMDE: "Boulkiemdé", BAZEGA: "Bazèga", ZOUNDWEOGO: "Zoundwéogo",
  KOURWEOGO: "Kourwéogo", KENEDOUGOU: "Kénédougou", COMOE: "Comoé", LERABA: "Léraba", KOULPELOGO: "Koulpélogo",
  KOURITTENGA: "Kouritenga", SANGUIE: "Sanguié", "LES BALE": "Les Balé", "HAUTS-BASSINS": "Hauts-Bassins" };
const titreBrut = (s) => String(s).toLowerCase().replace(/[a-zàâçéèêëîïôûùüÿ]+/g, (m, i) => (i > 0 && PETITS.has(m) ? m : m.charAt(0).toUpperCase() + m.slice(1)));
const titre = (s) => ACCENTS[String(s).toUpperCase()] ?? titreBrut(s);
// nom de province cliquable : ouvre sa fiche
const lienProv = (nom, texte = titre(nom)) => `<a class="lien-prov" href="#fiche-${encodeURIComponent(nom)}">${texte}</a>`;

// ---------- démarrage ----------
async function demarrer() {
  // « no-cache » : le navigateur revérifie les données à chaque visite (sinon il peut garder une ancienne version)
  const lire = (f) => fetch(`data/${f}`, { cache: "no-cache" }).then((r) => r.json());
  const [donnees, reference, geo] = await Promise.all([lire("donnees.json"), lire("parametres.json"), lire("provinces.geojson")]);
  etat.donnees = donnees;
  etat.reference = reference;
  etat.geo = geo;
  // un scénario enregistré garde ses choix ; les réglages apparus depuis prennent la valeur de référence
  const enregistre = chargerScenario();
  etat.p = enregistre ? { ...structuredClone(reference), ...enregistre } : structuredClone(reference);
  Chart.defaults.font.family = "\"Andika\", \"Trebuchet MS\", sans-serif";
  installerAffichage();
  installerOnglets();
  installerCarte();
  installerFrise();
  installerReglages();
  installerFiche();
  ecrireMethode();
  recalculerBinaires();
  $("#chargement")?.remove();
  installerSimulateur();
  lireAdresse();
  // les polices arrivent parfois après le premier dessin (connexion lente) : on redessine les graphiques
  document.fonts?.ready.then(() => toutRedessiner());
  // le solveur n'est chargé qu'ici : la carte et les tuiles s'affichent sans l'attendre
  $("#etat-calcul").textContent = "Chargement du solveur…";
  const { default: GLPK } = await import("https://cdn.jsdelivr.net/npm/glpk.js@4.0.2/dist/index.js");
  etat.glpk = await GLPK();
  await recalculerPlan();
}

function chargerScenario() {
  try { const s = localStorage.getItem(CLE_STOCKAGE); return s ? JSON.parse(s) : null; } catch { return null; }
}
function sauverScenario() {
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat.p)); } catch { /* stockage indisponible */ }
}

// Affichage : fond blanc ou noir, et couleurs standard ou adaptées à un type de daltonisme
// (deutéranopie, protanopie, tritanopie). Les choix sont gardés d'une visite à l'autre ; sans choix
// enregistré, le fond suit le réglage clair / sombre de l'appareil.
function installerAffichage() {
  const racine = document.documentElement;
  const lire = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
  const ecrire = (cle, v) => { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } };
  let fond = lire("outil-classes-fond") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "noir" : "blanc");
  let couleurs = lire("outil-classes-couleurs") ?? "standard";
  const appliquer = () => {
    racine.dataset.theme = fond === "noir" ? "dark" : "light";
    if (couleurs === "standard") delete racine.dataset.palette; else racine.dataset.palette = couleurs;
    document.querySelectorAll("[data-fond]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.fond === fond));
    document.querySelectorAll("[data-couleurs]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.couleurs === couleurs));
  };
  appliquer();
  document.querySelectorAll("[data-fond]").forEach((b) => b.addEventListener("click", () => {
    fond = b.dataset.fond; ecrire("outil-classes-fond", fond); appliquer(); toutRedessiner();
  }));
  document.querySelectorAll("[data-couleurs]").forEach((b) => b.addEventListener("click", () => {
    couleurs = b.dataset.couleurs; ecrire("outil-classes-couleurs", couleurs); appliquer(); toutRedessiner();
  }));
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
  const h = decodeURIComponent(location.hash.slice(1)), tiret = h.indexOf("-");
  const [ecran, province] = tiret < 0 ? [h, ""] : [h.slice(0, tiret), h.slice(tiret + 1)];
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
  dessinerAlertes();
  dessinerBilanClasses();
  dessinerCarte();
  dessinerGrapheEnseignants();
  dessinerListePriorites();
  dessinerFrise();
  dessinerReglages();
  dessinerFiche();
}

// ---------- 1. la situation ----------
// Somme sur les provinces d'un indicateur de l'historique (année a).
const somme = (a, cle) => etat.donnees.provinces.reduce((t, q) => t + (q.historique[a]?.[cle] ?? 0), 0);

// Élèves au-delà du plafond de l'année, province par province (élèves − plafond × classes).
const surnombre = (a) => etat.donnees.provinces.reduce((t, q) => {
  const h = q.historique[a];
  return t + (h ? Math.max(0, h.eleves - etat.p.plafond_par_annee[a] * h.groupes_pedagogiques) : 0);
}, 0);

function dessinerTuiles() {
  const d = etat.donnees, a0 = d.annees_historique[0], a1 = d.annees_historique.at(-1);
  const n0 = d.national[a0], n1 = d.national[a1];
  // même format pour les 4 tuiles : pourcentage et écart en nombre depuis la première année
  const signe = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
  const var_ = (x, y) => `${signe(y - x)}${fmt(Math.abs((100 * (y - x)) / x))} % (${signe(y - x)}${fmt(Math.abs(y - x))}) depuis ${a0}`;
  const tuiles = [
    ["Enseignants du primaire public", n0.enseignants_total, n1.enseignants_total],
    ["Enseignants devant une classe", n0.maitres, n1.maitres],
    ["Enseignants sans classe (hors directeurs)", somme(a0, "sans_classe"), somme(a1, "sans_classe")],
    [`Élèves au-dessus du plafond (${etat.p.plafond_par_annee[a1]} par classe)`, surnombre(a0), surnombre(a1)],
  ];
  $("#tuiles").innerHTML = tuiles.map(([l, x, y]) =>
    `<div class="tuile"><div class="libelle">${l}, ${a1}</div><div class="valeur">${fmt(y)}</div><div class="ecart">${var_(x, y)}</div></div>`).join("");
}

// « Ce qu'il faut faire » : les alertes de 2024-25 (où et pourquoi), puis le résumé du plan de la
// première année (quoi faire), écrit dès que le solveur a calculé le plan.
function dessinerAlertes() {
  const d = etat.donnees, a = d.annees_historique.at(-1), plafond = etat.p.plafond_par_annee[a];
  const reserve = etat.p.reserve_suppleants_pct / 100;
  const P = d.provinces.map((q) => {
    const h = q.historique[a], g = h.groupes_pedagogiques, m = h.maitres;
    const sansMaitre = Math.max(0, g - m), dispo = Math.floor(Math.max(0, h.sans_classe - sansMaitre) * (1 - reserve));
    const manque = Math.max(0, sansMaitre - h.sans_classe);
    const besoin = Math.max(0, Math.ceil((h.eleves - plafond * (g - manque)) / plafond));
    return { nom: q.nom, besoin, dispo, manque, sansSalle: Math.max(0, g - h.salles) };
  });
  const A = P.filter((x) => x.besoin > 0 && x.dispo >= x.besoin).sort((x, y) => y.besoin - x.besoin);
  const B = P.filter((x) => x.besoin > 0 && x.dispo < x.besoin).map((x) => ({ ...x, manquent: x.besoin - x.dispo })).sort((x, y) => y.manquent - x.manquent);
  const C = P.filter((x) => x.besoin === 0 && x.dispo >= 50).sort((x, y) => y.dispo - x.dispo);
  const D = P.filter((x) => x.manque > 0).sort((x, y) => y.manque - x.manque);
  const E = P.filter((x) => x.sansSalle > 0).sort((x, y) => y.sansSalle - x.sansSalle);
  const tot = (xs, k) => xs.reduce((t, x) => t + x[k], 0);
  // les provinces touchées : les 6 premières, cliquables, puis « et N autres »
  const etiquettes = (xs, k) => {
    const e = (x) => `${lienProv(x.nom)} (${fmt(x[k])})`;
    return xs.length > 6 ? `${xs.slice(0, 6).map(e).join(", ")} et ${xs.length - 6} autres` : xs.map(e).join(", ");
  };
  const cartes = [];
  if (A.length) cartes.push({ niveau: "fort", titre: "Classes surchargées, enseignants disponibles sur place",
    chiffre: fmt(tot(A, "besoin")), unite: `classes à ouvrir, ${A.length} provinces`, puces: etiquettes(A, "besoin"),
    solution: "Mettre ces enseignants, déjà payés, devant de nouvelles classes. Il faut surtout des salles." });
  if (B.length) cartes.push({ niveau: "fort", titre: "Classes surchargées, pas assez d'enseignants sur place",
    chiffre: fmt(tot(B, "manquent")), unite: `enseignants manquent, ${B.length} provinces`, puces: etiquettes(B, "manquent"),
    solution: "Faire venir des enseignants sans classe de la région, sinon recruter. Accompagner ces affectations (prime, logement)." });
  if (D.length) cartes.push({ niveau: "fort", titre: "Classes sans enseignant attitré",
    chiffre: fmt(tot(D, "manque")), unite: `classes, ${D.length} province${D.length > 1 ? "s" : ""}`, puces: etiquettes(D, "manque"),
    solution: "Affecter un enseignant en priorité." });
  if (E.length) cartes.push({ niveau: "moyen", titre: "Classes sans salle",
    chiffre: fmt(tot(E, "sansSalle")), unite: `classes, ${E.length} provinces`, puces: etiquettes(E, "sansSalle"),
    solution: "Abri temporaire si le besoin est passager, salle en dur s'il dure." });
  if (C.length) cartes.push({ niveau: "ressource", titre: "Enseignants sans classe, sans surcharge sur place",
    chiffre: fmt(tot(C, "dispo")), unite: `enseignants mobilisables, ${C.length} provinces`, puces: etiquettes(C, "dispo"),
    solution: "Une réserve à redéployer dans la région. Vérifier s'ils viennent d'écoles fermées." });
  $("#alertes").innerHTML = cartes.map((c) => `<div class="ligne-alerte niveau-${c.niveau}">
      <div class="probleme"><span class="etiq-zone">${c.niveau === "ressource" ? "Ressource" : "Problème"}</span>
        <div class="titre-alerte">${c.titre}</div>
        <div class="chiffre-alerte"><b>${c.chiffre}</b> ${c.unite}</div>
        <div class="prov-alerte">${c.puces}.</div></div>
      <div class="solution"><span class="etiq-zone">Solution</span><div class="texte-solution">${c.solution}</div></div>
    </div>`).join("") || "<p>Aucune alerte.</p>";
}

// Le plan d'une année, en quatre lignes : classes, enseignants, salles, résultat.
function resumePlan(l, a) {
  const s = (k) => l.reduce((t, x) => t + x[k], 0);
  const nb = (x, mot, pluriel = mot + "s") => `${fmt(x)} ${x > 1 ? pluriel : mot}`;
  const provinces = l.filter((x) => x.classes_supplementaires > 0).length;
  const ens = [`${fmt(s("suppleants"))} déjà payés et sans classe dans leur province`, `${fmt(s("redeployes_recus"))} venus d'une autre province de leur région`];
  ens.push(s("recrues") ? nb(s("recrues"), "recrue") : "<b>aucune recrue supplémentaire</b>");
  const ligne = (etiquette, texte) => `<li><b class="etiquette">${etiquette}</b>${texte}</li>`;
  const sc = etat.p.securite ?? {};
  const scenario = sc.scenario === "retour"
    ? `retour progressif à la normale à partir de ${sc.debut} (${sc.rythme_pct} % des écoles fermées rouvrent chaque année, avec leurs élèves et leurs salles)`
    : "la situation actuelle se prolonge";
  const hausse = l.reduce((t, x) => t + x.eleves, 0) - etat.donnees.national[etat.donnees.annees_historique.at(-1)].eleves;
  return `<ul class="resume-plan">
    ${ligne("Scénario", `${scenario} ; besoins projetés pour ${a} (${hausse >= 0 ? "+" : ""}${fmt(hausse)} élèves par rapport à 2024-2025)`)}
    ${ligne("Classes", `<b>${nb(s("classes_supplementaires"), "classe")} en plus</b> par rapport à 2024-2025, dans ${nb(provinces, "province")} (plafond de ${etat.p.plafond_par_annee[a]} élèves par classe)`)}
    ${ligne("Enseignants", ens.join(", "))}
    ${ligne("Salles", `${nb(s("eta"), "abri temporaire", "abris temporaires")} (ETA) à installer ou renouveler, ${nb(s("salles_dur"), "salle en dur", "salles en dur")} à construire, ${nb(s("double_flux"), "classe")} en double flux`)}
    ${ligne("Coût", `<b>${fmt(s("cout_salles_fcfa") / 1e9, 1)} milliards FCFA</b> pour les salles cette année ; aucun salaire en plus pour les enseignants déjà payés${s("recrues") ? `, ${fmt(s("recrues"))} salaires de recrues en plus` : ""}`)}
    ${ligne("Résultat", `<b>${fmt(s("surnombre_avec_plan"))}</b> élèves au-dessus du plafond, au lieu de ${fmt(s("surnombre_sans_action"))} sans action`)}
  </ul>`;
}

function dessinerAFaire() {
  if (!etat.plan.length) return;
  const a = etat.donnees.annees_projection[0], l = etat.plan.filter((x) => x.annee === a);
  const s = (k) => l.reduce((t, x) => t + x[k], 0);
  const provinces = l.filter((x) => x.classes_supplementaires > 0).length;
  const b = etat.p.budgets_par_annee.defaut;
  $("#a-faire-resume").innerHTML = `<p>Pour la rentrée <b>${a}</b>, avec ${fmt(b.argent_salles_fcfa / 1e9, 1)} milliards FCFA par an pour les salles :</p>`
    + resumePlan(l, a)
    + `<p class="note">Les recrutements pour remplacer les départs (retraites, démissions) restent nécessaires ; ils ne sont pas calculés ici. Les réglages du plan se changent dans « Le simulateur ».</p>`;
}

// Classes, enseignants et salles de l'année choisie sur la carte : les trois comptes ne se confondent pas.
function dessinerBilanClasses() {
  const a = anneeCarte(), n = etat.donnees.national[a];
  let sansMaitre = 0, pSansMaitre = 0, sallesVides = 0, pSallesVides = 0, sansSalle = 0, pSansSalle = 0;
  for (const q of etat.donnees.provinces) {
    const h = q.historique[a];
    if (!h) continue;
    const g = h.groupes_pedagogiques, m = h.maitres, s = h.salles;
    if (g > m) { sansMaitre += g - m; pSansMaitre += 1; }
    if (s > g) { sallesVides += s - g; pSallesVides += 1; }
    if (g > s) { sansSalle += g - s; pSansSalle += 1; }
  }
  const sansClasse = somme(a, "sans_classe"), dirSansClasse = n.enseignants_total - n.maitres - sansClasse;
  const dirEnClasse = n.directeurs - dirSansClasse;
  const ligne = (libelle, valeur, detail = "") => `<tr><td class="gauche">${libelle}</td><td>${valeur}</td><td class="gauche note">${detail}</td></tr>`;
  $("#bilan-classes").innerHTML = `<h3>Classes, enseignants et salles en ${a}</h3>
    <p class="note">Une <b>classe</b> est un groupe d'élèves (« groupe pédagogique ») ; une <b>salle</b> est un local, en dur ou non (banco, paillote). Les écarts se comptent province par province : un surplus dans une province ne comble pas un manque dans une autre.</p>
    <div class="tableau-defile"><table class="tableau">
      <tr><th class="gauche">Les classes</th><th></th><th></th></tr>
      ${ligne("Classes (groupes d'élèves)", fmt(n.classes))}
      ${ligne("dont avec leur enseignant", fmt(n.maitres))}
      ${ligne("dont sans enseignant attitré", fmt(sansMaitre), `${pSansMaitre} provinces`)}
      <tr><th class="gauche">Les salles</th><th></th><th></th></tr>
      ${ligne("Salles de classe", fmt(n.salles))}
      ${ligne("Salles sans classe", fmt(sallesVides), `${pSallesVides} provinces`)}
      ${ligne("Classes sans salle", fmt(sansSalle), `${pSansSalle} provinces`)}
      <tr><th class="gauche">Les enseignants</th><th></th><th></th></tr>
      ${ligne("Enseignants du public", fmt(n.enseignants_total), "chacun est directeur, titulaire ou suppléant")}
      ${ligne("dont directeurs", fmt(n.directeurs), "dirigent l'école ; certains tiennent aussi une classe")}
      ${ligne("dont titulaires", fmt(n.titulaires), "responsables d'une classe")}
      ${ligne("dont suppléants", fmt(n.suppleants), "assistent un titulaire, redéployables")}
      ${ligne("Enseignants qui tiennent une classe", fmt(n.maitres), "titulaires ou suppléants")}
      ${ligne("Enseignants sans classe (hors directeurs)", fmt(sansClasse), "titulaires + suppléants − ceux qui tiennent une classe")}
    </table></div>
    <p class="note">Le compte tombe juste : ${fmt(n.maitres)} enseignants qui tiennent une classe + ${fmt(sansClasse)} sans classe + ${fmt(dirSansClasse)} directeurs sans classe = ${fmt(n.enseignants_total)}${dirEnClasse ? ` (les ${fmt(dirEnClasse)} autres directeurs tiennent aussi une classe)` : ""}.</p>
    <p class="note">Source : annuaires DGESS du primaire, tableaux I.1 (écoles, salles, groupes pédagogiques, maîtres) et IV.1.1 (enseignants par fonction), secteur public.</p>`;
}

function installerCarte() {
  etat.carte = L.map("carte", { zoomSnap: 0.25, attributionControl: false, scrollWheelZoom: false });
  etat.couche = L.geoJSON(etat.geo, {
    style: () => ({ weight: 1, color: css("--contour-carte"), fillOpacity: 1 }),
    onEachFeature: (f, couche) => couche.on("click", () => ouvrirFiche(f.properties.province_ancienne.replace("KOMANDJARI", "KOMONDJARI"))),
  }).addTo(etat.carte);
  etat.carte.fitBounds(etat.couche.getBounds(), { padding: [8, 8] });
  const curseur = $("#annee-carte");
  curseur.max = etat.donnees.annees_historique.length - 1;
  curseur.value = curseur.max;
  curseur.addEventListener("input", () => { dessinerCarte(); dessinerListePriorites(); dessinerBilanClasses(); });
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
    // les 19 provinces de la liste officielle « à fort défi sécuritaire » : contour en pointillé
    couche.setStyle({ fillColor: l ? css(`--${l.priorite}`) : css("--non"),
      ...(prov?.zone_officielle ? { color: css("--texte"), weight: 2.2, dashArray: "5 4" } : { color: css("--contour-carte"), weight: 1, dashArray: null }) });
    if (prov?.zone_officielle) couche.bringToFront();
    couche.bindTooltip(l
      ? `<b>${titre(nom)}</b> (${titre(prov.region_ancienne)})<br>${LIBELLES[l.priorite]}${prov.zone_officielle ? " · liste officielle des 19" : ""}<br>${fmt(h.eleves_par_maitre, 1)} élèves par maître · ${fmt(h.eleves_par_salle, 1)} par salle${l.correction ? `<br><i>Correction : ${esc(l.correction)}</i>` : ""}`
      : `<b>${titre(nom)}</b><br>Pas de données en ${a}`, { sticky: true });
  });
}

// Sous la carte : la légende avec le nombre de provinces de chaque catégorie pour l'année choisie,
// et la comparaison avec la liste officielle (contour en pointillé sur la carte).
function dessinerListePriorites() {
  const a = anneeCarte(), lignes = etat.binaires.filter((x) => x.annee === a);
  const n = (c) => lignes.filter((x) => x.priorite === c).length;
  $("#legende-carte").innerHTML = CLASSES.map((c) =>
    `<span title="${EXPLICATIONS[c]}"><i class="pastille c-${c}">${LETTRES[c]}</i>${LIBELLES[c]} <b>(${n(c)})</b></span>`).join("")
    + `<span><i class="pastille contour-officiel"></i>pointillé = province de la liste officielle « à fort défi sécuritaire » (19 provinces, 2025)</span>`;
  const liste = new Set(etat.donnees.provinces.filter((p) => p.zone_officielle).map((p) => p.nom));
  const besoin = new Set(lignes.filter((x) => ["urgence", "surcharge", "vigilance"].includes(x.priorite)).map((x) => x.province));
  const oubliees = [...besoin].filter((x) => !liste.has(x)).map((x) => lienProv(x));
  const sansBesoin = [...liste].filter((x) => !besoin.has(x)).map((x) => lienProv(x));
  $("#comparaison-officielle").innerHTML = `<b>Besoin réel, mais hors de la liste officielle</b> (couleur sans pointillé) : ${oubliees.join(", ") || "aucune"}. <b>Dans la liste, sans besoin fort en ${a}</b> (pointillé sur beige ou vert) : ${sansBesoin.join(", ") || "aucune"}.`;
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
  $("#legende-frise").innerHTML += `<span><i class="pastille c-non">–</i>province absente de l'annuaire cette année</span>`;
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
  $("#securite-debut").innerHTML = ap.map((a) => `<option value="${a}">${a}</option>`).join("");
  $("#plan-annee").innerHTML = ap.map((a) => `<option>${a}</option>`).join("");
  $("#reco-annee").innerHTML = ap.map((a) => `<option>${a}</option>`).join("");
  $("#reco-annee").addEventListener("change", dessinerRecommandations);
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
  $("#redeploiement").value = p.redeploiement_region_pct ?? 0;
  $("#plafond-1").value = p.plafond_par_annee[ap[0]];
  $("#plafond-2").value = p.plafond_par_annee[ap[2]];
  $("#plafond-3").value = p.plafond_par_annee[ap[4]];
  const lev = p.leviers_par_annee;
  $("#df").checked = lev.defaut.double_flux;
  const interdit = ap.find((a) => lev[a]?.double_flux === false);
  $("#df-fin").value = interdit ? ap[Math.max(0, ap.indexOf(interdit) - 1)] : ap.at(-1);
  $("#df-fermetures").checked = lev.defaut.double_flux_si_fermetures;
  $("#definitives").checked = p.classes_definitives ?? false;
  const sc = p.securite ?? { scenario: "actuelle", debut: ap[2], rythme_pct: 25 };
  $("#securite").value = sc.scenario;
  $("#securite-debut").value = sc.debut;
  $("#securite-rythme").value = sc.rythme_pct;
  $("#cout-eta").value = p.couts.eta_fcfa / 1e6;
  $("#cout-dur").value = p.couts.salle_dur_fcfa / 1e6;
  afficherValeurs();
}

function afficherValeurs() {
  const v = (id) => +$(`#${id}`).value;
  const textes = {
    argent: `${fmt(v("argent"), 1)} milliards FCFA`, postes: fmt(v("postes")), respect: `${v("respect")} %`,
    reserve: `${v("reserve")} %`, "securite-rythme": `${v("securite-rythme")} %`, redeploiement: v("redeploiement") >= 100 ? "sans limite" : `${v("redeploiement")} %`, "cout-eta": `${fmt(v("cout-eta"), 1)} M FCFA`, "cout-dur": `${fmt(v("cout-dur"), 1)} M FCFA`,
  };
  for (const [k, t] of Object.entries(textes)) document.querySelector(`output[data-pour="${k}"]`).textContent = t;
  $("#df-fin").disabled = !$("#df").checked;
  const retourActif = $("#securite").value === "retour";
  $("#securite-debut").disabled = !retourActif;
  $("#securite-rythme").disabled = !retourActif;
}

function ecrireCommandesDansScenario() {
  const p = etat.p, ap = etat.donnees.annees_projection, v = (id) => +$(`#${id}`).value;
  p.budgets_par_annee = { ...p.budgets_par_annee, defaut: { argent_salles_fcfa: v("argent") * 1e9, postes_nouveaux_enseignants: v("postes") } };
  for (const a of ap) delete p.budgets_par_annee[a];
  p.taux_respect_affectation_pct = v("respect");
  p.reserve_suppleants_pct = v("reserve");
  p.redeploiement_region_pct = v("redeploiement");
  ap.forEach((a, i) => { p.plafond_par_annee[a] = v(`plafond-${1 + Math.floor(i / 2)}`); });
  const defaut = { ...p.leviers_par_annee.defaut, double_flux: $("#df").checked, double_flux_si_fermetures: $("#df-fermetures").checked };
  p.leviers_par_annee = { defaut };
  const fin = ap.indexOf($("#df-fin").value);
  if ($("#df").checked && fin < ap.length - 1) p.leviers_par_annee[ap[fin + 1]] = { double_flux: false };
  p.couts = { ...p.couts, eta_fcfa: v("cout-eta") * 1e6, salle_dur_fcfa: v("cout-dur") * 1e6 };
  p.classes_definitives = $("#definitives").checked;
  p.securite = { ...(p.securite ?? {}), scenario: $("#securite").value, debut: $("#securite-debut").value, rythme_pct: v("securite-rythme") };
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
  etat.flux = r.flux;
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
    ["Baisse du surnombre sur 6 ans", `${fmt(100 - (100 * tot("surnombre_avec_plan")) / Math.max(1, tot("surnombre_sans_action")))} %`, `additionné sur les 6 années`],
    ["Dépense pour les salles, 6 ans", `${fmt(tot("cout_salles_fcfa") / 1e9, 1)} Md FCFA`, `${fmt(tot("eta"))} ETA, ${fmt(tot("salles_dur"))} salles en dur`],
  ].map(([l, v, e]) => `<div class="tuile"><div class="libelle">${l}</div><div class="valeur">${v}</div><div class="ecart">${e}</div></div>`).join("");

  graphe("g-surnombre", { type: "bar", data: { labels: ap, datasets: [
    { label: "Sans action", data: s.map((l) => l.surnombre_sans_action), backgroundColor: css("--sans-action"), borderRadius: 4, maxBarThickness: 28 },
    { label: "Avec le plan", data: s.map((l) => l.surnombre_avec_plan), backgroundColor: css("--serie-1"), borderRadius: 4, maxBarThickness: 28 },
  ] }, options: optionsGraphe("élèves en surnombre") });

  dessinerRecommandations();
  dessinerAFaire();
  const pire = s.reduce((x, l) => (l.surnombre_avec_plan > x.surnombre_avec_plan ? l : x), s[0]);
  const plafondPire = etat.p.plafond_par_annee[pire.annee];
  const manquent = Math.ceil(pire.surnombre_avec_plan / plafondPire);
  $("#note-surnombre").innerHTML = pire.surnombre_avec_plan < 1000
    ? "Avec ces réglages, presque tous les élèves restent sous le plafond chaque année."
    : `<b>Pourquoi le plan ne suffit plus en ${pire.annee} :</b> le plafond passe à ${plafondPire} élèves par classe`
      + `${etat.p.leviers_par_annee?.[pire.annee]?.double_flux === false || Object.entries(etat.p.leviers_par_annee ?? {}).some(([k, v]) => k <= pire.annee && v.double_flux === false) ? " et le double flux s'arrête" : ""}. `
      + `Il manquerait encore environ ${fmt(manquent)} classes, donc autant de salles (au moins ${fmt(manquent * etat.p.couts.eta_fcfa / 1e9, 1)} milliards FCFA en abris temporaires, ${fmt(manquent * etat.p.couts.salle_dur_fcfa / 1e9, 1)} milliards en dur). `
      + `${pire.recrues === 0 ? "Les enseignants ne manquent pas : c'est l'argent pour les salles qui limite. " : ""}Pour voir l'effet d'un budget plus élevé : « Que rapporte chaque milliard de plus ? ».`;
  const lignes = [["Année", "Élèves", "Plafond", "Enseignants sans classe mis devant une classe", "dont venus d'une autre province", "Recrues", "ETA", "Salles en dur", "Classes en double flux", "Provinces au-dessus du plafond", "Dépense (Md FCFA)"]];
  s.forEach((l) => lignes.push([l.annee, fmt(l.eleves), etat.p.plafond_par_annee[l.annee], fmt(l.suppleants + l.redeployes_recus), fmt(l.redeployes_recus), fmt(l.recrues), fmt(l.eta), fmt(l.salles_dur), fmt(l.double_flux), `${l.provinces_avec_plan} (${l.provinces_sans_action} sans action)`, fmt(l.cout_salles_fcfa / 1e9, 2)]));
  $("#t-moyens").innerHTML = tableauHtml(lignes);

  const a = $("#plan-annee").value || ap[0];
  const lp = etat.plan.filter((l) => l.annee === a).sort((x, y) => y.surnombre_sans_action - x.surnombre_sans_action);
  const t = [["Province", "Région (ancienne)", "Élèves", "Élèves par classe sans action", "avec le plan", "Classes en plus", "Enseignants de la province", "Venus de la région", "Recrues de l'année", "ETA", "Salles en dur", "Double flux"]];
  lp.forEach((l) => t.push([titre(l.province), titre(l.region), fmt(l.eleves), fmt(l.eleves_par_classe_sans_action, 1), fmt(l.eleves_par_classe_avec_plan, 1), fmt(l.classes_supplementaires), fmt(l.suppleants), fmt(l.redeployes_recus), fmt(l.recrues), fmt(l.eta), fmt(l.salles_dur), fmt(l.double_flux)]));
  $("#t-plan").innerHTML = tableauHtml(t);
}

// Recommandations en phrases, pour une année : d'abord le résumé national, puis chaque province qui agit.
function dessinerRecommandations() {
  if (!etat.plan.length) return;
  const ap = etat.donnees.annees_projection, a = $("#reco-annee").value || ap[0], j = ap.indexOf(a);
  const lignes = etat.plan.filter((l) => l.annee === a);
  const somme = (k) => lignes.reduce((t, l) => t + l[k], 0);
  const actives = lignes.filter((l) => l.classes_supplementaires > 0 || l.redeployes_envoyes > 0)
    .sort((x, y) => y.classes_supplementaires - x.classes_supplementaires);
  const nb = (x, mot, pluriel = mot + "s") => `${fmt(x)} ${x > 1 ? pluriel : mot}`;
  $("#reco-resume").innerHTML = `<p>En <b>${a}</b> :</p>${resumePlan(lignes, a)}`
    + `<p class="note">${somme("recrues") === 0 ? "Aucune recrue supplémentaire n'est nécessaire pour ouvrir ces classes. " : ""}`
    + `Les recrues comptées ici servent seulement à ouvrir des classes : les recrutements pour remplacer les départs (retraites, démissions, abandons de poste) restent nécessaires et ne sont pas calculés par l'outil.</p>`;
  const li = (l) => `<li>${lienProv(l.province)} (${titre(l.region)}) : ${phraseProvince(l, a)}.</li>`;
  $("#reco-liste").innerHTML = actives.slice(0, 6).map(li).join("") || "<li>Aucune action nécessaire cette année.</li>";
  $("#reco-suite").hidden = actives.length <= 6;
  $("#reco-suite summary").textContent = `Voir les ${actives.length - 6} autres provinces`;
  $("#reco-liste-suite").innerHTML = actives.slice(6).map(li).join("");
}

// Ce que le plan recommande à une province pour une année, en une phrase.
function phraseProvince(l, a, avecSecurite = true) {
  const ap = etat.donnees.annees_projection, j = ap.indexOf(a);
  const avant = etat.plan.find((x) => x.annee === ap[j - 1] && x.province === l.province);
  const flux = (etat.flux ?? []).filter((f) => f.annee === a);
  const nb = (x, mot, pluriel = mot + "s") => `${fmt(x)} ${x > 1 ? pluriel : mot}`;
  const nouvelles = l.classes_supplementaires - (avant?.classes_supplementaires ?? 0);
  const de = flux.filter((f) => f.vers === l.province).map((f) => `${lienProv(f.de)} ${fmt(f.enseignants)}`);
  const vers = flux.filter((f) => f.de === l.province).map((f) => `${lienProv(f.vers)} ${fmt(f.enseignants)}`);
  const morceaux = [];
  if (l.classes_supplementaires > 0) {
    morceaux.push(`${nb(l.classes_supplementaires, "classe")} en plus${j > 0 ? ` (${nouvelles >= 0 ? "+" : ""}${fmt(nouvelles)} cette année)` : ""}`);
    if (nouvelles < 0 && (avant?.double_flux ?? 0) > l.double_flux)
      morceaux.push(`<b>attention : ${fmt(-nouvelles)} classes ferment</b> à la fin du double flux, faute de salles pour les remplacer ; construire ces salles avant ${a} évite ce recul`);
    const ens = [];
    if (l.suppleants) ens.push(`${fmt(l.suppleants)} sans classe dans la province`);
    if (l.redeployes_recus) ens.push(`${fmt(l.redeployes_recus)} venus de la région (${de.join(", ")})`);
    if (l.recrues) ens.push(nb(l.recrues, "recrue"));
    if (ens.length) morceaux.push(`enseignants : ${ens.join(", ")}`);
    const sal = [];
    if (l.eta) sal.push(`${fmt(l.eta)} ETA à installer ou renouveler (un ETA dure 3 ans)`);
    if (l.salles_dur) sal.push(nb(l.salles_dur, "salle en dur", "salles en dur") + " à construire");
    if (l.double_flux) sal.push(`${nb(l.double_flux, "classe")} en double flux`);
    if (l.eta + l.salles_dur + l.double_flux < l.classes_supplementaires) sal.push(sal.length ? "le reste dans des salles déjà construites" : "dans des salles déjà construites");
    if (sal.length) morceaux.push(`salles : ${sal.join(", ")}`);
  }
  if (vers.length) morceaux.push(`envoyer des enseignants sans classe vers ${vers.join(", ")}`);
  const zone = etat.donnees.provinces.find((q) => q.nom === l.province)?.zone_officielle;
  if (avecSecurite && zone && (l.redeployes_recus > 0 || l.recrues > 0)) morceaux.push("province à fort défi sécuritaire : affectations à accompagner (prime, logement, volontariat)");
  return morceaux.join(" ; ") || "aucune classe à ouvrir";

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
    const role = v.role === "comparaison" ? `<span class="comparaison-seule">comparaison seulement (n'entre pas dans les priorités)</span>` : v.role;
    lignes.push([c, esc(v.nom), role, `<input type="checkbox" data-actif="${c}" ${v.actif ? "checked" : ""} aria-label="Activer ${c}">`,
      `${esc(v.explication ?? cond)}<br><span class="note">${esc(cond)}</span>`,
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
  const t = [["Année", "Élèves projetés", "Plafond", "Élèves par classe sans action", "avec le plan", "Sans classe de la province", "Venus de la région", "Recrues", "ETA", "Salles en dur", "Double flux"]];
  plan.forEach((x) => t.push([x.annee, fmt(x.eleves), x.plafond, fmt(x.eleves_par_classe_sans_action, 1), fmt(x.eleves_par_classe_avec_plan, 1), fmt(x.suppleants), fmt(x.redeployes_recus), fmt(x.recrues), fmt(x.eta), fmt(x.salles_dur), fmt(x.double_flux)]));
  const recos = plan.map((x) => `<li><b>${x.annee}</b> (plafond ${x.plafond}) : ${phraseProvince(x, x.annee, false)}.</li>`).join("");
  const securite = prov.zone_officielle && plan.some((x) => x.redeployes_recus > 0 || x.recrues > 0)
    ? `<p class="alerte-securite"><b>Province à fort défi sécuritaire :</b> les affectations prévues ci-dessous sont à accompagner (prime, logement, volontariat).</p>` : "";
  $("#fiche").innerHTML = `
    <h2>${titre(nom)}</h2>
    <p class="note">Ancienne région : ${titre(prov.region_ancienne)}. Nouveau découpage (2025) : ${esc(nouv)}.${prov.zone_officielle ? " Dans la liste officielle des zones à fort défi sécuritaire." : ""}</p>
    <div class="tuiles">
      <div class="tuile"><div class="libelle">Priorité en ${a}</div><div class="valeur"><i class="pastille c-${l.priorite}">${LETTRES[l.priorite]}</i> ${LIBELLES[l.priorite]}</div><div class="ecart">${actifs.join(" · ") || "aucun signal"}</div></div>
      <div class="tuile"><div class="libelle">Élèves du public</div><div class="valeur">${fmt(h.eleves)}</div><div class="ecart">${fmt(h.eleves_par_maitre, 1)} par maître · ${fmt(h.eleves_par_salle, 1)} par salle</div></div>
      <div class="tuile"><div class="libelle">Enseignants du public</div><div class="valeur">${fmt(h.enseignants_total)}</div><div class="ecart">${fmt(h.maitres)} devant une classe · ${fmt(h.sans_classe)} sans classe (hors directeurs)</div></div>
      <div class="tuile"><div class="libelle">Salles précaires (paillote)</div><div class="valeur">${fmt(h.paillote_min)} à ${fmt(h.paillote_max)}</div><div class="ecart">salles en paillote, sur ${fmt(h.salles)} salles</div></div>
    </div>
    <figure class="graphe-bloc"><figcaption><span class="titre-fig">Élèves par maître, ${ah[0]} à ${a}</span></figcaption><div class="graphe"><canvas id="g-fiche"></canvas></div></figure>
    <h3>Ce que le plan recommande à la province</h3>
    ${securite}
    <ul class="liste-reco">${recos || "<li>Plan en cours de calcul…</li>"}</ul>
    <p class="note">Scénario actuel du simulateur. Les recrutements pour remplacer les départs (retraites, démissions) restent nécessaires ; ils ne sont pas calculés ici.</p>
    <h3>Le plan en chiffres</h3>
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
    <p>Entre 2017-18 et 2024-25, le nombre d'enseignants du primaire public a augmenté de 10 %, mais le nombre d'enseignants devant une classe a baissé de 13 %. En 2024-25, 15 463 titulaires ou suppléants n'ont pas de classe à eux (ils étaient 2 221 en 2017-18), alors que 920 classes n'ont pas d'enseignant attitré et que des classes débordent. Selon l'annuaire DGESS, un suppléant « peut être redéployé à tout moment dans une autre école de la CEB, de la province, de la région ». Ce qui manque surtout, ce sont des salles.</p>
    <h2>Les variables « oui / non »</h2>
    <p>Chaque province reçoit chaque année des « oui / non » recalculés à partir des données : surcharge, fuite des maîtres, accueil de déplacés, fermetures d'écoles, manque de salles, croissance durable, donneuse possible. Ils donnent la classe de priorité. La liste officielle des zones à fort défi sécuritaire sert seulement à comparer. Tout est réglable dans l'écran « Les réglages ».</p>
    <h2>Le plan</h2>
    <p>Un programme linéaire décide, pour chaque province et chaque année de 2025-26 à 2030-31, combien de classes ouvrir, avec quel enseignant (d'abord un enseignant sans classe de la province, puis un enseignant sans classe d'une autre province de la même région, puis une recrue, comptée en années de salaire), et dans quelle salle : salle libre, abri temporaire (ETA, 3 ans), salle en dur ou double flux (deux groupes et deux enseignants par salle, en dernier recours, compté à moitié). Il réduit au maximum le nombre d'élèves au-delà du plafond, dans la limite de l'argent pour les salles et des postes de recrues. Les règles viennent des variables : ETA là où le besoin est lié aux déplacés ou aux fermetures, salle en dur là où la population va durablement croître.</p>
    <h2>Les limites</h2>
    <ul>
      <li>Ce sont des moyennes par province : des écoles peuvent rester surchargées dans une province « correcte ». Le même calcul peut se faire école par école avec les données internes du ministère.</li>
      <li>Les projections de l'INSD datent d'avant les grands déplacements. Les déplacés sont connus jusqu'en mars 2023.</li>
      <li>Le coût d'un ETA est une estimation fragile (environ 3 M FCFA) ; il est réglable.</li>
      <li>Les départs d'enseignants (retraites, démissions, abandons de poste) ne sont pas calculés : les recrues de l'outil servent seulement à ouvrir des classes, il faut toujours remplacer ceux qui partent.</li>
      <li><b>Pas de calcul école par école</b> : les données par école ne sont pas publiques ; tout est fait par province (45), ce qui cache les écarts entre écoles d'une même province. Le même calcul se fait école par école avec les données internes de la DGESS.</li>
      <li><b>Pas de mesure de l'accessibilité (enfants à plus de 3 km d'une école)</b> : essayée avec OpenStreetMap et WorldPop, puis écartée : OpenStreetMap recense mal les écoles (100 % des enfants « à plus de 3 km » dans le Banwa, 7 % dans le Loroum), le résultat n'était pas fiable.</li>
      <li><b>Pas de choix des sites où construire, école par école</b> : il faudrait la position fiable de chaque école ; l'outil choisit seulement, par province, entre abri temporaire et salle en dur.</li>
      <li><b>Résultats en 45 provinces, pas encore dans le nouveau découpage (17 régions, 47 provinces)</b> : les annuaires sont publiés dans l'ancien découpage ; la table de passage existe (OCHA, 2025) et chaque fiche donne les nouvelles provinces, mais répartir les chiffres demanderait une clé de population, donc des approximations.</li>
      <li><b>Pas de données d'événements sécuritaires (ACLED)</b> : la sécurité est prise en compte par les déplacés (CONASUR), les fermetures d'écoles (annuaires, rapports ESU) et la liste officielle des 19 provinces, plus proches de l'effet sur l'école.</li>
      <li><b>Pas de post-primaire</b> : le fichier fourni par le concours porte sur le préscolaire et le primaire ; nous avons donné la priorité au primaire.</li>
      <li>Envoyer des enseignants dans une province à fort défi sécuritaire suppose qu'ils acceptent d'y aller : le plan ne remplace pas les incitations (prime, logement, recrutement local).</li>
      <li>Les classes sous paillote sont données en fourchette : murs et toits sont publiés dans deux tableaux séparés.</li>
    </ul>
    <h2>Vérifications</h2>
    <p>Les totaux des provinces retombent sur les totaux nationaux publiés par la DGESS (par exemple 13 558 écoles en 2023-24). Le moteur de l'application redonne exactement les résultats des calculs faits en Python (0 écart sur les priorités ; moins de 0,03 % sur la courbe de rendement).</p>
    <h2>Les enseignants sont-ils affectés selon les élèves ?</h2>
    <p>C'est l'indicateur de cohérence du diagnostic national (RESEN) : la part de l'affectation des enseignants qui ne s'explique pas par le nombre d'élèves. Le RESEN le calcule école par école (29 % en 2013-14) ; faute de données publiques par école, nous le calculons province par province, où les écarts entre écoles se compensent : 9 % en 2017-18, 5 % en 2024-25. Le plan le ramène à environ 2 %, et surtout resserre les extrêmes : en 2025-26, le pire ratio passe de 115 à 62 élèves par maître, et l'écart-type entre provinces de 14 à 7,5.</p>
    <h2>Les prévisions ont-elles été testées ?</h2>
    <p>Oui, en se plaçant dans le passé : on prévoit une année avec la méthode de l'outil, puis on compare avec ce que l'annuaire a compté. En année calme, l'écart est faible : de 2023-24 à 2024-25, −5 % pour le pays, 8,5 % en moyenne par province. En pleine crise, il est fort : +21 % pour 2022-23, l'année des fermetures massives, que la méthode ne peut pas prévoir. Depuis 2023, la méthode sous-estime les élèves (−5 à −11 %), car des écoles rouvrent. C'est pourquoi l'outil propose deux scénarios de sécurité : « la situation actuelle se prolonge » donne le bas de la fourchette, « retour à la normale » le haut.</p>
    <h2>Les sources</h2>
    <ul>${etat.donnees.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
}

demarrer().catch((e) => {
  console.error(e);
  $("#etat-calcul").textContent = "Erreur au chargement : " + e.message;
});

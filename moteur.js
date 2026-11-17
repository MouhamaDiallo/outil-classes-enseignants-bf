// Moteur de l'application : mêmes calculs que analyse/07_binaires.py et analyse/10_optimisation.py,
// à partir du même fichier de paramètres. Module sans dépendance : le solveur GLPK (glpk.js) est
// passé en argument, pour tourner dans le navigateur comme dans Node (tests de concordance).
// Node : version CommonJS (dist/glpk.js) ; navigateur : version avec worker (dist/index.js).

const OPERATEURS = {
  ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b,
  "<=": (a, b) => a <= b, "==": (a, b) => a === b,
};

export const CLASSES = ["urgence", "surcharge", "vigilance", "stable", "donneuse"];

// Variables d'une année : réglages généraux, modifiés par le bloc « par_annee ».
export function reglagesAnnee(p, annee) {
  const variables = structuredClone(p.variables);
  for (const [code, changement] of Object.entries(p.par_annee?.[annee] ?? {})) {
    if (!variables[code]) continue;
    if ("actif" in changement) variables[code].actif = changement.actif;
    if ("seuil" in changement) variables[code].conditions[0].seuil = changement.seuil;
  }
  return variables;
}

// Variables binaires et classe de priorité de chaque province, pour chaque année d'historique.
export function calculerBinaires(donnees, p) {
  const lignes = [];
  for (const annee of donnees.annees_historique) {
    const plafond = p.plafond_par_annee[annee];
    const variables = reglagesAnnee(p, annee);
    const role = (r) => Object.keys(variables).filter((c) => variables[c].role === r);
    for (const prov of donnees.provinces) {
      const h = prov.historique[annee];
      if (!h) continue;
      const ind = { ...h, croissance_6_11_relative: prov.croissance_6_11_relative, zone_officielle: prov.zone_officielle };
      const b = {};
      for (const [code, v] of Object.entries(variables)) {
        let vrai = v.actif;
        for (const c of v.conditions) {
          const valeur = c.indicateur in b ? b[c.indicateur] : ind[c.indicateur];
          const seuil = c.seuil === "plafond" ? plafond : c.seuil;
          if (valeur === null || valeur === undefined || !OPERATEURS[c.op](valeur, seuil)) vrai = false;
        }
        b[code] = vrai ? 1 : 0;
      }
      let correction = null;
      for (const corr of p.corrections ?? []) {
        if (corr.annee === annee && corr.province === prov.nom && corr.variable in b) {
          b[corr.variable] = Number(corr.valeur);
          correction = `${corr.variable} = ${corr.valeur} : ${corr.justification} (${corr.auteur})`;
        }
      }
      const un = (r) => (role(r).some((c) => b[c] === 1) ? 1 : 0);
      const surcharge = un("surcharge"), crise = un("crise"), salles = un("salles");
      const croissance = un("croissance"), donneuse = un("donneuse");
      let priorite = "stable";
      if (donneuse) priorite = "donneuse";
      if (!surcharge && ind.eleves_par_maitre > p.regles.seuil_vigilance && crise) priorite = "vigilance";
      if (surcharge) priorite = "surcharge";
      if (surcharge && crise) priorite = "urgence";
      let typeSalle = "";
      if (salles && b.B3 === 1 && !croissance) typeSalle = "ETA";
      if (salles && croissance) typeSalle = "dur";
      lignes.push({ annee, province: prov.nom, region: prov.region_ancienne, plafond, ...b, priorite,
        salles: typeSalle, ecart_plafond: Math.round((ind.eleves_par_maitre - plafond) * 10) / 10, correction });
    }
  }
  return lignes;
}

// Classes avec enseignant au départ, et enseignants sans classe disponibles pour en ouvrir
// (même règle que disponibilite() dans analyse/10_optimisation.py) : les enseignants sans classe
// (hors directeurs) couvrent d'abord les classes sans enseignant attitré de la province.
export function disponibilite(q) {
  const o = q.offre_2024;
  const classesSansMaitre = Math.max(0, o.classes - o.maitres);
  const manque = Math.max(0, classesSansMaitre - o.sans_classe);
  return { classes: o.classes - manque, disponibles: Math.max(0, o.sans_classe - classesSansMaitre) };
}

// Élèves projetés et salles rendues par les écoles qui rouvrent (même calcul que serie() dans
// analyse/10_optimisation.py) : T(t) = E(t-1) × croissance des 6-11 ans ; E(t) = T(t) + k(t) × max(0, R(t) - T(t)),
// R(t) = niveau d'avant la crise. k(t) = rattrapage observé avant « debut », puis 0 (« figee »),
// le rattrapage observé (« reprise ») ou rythme_pct (« retour »). Renvoie { eleves: {année: x}, salles: {année: n} }.
export function serieEleves(p, q, annees) {
  const sc = p.securite, kObs = sc.rattrapage_pct / 100;
  const kApres = { figee: 0, reprise: kObs, retour: (sc.rythme_pct ?? 40) / 100 }[sc.scenario];
  const h0 = q.historique["2018-2019"];
  const sallesParEleve = ((h0.salles / h0.eleves) * (sc.salles_reutilisables_pct ?? 100)) / 100;
  let e = q.offre_2024.eleves, seul = e;
  const eleves = {}, salles = {};
  for (const a of annees) {
    const k = a < sc.debut ? kObs : kApres, g = q.croissance[a];
    const t = e * g;
    e = t + k * Math.max(0, q.reference[a] - t);
    seul *= g;
    eleves[a] = e;
    salles[a] = Math.floor(Math.max(0, e - seul) * sallesParEleve);
  }
  return { eleves, salles };
}

// Leviers de chaque année : réglages par défaut, puis changements reportés d'année en année.
function leviers(p, annees) {
  let courant = { ...p.leviers_par_annee.defaut };
  const sortie = {};
  for (const a of annees) {
    courant = { ...courant, ...(p.leviers_par_annee[a] ?? {}) };
    sortie[a] = { ...courant };
  }
  return sortie;
}

// Plan d'ouverture de classes, de 2025-26 à 2030-31 (programme linéaire, résolu par GLPK).
// options.argent : argent pour les salles par an (FCFA), à la place du budget des paramètres.
export async function calculerPlan(donnees, p, binaires, glpk, options = {}) {
  const annees = donnees.annees_projection;
  const derniere = donnees.annees_historique.at(-1);
  const lev = leviers(p, annees);
  const bud = Object.fromEntries(annees.map((a) => {
    const b = { ...p.budgets_par_annee.defaut, ...(p.budgets_par_annee[a] ?? {}) };
    if (options.argent !== undefined) b.argent_salles_fcfa = options.argent;
    return [a, b];
  }));
  const c = p.couts, vie = Math.round(c.duree_vie_eta_ans);
  const reserve = p.reserve_suppleants_pct / 100, respect = p.taux_respect_affectation_pct / 100;
  const perteDf = 1 - p.valeur_pedagogique_double_flux_pct / 100;
  const bin = Object.fromEntries(binaires.filter((l) => l.annee === derniere).map((l) => [l.province, l]));
  // redéploiement : paires de provinces de la même ancienne région (même règle que Python)
  const provs = donnees.provinces;
  const paires = [];
  provs.forEach((q, i) => provs.forEach((r, k) => { if (i !== k && q.region_ancienne === r.region_ancienne) paires.push([i, k]); }));
  const partRed = (p.redeploiement_region_pct ?? 0) / 100;
  const series = provs.map((q) => serieEleves(p, q, [...(donnees.annees_sans_plan ?? []), ...annees]));
  const demande = (i, j) => series[i].eleves[annees[j]];

  const obj = [], contraintes = [], bornes = [];
  const n = (k, i, j) => `${k}_${i}_${j}`;
  const ajout = (nom, vars, type, valeur) => contraintes.push({ name: nom, vars,
    bnds: { type: type === "<=" ? glpk.GLP_UP : glpk.GLP_LO, ub: type === "<=" ? valeur : 0, lb: type === ">=" ? valeur : 0 } });
  const fixe0 = (nom) => bornes.push({ name: nom, type: glpk.GLP_FX, lb: 0, ub: 0 });

  donnees.provinces.forEach((q, i) => {
    const { classes: g0, disponibles } = disponibilite(q), s0 = q.offre_2024.salles;
    const libres = Math.max(0, s0 - g0);
    const dispo = Math.floor(disponibles * (1 - reserve));
    const b = bin[q.nom] ?? {};
    const etaPermis = (b.B3 === 1 || b.B4 === 1) && b.B7 !== 1;
    annees.forEach((a, j) => {
      const L = lev[a], plafond = p.plafond_par_annee[a];
      const envoyes = paires.filter(([a, b]) => a === i).map(([, b]) => ({ name: `red_${i}_${b}_${j}`, coef: 1 }));
      const recus = paires.filter(([, b]) => b === i).map(([a]) => ({ name: `red_${a}_${i}_${j}`, coef: 1 }));
      ajout(n("dispo", i, j), [{ name: n("s", i, j), coef: 1 }, ...envoyes], "<=", dispo);
      if (envoyes.length) ajout(n("envoi", i, j), envoyes, "<=", Math.floor(dispo * partRed));
      ajout(n("suppl", i, j), [{ name: n("s", i, j), coef: 1 }, ...recus, { name: n("o", i, j), coef: -1 }], "<=", 0);
      const ens = [{ name: n("o", i, j), coef: 1 }, { name: n("s", i, j), coef: -1 }, ...recus.map((x) => ({ ...x, coef: -1 }))];
      for (let k = 0; k <= j; k++) ens.push({ name: n("r", i, k), coef: -1 });
      ajout(n("ens", i, j), ens, "<=", 0);
      const sal = [{ name: n("o", i, j), coef: 1 }, { name: n("f", i, j), coef: -1 }];
      for (let k = 0; k <= j; k++) sal.push({ name: n("d", i, k), coef: -1 });
      for (let k = Math.max(0, j - vie + 1); k <= j; k++) sal.push({ name: n("e", i, k), coef: -1 });
      ajout(n("sal", i, j), sal, "<=", libres + series[i].salles[a]);
      ajout(n("dfmax", i, j), [{ name: n("f", i, j), coef: 1 }], "<=", s0);
      // une classe ouverte reste ouverte (réglage « classes_definitives »), comme dans Python
      if (p.classes_definitives && j > 0) ajout(n("def", i, j), [{ name: n("o", i, j), coef: 1 }, { name: n("o", i, j - 1), coef: -1 }], ">=", 0);
      ajout(n("exc", i, j), [{ name: n("x", i, j), coef: 1 }, { name: n("o", i, j), coef: plafond }], ">=",
        demande(i, j) - plafond * g0);
      if (!(L.eta && etaPermis)) fixe0(n("e", i, j));
      if (!L.salle_dur) fixe0(n("d", i, j));
      if (!L.suppleants) fixe0(n("s", i, j));
      if (!L.recrutement) fixe0(n("r", i, j));
      if (!L.redeploiement) envoyes.forEach((x) => fixe0(x.name));
      if (!L.double_flux || (b.B4 === 1 && !L.double_flux_si_fermetures)) fixe0(n("f", i, j));
      // une recrue est comptée en années de salaire, de son embauche à la dernière année
      obj.push({ name: n("x", i, j), coef: 1 }, { name: n("f", i, j), coef: perteDf * plafond },
        { name: n("r", i, j), coef: 1e-3 * (annees.length - j) }, { name: n("s", i, j), coef: 1e-4 },
        ...envoyes.map((x) => ({ name: x.name, coef: 2e-4 })),
        { name: n("e", i, j), coef: 1e-9 * c.eta_fcfa }, { name: n("d", i, j), coef: 1e-9 * c.salle_dur_fcfa });
    });
  });
  annees.forEach((a, j) => {
    const argent = [], postes = [];
    donnees.provinces.forEach((_, i) => {
      argent.push({ name: n("e", i, j), coef: c.eta_fcfa }, { name: n("d", i, j), coef: c.salle_dur_fcfa });
      postes.push({ name: n("r", i, j), coef: 1 });
    });
    ajout(`argent_${j}`, argent, "<=", bud[a].argent_salles_fcfa);
    ajout(`postes_${j}`, postes, "<=", Math.floor(bud[a].postes_nouveaux_enseignants * respect));
  });

  // dans le navigateur, glpk.js calcule dans un worker et renvoie une promesse ; dans Node, un résultat
  const res = await glpk.solve({ name: "plan_classes", objective: { direction: glpk.GLP_MIN, name: "obj", vars: obj },
    subjectTo: contraintes, bounds: bornes }, { msglev: glpk.GLP_MSG_OFF });
  const v = res.result.vars, val = (k) => Math.round(v[k] ?? 0);

  const flux = [];
  annees.forEach((a, j) => paires.forEach(([i, k]) => {
    const nb = val(`red_${i}_${k}_${j}`);
    if (nb > 0) flux.push({ annee: a, de: provs[i].nom, vers: provs[k].nom, region: provs[i].region_ancienne, enseignants: nb });
  }));
  const plan = [];
  donnees.provinces.forEach((q, i) => {
    const g0 = disponibilite(q).classes;
    annees.forEach((a, j) => {
      const plafond = p.plafond_par_annee[a], e = demande(i, j), ouv = val(n("o", i, j));
      const eta = val(n("e", i, j)), dur = val(n("d", i, j));
      plan.push({ annee: a, province: q.nom, region: q.region_ancienne, eleves: Math.round(e), plafond,
        suppleants: val(n("s", i, j)), recrues: val(n("r", i, j)), eta, salles_dur: dur,
        redeployes_recus: flux.filter((f) => f.annee === a && f.vers === q.nom).reduce((t, f) => t + f.enseignants, 0),
        redeployes_envoyes: flux.filter((f) => f.annee === a && f.de === q.nom).reduce((t, f) => t + f.enseignants, 0),
        double_flux: val(n("f", i, j)), classes_supplementaires: ouv, classes_total: g0 + ouv,
        eleves_par_classe_sans_action: Math.round((e / g0) * 10) / 10,
        eleves_par_classe_avec_plan: Math.round((e / (g0 + ouv)) * 10) / 10,
        surnombre_sans_action: Math.max(0, Math.round(e - plafond * g0)),
        surnombre_avec_plan: Math.max(0, Math.round(e - plafond * (g0 + ouv))),
        cout_salles_fcfa: eta * c.eta_fcfa + dur * c.salle_dur_fcfa });
    });
  });
  return { plan, flux, statut: res.result.status === glpk.GLP_OPT ? "optimal" : `statut ${res.result.status}`, temps: res.time };
}

// Totaux par année. Une province compte « au-dessus du plafond » à partir de 30 élèves en surnombre.
export function synthese(plan) {
  const par = {};
  for (const l of plan) {
    const s = (par[l.annee] ??= { annee: l.annee, eleves: 0, surnombre_sans_action: 0, surnombre_avec_plan: 0,
      suppleants: 0, redeployes_recus: 0, recrues: 0, eta: 0, salles_dur: 0, double_flux: 0, cout_salles_fcfa: 0,
      provinces_sans_action: 0, provinces_avec_plan: 0 });
    for (const k of ["eleves", "surnombre_sans_action", "surnombre_avec_plan", "suppleants", "redeployes_recus", "recrues", "eta",
      "salles_dur", "double_flux", "cout_salles_fcfa"]) s[k] += l[k];
    if (l.surnombre_sans_action >= 30) s.provinces_sans_action += 1;
    if (l.surnombre_avec_plan >= 30) s.provinces_avec_plan += 1;
  }
  return Object.values(par);
}

// Test de concordance : le moteur de l'application doit redonner les résultats de Python
// (analyse/07_binaires.py et analyse/10_optimisation.py) pour le scénario de référence.
// Lancer depuis le dossier app : node tests/concordance.mjs <chemin vers glpk.js/dist/glpk.js>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { calculerBinaires, calculerPlan } from "../moteur.js";

const GLPK = createRequire(import.meta.url)(process.argv[2]);
const glpk = await GLPK();
const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const donnees = lire("donnees.json"), p = lire("parametres.json"), ref = lire("reference_python.json");

const binaires = calculerBinaires(donnees, p);
const ecarts = binaires.filter((l) => ref.binaires[`${l.annee}|${l.province}`] !== l.priorite);
console.log(`Binaires : ${binaires.length} lignes, ${ecarts.length} écart(s) avec Python`);
ecarts.slice(0, 5).forEach((l) => console.log("  ", l.annee, l.province, l.priorite, "Python :", ref.binaires[`${l.annee}|${l.province}`]));

const t0 = Date.now();
const { plan, statut } = await calculerPlan(donnees, p, binaires, glpk);
const total = plan.reduce((s, l) => s + l.surnombre_avec_plan, 0);
console.log(`Plan : ${statut} en ${Date.now() - t0} ms ; surnombre total ${total} (Python ${ref.plan_surnombre_total})`);

for (const { argent_salles_milliards_fcfa_par_an: m, surnombre_avec_plan_total: py } of ref.courbe) {
  const r = await calculerPlan(donnees, p, binaires, glpk, { argent: m * 1e9 });
  const js = r.plan.reduce((s, l) => s + l.surnombre_avec_plan, 0);
  console.log(`Courbe ${String(m).padStart(2)} milliards : JS ${js}, Python ${py}, écart ${(100 * (js - py) / Math.max(py, 1)).toFixed(2)} %`);
}

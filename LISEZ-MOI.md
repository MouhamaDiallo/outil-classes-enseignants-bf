# Application : classes et enseignants du primaire public

Outil d'aide à la décision. Six écrans : la situation (carte, chiffres clés), la frise des priorités
2017-2025, le simulateur (plan 2025-2031 recalculé dans le navigateur), les réglages (variables, corrections
justifiées, nouvelles variables, scénarios), la fiche imprimable par province, la méthode et les sources.

## Lancer en local
Depuis ce dossier : `python -m http.server 8765`, puis ouvrir http://localhost:8765 (une connexion Internet
est nécessaire pour les bibliothèques : Leaflet, Chart.js, glpk.js).

## Mettre à jour avec une nouvelle année
1. Ajouter le nouvel annuaire DGESS dans le Data Pack et relancer les scripts `analyse/01` à `analyse/12`.
2. `analyse/12_export_app.py` régénère `data/` ; l'application se met à jour sans autre changement.

## Fichiers
- `moteur.js` : calculs (variables binaires, plan optimisé avec le solveur GLPK). Mêmes calculs que Python.
- `app.js`, `index.html`, `style.css` : l'interface.
- `data/parametres.json` : le scénario de référence (même format que `analyse/parametres`).
- `tests/concordance.mjs` : vérifie que le moteur redonne les résultats de Python
  (`node tests/concordance.mjs <glpk.js/dist/glpk.js>`).
- `tests/navigateur.mjs` : banc de test dans un vrai navigateur (captures d'écran).

Données : uniquement des sources publiques (annuaires DGESS, CONASUR, INSD, OCHA), agrégées par province.

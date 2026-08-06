# Analytics et copilote IA

**Statut :** Draft  
**Version :** 0.1

## Dashboard dirigeant

Vue par défaut :

- chiffre d’affaires;
- marge;
- résultat;
- trésorerie;
- BFR;
- progression des objectifs;
- écarts majeurs;
- alertes et actions.

## Filtres

Projet, scénario, plan de référence, période, granularité, catégorie, produit/service et devise de présentation. Les filtres appliqués apparaissent dans les exports.

## Graphiques

- tendance plan/réalisé/projection;
- waterfall des écarts;
- répartition des revenus et charges;
- trésorerie et seuil minimum;
- contribution à la marge;
- progression des objectifs;
- échéancier de dette;
- sensibilité des variables.

Chaque graphique possède une alternative tabulaire.

## Centre de décision

Une recommandation contient :

- constat chiffré;
- période et comparaison;
- variables influentes;
- action proposée;
- impact estimé par le moteur de scénario;
- effort ou risque;
- responsable, échéance et statut.

## Rôle de l’IA

Autorisé :

- expliquer les résultats structurés;
- résumer les écarts;
- reformuler un concept;
- proposer des questions;
- classer des commentaires;
- générer un résumé exécutif;
- suggérer des scénarios à confirmer.

Interdit :

- calculer les états officiels;
- inventer une règle fiscale;
- modifier une entrée sans confirmation;
- masquer une incertitude;
- fournir un conseil juridique ou fiscal comme certain;
- utiliser les données d’une organisation pour une autre.

## Contexte envoyé au modèle

Le contexte est minimal, structuré et autorisé : métriques nécessaires, définitions, période, Country Pack, objectifs et consigne. Les données personnelles inutiles et pièces brutes sont exclues.

## Garde-fous

- vérification des nombres cités contre les résultats du moteur;
- liens vers les preuves;
- avertissement sur les limites;
- journal du modèle, version de prompt et sources;
- validation humaine avant publication d’un rapport;
- possibilité de désactiver l’IA par organisation;
- politique de conservation configurable.

## Qualité

Tests sur exactitude des citations numériques, absence de fuite inter-tenant, refus des instructions malveillantes, stabilité des formats et qualité des recommandations. L’IA est évaluée séparément du moteur financier.

## Actions correctives sur les ratios (S14a)

L’endpoint `POST /ai/corrective-actions` lit les lignes de la feuille `ratios`
produites par un `evaluate` et propose 2 à 4 corrections concrètes pour les
ratios en zone rouge ou orange (DSCR, apport, payback, trésorerie mini, etc.).

Règles :

- l’IA n’effectue AUCUN calcul et ne modifie AUCUNE feuille officielle;
- elle ne cite que des valeurs présentes dans l’entrée (valeur courante ou seuil);
- les suggestions restent qualitatives (« réduire », « renégocier », « phaser »);
- la réponse est validée par schéma Zod strict avant renvoi;
- toute action référençant un ratio hors périmètre est rejetée.

Backends :

- LLM : OpenAI `gpt-4o-mini` via SDK officiel; clé lue dans la variable
  d’environnement `OPENAI_API_KEY` (jamais versionnée);
- fallback déterministe : si la clé est absente, si le SDK n’est pas installé,
  ou si la réponse LLM est invalide, un jeu de règles codées en dur retourne
  une suggestion par ratio surveillé. Ce chemin est entièrement testable sans
  réseau et sert de filet de sécurité en production.

Le champ `source` de la réponse (`"llm"` ou `"fallback"`) permet à l’interface
d’indiquer clairement à l’utilisateur d’où viennent les suggestions.

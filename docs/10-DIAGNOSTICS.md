# Diagnostics financiers

**Statut :** Draft  
**Version :** 0.1

## Structure commune

Un diagnostic retourne :

- code stable;
- statut;
- score facultatif;
- période;
- métriques et seuils utilisés;
- faits chiffrés;
- explication;
- causes contributrices;
- recommandations;
- gravité et confiance;
- version de règle.

Le statut n’est jamais affiché sans son explication.

## Rentabilité

Évalue résultat, marges, seuil de rentabilité, point mort et persistance sur l’horizon.

Statuts initiaux : `rentable`, `fragile`, `non_rentable`, `indetermine`.

Message attendu :

> Contrôle de votre seuil de rentabilité : d’après les éléments indiqués, votre projet est [statut]. [Explication et conseil].

## Trésorerie de départ

Compare le solde initial au besoin maximum cumulé, au minimum de sécurité et au calendrier des flux.

Statuts : `adequate`, `faible`, `critique`, `indetermine`.

Message attendu :

> Contrôle du niveau de votre trésorerie de départ : d’après les éléments indiqués, votre trésorerie est [statut]. [Montant du besoin et conseil].

## Financement

Évalue la couverture des besoins durables, le service de dette, la structure apport/dette et les tensions de trésorerie.

Statuts : `coherent`, `sous_finance`, `surdimensionne`, `risque`.

## Objectifs

Pour chaque objectif :

```text
taux_atteinte = valeur_observee / valeur_cible
```

La formule exacte gère les objectifs où une valeur inférieure est préférable, les cibles nulles et les plages. Les seuils sont configurés et testés.

- efficacité : atteinte de la cible;
- efficience : atteinte rapportée aux ressources;
- performance : synthèse multi-critères.

Les mots « efficace », « efficient » et « performant » sont accompagnés de leurs définitions et valeurs.

## Autres diagnostics planifiés

Liquidité, BFR, marge, endettement, solvabilité, investissement, risque fiscal, croissance, capacité d’autofinancement et sensibilité.

Ils ne doivent pas tous être lancés en MVP. La priorité est donnée aux diagnostics explicables et actionnables.

## Recommandations

Une recommandation :

- cite les métriques;
- indique la variable actionnable;
- ne promet pas un résultat;
- peut proposer un scénario calculé;
- tient compte du pays et du secteur seulement si les données sont validées;
- distingue urgence, impact et effort.

## Tests

- cas limite et division par zéro;
- données manquantes;
- changements de signe;
- seuil exact;
- plusieurs années contradictoires;
- objectif déjà dépassé;
- cohérence message/calcul;
- stabilité entre API, écran et export.

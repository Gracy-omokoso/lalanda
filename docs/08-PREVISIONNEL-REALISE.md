# Prévisionnel, réalisé et projection

**Statut :** Draft  
**Version :** 0.1

## Séparation des concepts

- **Plan** : référence validée et immuable.
- **Réalisé** : données observées.
- **Projection** : estimation actualisée de la fin de période.
- **Scénario** : jeu alternatif d’hypothèses.

Aucune saisie du réalisé ne modifie rétroactivement le plan.

## Périodes

Une période passe par : ouverte, en révision, clôturée, rouverte. La réouverture exige une permission, un motif et une trace d’audit.

## Saisie et import

Sources possibles :

- saisie manuelle agrégée;
- import CSV/Excel mappé;
- intégration comptable ou bancaire future;
- ajustement autorisé.

Chaque donnée conserve source, auteur, date, pièce éventuelle, devise, taux de conversion, catégorie et statut de validation.

## Rapprochement

Le mapping relie une catégorie réalisée à une ligne du plan. Les éléments non mappés restent dans une file de traitement. Les doublons potentiels et incohérences de période sont signalés.

## Écarts

Pour chaque métrique :

- valeur planifiée;
- valeur réalisée;
- écart absolu;
- écart relatif si la base est non nulle;
- cumul annuel;
- tendance;
- commentaire;
- responsable et action.

Les écarts favorables et défavorables tiennent compte du type de métrique : une charge inférieure peut être favorable, un revenu inférieur ne l’est pas.

## Projection

La projection combine réalisé clôturé et hypothèses restantes. La méthode utilisée est affichée. L’utilisateur peut remplacer une suggestion par une hypothèse explicite.

## Alertes

- trésorerie sous le minimum;
- revenu en retard;
- coût ou charge au-dessus du seuil;
- marge en dégradation;
- retard d’encaissement;
- dette ou taxe à échéance;
- objectif devenu improbable.

Une alerte possède gravité, preuve, période, cause probable, recommandation, responsable, échéance et statut.

## Critères d’acceptation

- Les périodes clôturées sont protégées.
- Les écarts sont reproductibles.
- Le mapping est versionné.
- Les imports peuvent être annulés sans effacer d’autres données.
- Toute projection distingue clairement observation et estimation.

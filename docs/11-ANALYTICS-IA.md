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

## Interprétation des résultats et assistant « Lala » (S24a)

Deux besoins distincts, deux points d'API.

| Point d'API | Rôle |
|---|---|
| `POST /ai/interpretations` | une LECTURE par ligne de résultat affichée |
| `POST /ai/lala/messages` | l'échange ouvert depuis une interprétation |

### Interprétation ≠ définition ≠ recommandation

Une interprétation lit **ce chiffre-là** : « votre DSCR ressort à 0,82, sous le
repère de 1,25 ; le feu est rouge ». Elle ne définit pas le concept —
`/aide/*` le fait déjà — et elle ne prescrit rien : les actions à mener
relèvent de `POST /ai/corrective-actions`. Chaque texte est accompagné d'une
mention servie par l'API, jamais laissée au client :

> Lecture d'un chiffre calculé par le moteur financier. Ce n'est ni un conseil
> en investissement, ni un conseil juridique, comptable ou fiscal.

### Vérification des citations numériques

`docs/11 § Garde-fous` demande la « vérification des nombres cités contre les
résultats du moteur ». Un prompt qui *demande* de ne pas inventer de chiffre
n'est pas une vérification, c'est un souhait. `lala-nombres.ts` relit donc le
texte rendu et rejette tout nombre absent de ce qui a été fourni au modèle :

- valeurs et seuils des lignes transmises, sous leur forme brute **et** sous
  leur rendu affiché (un pourcentage stocké `0,185` est citable « 18,5 % ») ;
- nombres déjà présents dans les libellés du moteur (« exercice 3 ») et dans les
  réserves de portée injectées (« sur 12 mois ») ;
- le zéro seul, repère de signe qui n'affirme aucune grandeur.

La comparaison porte sur des **magnitudes** canonisées en lecture fr-FR
(virgule décimale, espace insécable en milliers) : le signe est porté par la
prose, pas par le nombre extrait. Une interprétation refusée retombe sur sa
lecture déterministe, **ligne par ligne** — une mauvaise lecture n'emporte pas
les bonnes.

### Repli déterministe

Même motif que `/ai/corrective-actions` : `interpretationDeterministe` écrit le
texte à partir des seuls chiffres du moteur, sans réseau. Il sert deux fois — de
repli quand l'IA est indisponible, et de filet quand l'IA répond mal (chiffre
inventé, texte vide, texte anormalement long). Le champ `source`, porté **par
ligne** et globalement, permet à l'interface de dire d'où vient chaque texte :
elle affiche « Rédigé par Lala » ou « Lecture automatique », jamais l'un pour
l'autre.

### Trésorerie mensuelle — la réserve est structurelle

La feuille `tresorerie` est une vue simplifiée et **optimiste** qui diverge du
bilan (docs/07 § Limites connues). Sa réserve n'est pas confiée au modèle :
le service la renvoie dans `avertissementFeuille` et la RAJOUTE au texte, quelle
que soit la source. Elle est également rattachée à `tresorerie_min_ok`, qui
s'affiche dans `ratios` mais dont le feu tricolore est calculé sur cette vue —
sans quoi le ratio le plus regardé du bandeau serait le seul à la perdre.

### Langue

Lala répond dans la langue des préférences de l'utilisateur, lue côté serveur
(`AccountService.getPreferences`) et jamais dans le corps de la requête. Le
registre `LANGUES` de `lala-interpretation.ts` `satisfies
Record<SupportedLocale, …>` : ajouter une langue à `SUPPORTED_LOCALES` sans
écrire sa formulation ne compile pas.

### Quotas par offre — point d'accroche

Le quota de messages Lala par abonnement **n'est pas** implémenté dans le module
IA ; il appartient au chantier offres. Deux accroches lui sont laissées :

- **le garde** : `LalaController` déclare `AuthGuard` → `PermissionsGuard` au
  niveau du contrôleur, puis `UserThrottlerGuard` au niveau de la méthode. Un
  garde de quota s'ajoute à ce `@UseGuards` de méthode : il s'exécute donc après
  l'authentification (`req.user`, `req.orgId` résolus) et avant le service,
  c'est-à-dire avant tout appel facturé ;
- **le compteur** : `AiUsageService.record` est appelé après la réponse avec les
  actions stables `ai.interpretations` et `ai.lala_chat`. Le champ `source`
  distingue un appel réellement facturé (`llm`) d'un repli déterministe
  (`fallback`) — un utilisateur dont l'IA est indisponible ne doit pas voir son
  quota entamé.

## Bornes techniques des appels OpenAI (S22h)

Chaque appel au modèle est borné. Ce n’est pas une mesure de coût — un appel
`gpt-4o-mini` se compte en millièmes de dollar — mais une mesure technique :
sans plafond, une réponse anormalement longue ou un prompt qui boucle occupe
une requête HTTP, de la mémoire et du temps sans limite.

| Borne | Variable | Défaut | Bornes acceptées |
|---|---|---|---|
| Jetons en sortie (`max_tokens`) | `OPENAI_MAX_OUTPUT_TOKENS` | 1024 | 256 – 4096 |
| Délai maximal d’un appel | `OPENAI_TIMEOUT_MS` | 15000 ms | 1000 – 60000 |

Règles :

- **un déploiement sans configuration est borné**, jamais illimité : les défauts
  s’appliquent d’office;
- une valeur invalide ou hors bornes est **ignorée au profit du défaut**, avec un
  avertissement — jamais appliquée en silence;
- le plafond de jetons est dimensionné sur la réponse légitime la plus longue :
  4 actions (maximum du schéma) ≈ 470 jetons en français, soit ~2,2× de marge;
- un dépassement (réponse tronquée `finish_reason="length"`, ou délai écoulé)
  **retombe sur le repli déterministe** : l’utilisateur reçoit des suggestions
  normales, aucune erreur ne remonte;
- **aucun repli n’est silencieux** : chaque repli est journalisé avec un préfixe
  stable (`Repli déterministe :`) et la cause nommée par son type
  (`OpenAITimeoutError`, `OpenAITruncatedResponseError`, `ClientAbsent`…).
  L’absence totale de client OpenAI est signalée une fois par processus — c’est
  un état de configuration, pas un incident par requête.

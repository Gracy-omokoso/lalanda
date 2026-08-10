# ADR-0017 — Ce que « désactivée » veut dire pour une intégration

**Statut :** accepté · **Date :** 2026-08-10 · **Précise :** [ADR-0013](ADR-0013-stockage-secrets-integration.md)

## Contexte

Le schéma `integrations` porte un booléen `enabled` depuis S21b, et `/admin` en
affiche l'état : « **Configurée, inactive** — les secrets sont en place mais
l'intégration n'est pas activée ». Le journal d'audit enregistre
`integration.enabled` / `integration.disabled`.

`SecretsService.resolveUncached` ne lisait jamais ce champ. Un enregistrement
désactivé livrait sa clé déchiffrée comme un enregistrement actif.

Constaté sur l'installation de développement : l'intégration `openai` était à
`enabled: false`, et `POST /ai/corrective-actions` répondait `source: "llm"` —
un appel réel, facturé, déclenché par une intégration que la console annonçait
inactive.

Un interrupteur qui n'interrompt rien est plus dangereux que pas d'interrupteur :
il produit une certitude fausse. L'opérateur qui coupe une intégration pour
arrêter une facturation, contenir un incident ou révoquer un accès croit avoir
agi.

## Décision

**Un enregistrement d'intégration présent et `enabled: false` ne fournit aucun
secret, et ne retombe pas sur l'environnement.**

Trois cas, et un seul comportement par cas :

| État en base | Résolution |
|---|---|
| Aucun enregistrement | Secours par l'environnement (amorçage), inchangé |
| Enregistrement `enabled: true` | Secret déchiffré depuis la base, `source: 'db'` |
| Enregistrement `enabled: false` | **`null`** — ni base, ni environnement |

Le test de `enabled` a lieu **avant** celui du coffre. `enabled` est un
interrupteur d'exploitation : il doit valoir même quand `SECRETS_MASTER_KEY` est
absente. Sans cela, un déploiement sans coffre ignorerait la désactivation et
repartirait sur l'environnement — le cas où l'interrupteur ment le plus
gravement, puisque personne ne relie une clé maîtresse manquante à une
intégration qu'on croyait coupée.

## Pourquoi pas de repli sur l'environnement

C'est le point qui se discute, et il est tranché par ADR-0013 §C. Cette section
rejette l'hybride permanent pour une raison précise : « une variable
d'environnement oubliée masque silencieusement une clé pourtant rotée en base ».

Retomber sur `env` après une désactivation produirait ce défaut exact, avec une
conséquence pire : l'opérateur a agi explicitement, et les appels continuent
depuis une variable qu'il ne regarde plus. La désactivation deviendrait un
changement de source silencieux au lieu d'un arrêt.

L'absence d'enregistrement, elle, n'est pas une décision — c'est un amorçage. Le
secours continue d'y jouer, sinon toute installation neuve perdrait
`OPENAI_API_KEY` et `S3_SECRET_KEY` avant même d'avoir une console pour les
saisir.

## Conséquences

**Ce qui s'arrête vraiment.** Couper une intégration dans `/admin` arrête les
appels sortants du fournisseur. Pour l'IA, le repli déterministe prend la main :
l'utilisateur continue de recevoir des suggestions, et chaque repli est
journalisé avec sa cause (S22h). Aucune panne visible, aucun échec silencieux.

**Le délai.** `SecretsService` met les résolutions en cache 60 secondes. Une
désactivation prend donc effet en moins d'une minute, pas instantanément. C'est
le comportement existant du cache, il n'est pas modifié ici — mais il doit être
connu de qui coupe une intégration en urgence.

**Portée.** La règle vaut pour tous les fournisseurs, présents et futurs. Au
moment de la décision, `openai` est le seul enregistrement existant ; les autres
fournisseurs n'ont pas de document et restent donc sur le chemin d'amorçage.

**Ce qui n'est pas traité.** L'affichage de `/admin` n'était pas faux, il était
seulement prématuré : il décrivait le comportement voulu, que la résolution
n'appliquait pas. Il reste inchangé, et devient exact.

## Alternative rejetée

**Corriger l'affichage plutôt que le comportement** — c'est-à-dire admettre
qu'une clé posée est une clé active, et retirer de `/admin` la mention
« inactive ».

Moins de code, aucun risque de coupure. Rejeté parce que le produit perdrait tout
moyen d'arrêter un fournisseur sans supprimer ses secrets — donc sans les ressaisir
pour le rallumer. Un interrupteur qui n'existe pas est plus honnête qu'un
interrupteur qui ment, mais un interrupteur qui marche vaut mieux que les deux.

# Pricing, essai et entitlements

**Statut :** Grille arbitrée par le décideur — appliquée par l'API  
**Version :** 1.0

## Principes

- Quatre offres en libre-service, plus une offre sur devis.
- Essai gratuit de 14 jours.
- Paiement mensuel ou annuel.
- Prix annuel présenté avec économie réelle.
- Limites appliquées par entitlements, pas par conditions dispersées.
- **L'interface peut expliquer une limite, mais l'API l'impose.**

## La grille

| | Free | Pro | Cabinet | Business | Expert |
|---|---:|---:|---:|---:|---:|
| Mensuel USD | 0 | 19 | 39 | 79 | sur devis |
| Annuel USD | — | 190 | 390 | 790 | sur devis |
| Projets | 1 | 5 | 20 | illimités | illimités |
| Exports PDF | 3/mois filigranés | 30/mois | 100/mois | illimités | illimités |
| Messages IA | 20/mois | 500/mois | 1 500/mois | 2 000/mois | illimités |
| Sièges | 1 | 1 | 3 | 20 | négocié |
| Suivi du réalisé | non | oui | oui | oui | oui |
| Export Excel | oui | oui | oui | oui | oui |
| Historique des versions | non | oui | oui | oui | oui |
| White-label | non | non | non | oui | oui |
| Accès API | non | non | non | oui | oui |
| Temps d'expert humain | non | non | non | non | oui |
| Support | documentation | email | email | prioritaire | dédié |

### Où vivent ces nombres

**Un seul endroit : `packages/shared/src/pricing/index.ts` (`PLAN_CATALOG`).**

Ce module est importé par `apps/api` **et** par `apps/web`. Aucun montant, aucune
limite n'est écrit ailleurs dans le dépôt — ni dans les entitlements de l'API, ni
dans la page tarifs, ni dans le tunnel de souscription, ni dans les tests. Changer
un prix, c'est éditer `PLAN_CATALOG`, une seule fois.

Ce n'était pas le cas jusqu'ici : la grille était écrite dans
`apps/api/src/billing/entitlements.ts`, dans
`apps/api/src/billing/pricing-catalog.ts`, dans le modèle de la page tarifs, **et
une quatrième fois dans le test qui vérifiait la cohérence des trois**. C'est ce
dispositif qui a laissé la page publique annoncer un tarif annuel Business que
l'API refusait de vendre.

Les montants sont en **centimes entiers**. Aucun flottant ne traverse une facture.

### L'offre Expert n'est pas en libre-service

Elle porte `selfServe: false` et **aucun montant publié** :

- pas de prix sur la page tarifs — une carte « Nous contacter », de forme
  différente des cartes de prix, qui mène au contact et non à `/register` ;
- **absente du tunnel de souscription** : la liste des offres proposées vient de
  `SELF_SERVE_PLANS`, qui l'exclut par construction ;
- `isSellable('expert', …)` répond `false`, et l'API refuse toute souscription
  (`PLAN_NOT_SELLABLE`) — y compris par une requête directe ;
- `computeProration` refuse de chiffrer un passage à Expert (« Aucun tarif
  publié ») plutôt que de deviner un montant.

Le pack inclut du temps d'expert humain, dont le coût dépasse un mois de Business
et dépend du dossier. **Les droits Expert s'accordent manuellement, par un rôle
plateforme.** Mettre un bouton de paiement sous une prestation humaine vendrait un
engagement qu'on ne peut pas tenir.

### Antériorité des comptes déjà inscrits — ARBITRÉ

Question remontée au décideur : les comptes souscrits sous l'ancienne grille
(« projets illimités » en Pro) passent-ils aux nouvelles limites ?

**Décision : oui. Tous les comptes passent aux nouvelles limites. Aucune
antériorité.**

Il n'existe donc **pas** de seconde grille dans le code : ni
`LEGACY_PLAN_ENTITLEMENTS`, ni champ de version tarifaire sur la collection
`subscriptions`. Une grille « héritée » conservée au cas où serait une branche que
rien n'emprunte, que personne ne teste, et qu'un lecteur croirait active.

#### Conséquence traitée : les organisations au-dessus de leur limite

État de la production au moment de la bascule : **7 organisations, 9 projets**.
Une organisation détient **5 projets**, alors que l'offre gratuite en autorise 1.
Six organisations n'ont **aucun document d'abonnement** — elles sont
implicitement gratuites, et `BillingService.getPlanEntitlements()` les sert bien
en `free` avec des limites complètes, sans écrire en base (vérifié par
`billing.service.entitlements.test.ts`).

**La limite s'applique aux gestes futurs, jamais au patrimoine déjà là.** Pour
cette organisation à 5 projets :

- ses 5 projets restent **lisibles, modifiables et exportables**. Rien n'est
  supprimé, archivé d'office ni rendu inaccessible ;
- la **création** d'un sixième est refusée en 403 `PLAN_LIMIT_PROJECTS` ;
- le refus dit ce qu'il faut savoir :

  > Votre organisation compte 5 projets, alors que l'offre Free en autorise 1.
  > Vos 5 projets restent accessibles, modifiables et exportables — rien n'a été
  > supprimé. Seule la création d'un nouveau projet est suspendue. Passez à
  > l'offre Cabinet pour en créer davantage, ou supprimez un projet existant.

- le dépassement est déjà **lisible** dans le tableau de bord de l'organisation
  (`depassements()`), pour qu'il ne surprenne pas au moment du clic.

Le message distingue deux situations que l'ancien texte (« Limite de 1 projet(s)
atteinte pour le plan free ») confondait : être **pile à la limite** (l'utilisateur
a consommé ce qu'il a acheté) et être **au-dessus** (la grille a changé sous ses
pieds — ce n'est pas sa faute, et le message ne le lui reproche pas). L'offre
suggérée est la **moins chère qui couvre le besoin**, jamais la plus riche, et
jamais Expert. La suppression manuelle est toujours proposée en alternative :
ne proposer que la montée en gamme serait une vente sous contrainte.

Cette garantie tient parce qu'**aucun chemin de lecture ne consulte
`maxProjects`**. La liste des fichiers autorisés à le faire est fixée par un test
(`billing/project-limit.surface.test.ts`) : ajouter une consultation dans
`reports/` ou `evaluate/` fait échouer la suite.

## Essai

- commence au niveau de l’organisation;
- dure 14 jours calendaires;
- une seule période d’essai par organisation économique selon règles antifraude;
- accès fonctionnel généreux mais quotas raisonnables;
- rappels avant expiration;
- aucune suppression immédiate à l’expiration;
- passage en lecture limitée pendant une période de grâce à définir;
- export des données disponible selon politique.

La carte bancaire obligatoire ou non est une décision commerciale à tester.

## États d’abonnement

`trialing`, `active`, `past_due`, `grace`, `suspended`, `canceled`.

Chaque transition est idempotente et pilotée par des événements de paiement vérifiés.

## Entitlements

`Entitlements` (`packages/shared/src/pricing/index.ts`) porte six champs, tous
obligatoires : `maxProjects`, `pdfWatermark`, `pdfExportsPerMonth`,
`aiMessagesPerMonth`, `seats`, `actualsEnabled`. Une nouvelle offre ne compile pas
tant qu'elle ne les a pas tous renseignés.

**Convention unique : `null` signifie « illimité »**, jamais « inconnu » ni
« zéro ». Un champ absent serait ambigu — et surtout, un `undefined` passerait le
test `!== null` des appelants, ce qui désactiverait silencieusement la limite.

L’interface peut expliquer une limite, mais l’API l’impose.

## Quota de messages IA

### Ce qui est compté, et ce qui ne l'est pas

**Seuls les appels réellement traités par le modèle sont décomptés.**
`ai-actions.service.ts` distingue déjà `source: 'llm'` de `source: 'fallback'` ;
le comptage filtre sur `'llm'` **dans la requête** (`countBilledForOrganizationSince`).

Un repli déterministe n'appelle aucun modèle : il survient quand aucune clé n'est
configurée, quand le réseau tombe, ou quand la réponse du modèle est refusée par
le schéma. **Le décompter ferait payer à l'utilisateur une panne de notre
configuration** — le jour où une clé expire, tous les appels basculent en repli et
un quota gratuit se viderait en vingt requêtes sans qu'aucun modèle n'ait
répondu. Un test couvre exactement ces vingt replis.

### La fenêtre

**Mois calendaire, en UTC.** Explicable en une phrase (« votre quota repart le
1er »), identique sur toutes les instances quel que soit leur fuseau, et **sans
état à stocker** : la fenêtre se déduit de l'horloge. Il n'existe aucun compteur à
remettre à zéro, donc aucune remise à zéro à rater.

Une fenêtre glissante de 30 jours a été écartée : elle est inexplicable au client
(« mon quota repart quand ? ») et ferait dépendre le reste de l'heure exacte du
premier appel du mois.

### Le refus

`403 PLAN_LIMIT_AI_MESSAGES`, jamais un 403 nu. Le corps nomme **laquelle** des
limites est atteinte et **quand** elle repart :

```json
{
  "code": "PLAN_LIMIT_AI_MESSAGES",
  "quota": "ai_messages",
  "plan": "free",
  "limit": 20,
  "used": 20,
  "resetAt": "2026-09-01T00:00:00.000Z",
  "resetInDays": 20,
  "message": "Vous avez utilisé les 20 messages IA inclus ce mois-ci dans l'offre free. Le compteur repart le 1er du mois prochain (dans 20 jours). Vos projets et vos exports restent accessibles.",
  "upgradeUrl": "/pricing"
}
```

**403 et non 429** : ce n'est pas une limitation de débit qu'une seconde d'attente
lèverait, c'est un droit que le plan n'accorde pas. Un 429 ferait réessayer en
boucle les clients qui savent réessayer, sur une limite mensuelle.

Le message rappelle que **projets et exports restent accessibles** : sans cela, un
quota IA épuisé se lit comme une suspension de compte.

### Point d'entrée pour tout nouvel usage de l'IA

**`AiQuotaService` (`apps/api/src/ai/ai-quota.service.ts`), exporté par
`AiModule`.** C'est le seul endroit qui applique et compte le quota IA. Un
assistant, un chat ou un générateur d'interprétations **n'écrit aucune limite de
son côté** — il appelle :

```ts
const reponse = await this.aiQuota.runGuarded(
  { organizationId, userId, action: 'ai.lala_chat' },
  async () => {
    const r = await this.lala.repondre(question);
    return { value: r, source: r.source }; // 'llm' | 'fallback'
  },
);
```

`runGuarded` refuse **avant** tout appel payant si le quota est épuisé, exécute,
puis compte **après** à partir de la source réelle de la réponse. Les deux moitiés
sont tenues ensemble volontairement : compter avant l'appel décompterait les
replis, garder après laisserait passer l'appel payant qu'on refuse. Deux méthodes
séparées (`assertWithinQuota` / `record`) existent pour les cas particuliers, mais
elles invitent à n'en appeler qu'une.

`action` est une étiquette libre servant au tableau de bord d'exploitation. **Le
quota est commun à tous les usages d'une organisation** : un quota par usage se
contournerait en changeant d'écran.

Si l'appelable lève, **rien n'est décompté** : une requête qui n'a produit aucune
réponse n'a rien consommé du point de vue de l'utilisateur, quoi qu'elle ait coûté
en interne. Le choix est en sa faveur, délibérément.

### Lecture du quota par l'interface

`GET /ai/quota` → `{ plan, limit, used, remaining, unlimited, resetAt, resetInDays }`.

Sans effet de bord : lire un quota n'en consomme pas. Cette route permet à
l'interface d'**expliquer** la limite avant qu'on s'y heurte — elle ne l'applique
pas, et ne serait-elle jamais appelée que rien ne changerait côté `POST`.

Une offre illimitée rend `limit: null` et `remaining: null`, **jamais un grand
nombre** : une jauge d'interface remplirait « 9 999 restants ».

## Changements de plan

- montée en gamme immédiate avec prorata selon fournisseur;
- baisse à la prochaine échéance;
- ressources au-dessus de la future limite signalées;
- aucune suppression automatique de projet;
- annulation et reprise documentées;
- factures et taxes conservées selon obligations.

## Implémenté (S16b)

Première tranche d'entitlements appliqués côté API — sans intégration paiement.

### Modèle

- Collection `subscriptions` (`apps/api/src/billing/subscription.schema.ts`) :
  `organizationId` (unique), `plan: free | pro | business`, `status: active`,
  `_schemaVersion`. Une organisation **sans** document est en plan `free`.
- Catalogue typé `PLAN_ENTITLEMENTS` (`apps/api/src/billing/entitlements.ts`) :
  - `free` : `maxProjects: 1`, `pdfWatermark: true`;
  - `pro` : projets illimités, PDF sans filigrane;
  - `business` : tout Pro + `seats: 20`.

### Limites appliquées par l'API

- `POST /projects` : limite atteinte → `403 { code: 'PLAN_LIMIT_PROJECTS', limit, plan }`.
  Le web affiche un message avec lien vers `/pricing` (pas d'UI d'upgrade).
- Export PDF : filigrane discret « Généré avec Lalanda — offre gratuite » répété
  sur chaque page si le plan est `free` (décidé côté API, jamais par l'UI).
- `GET /organizations/current/subscription` → `{ plan, entitlements, usage: { projects } }`.

### Hors périmètre S16b

- **Aucune intégration paiement** : pas d'endpoint public de changement de plan.
  `BillingService.setPlan` est interne (seed, support, tests) en attendant les
  événements de paiement vérifiés décrits plus haut.
- Essai 14 jours, états `trialing`/`past_due`/`grace`/…, quotas scénarios/membres/IA.

### Divergence page publique / ce document — RÉSOLUE

> Signalée en S16b, re-signalée en S22b : la page publiait trois offres, ce
> document en décrivait quatre autres, et le code suivait la page.
>
> **Résolue par la grille arbitrée** (voir § *La grille*). Il n'existe plus qu'une
> seule définition, dans `packages/shared/src/pricing`, importée par l'API et par
> la page. La divergence n'est plus « corrigée » : elle est devenue impossible à
> écrire.

## Implémenté (S22b)

Cycle de vie complet, essai, prorata et paiements vérifiés. Le lot rend la
plateforme **facturable** ; il ne décide d'aucun prix.

### Machine d'état

- `apps/api/src/billing/subscription-state.ts` — table de transitions explicite
  sur les six statuts de ce document. Toute écriture de `status` passe par
  `applyEvent()` : il n'existe aucun chemin qui pose un statut à la main, et une
  transition non déclarée lève `InvalidTransitionError` (409 côté HTTP).
- `apps/api/src/billing/subscription-lifecycle.ts` — transitions **temporelles**
  (essai échu, grâce échue, baisse de gamme différée), appliquées **à la
  lecture**. Il n'y a aucun ordonnanceur dans l'application (ADR-0009) : un essai
  qui n'expirerait qu'au passage d'un cron inexistant n'expirerait jamais.
  `POST /payments/maintenance/sweep` fait le même travail en lot pour les
  rapports d'exploitation — c'est une commodité, jamais la source de vérité.

### Essai

- 14 jours, **sans carte bancaire** : `POST /organizations/current/subscription/trial`
  n'appelle aucun fournisseur, c'est une écriture locale.
- Une seule période par organisation : `trialStartedAt` ne redevient jamais
  `null`, résilier ne libère donc pas un second essai.
- Plan accordé : `pro` (et non `business`) — « accès généreux, quotas
  raisonnables » ; les 20 sièges de Business feraient de l'essai une licence
  d'équipe gratuite de deux semaines.
- À l'expiration, **aucune donnée n'est supprimée** : `plan` reste inchangé en
  base et c'est `effectivePlan()` qui répond `free`. La limite s'applique aux
  créations futures. Couvert par `subscriptions.e2e.test.ts`.

### Changements de plan

- `apps/api/src/billing/proration.ts`, fonction pure : crédit du non-consommé,
  coût de la période restante, **jamais de remboursement** (un crédit excédentaire
  est reporté dans `carriedCreditCents`).
- Montée en gamme immédiate et payante ; baisse programmée à l'échéance.
  `POST .../subscription/plan` **refuse** une montée en gamme
  (`UPGRADE_REQUIRES_PAYMENT`) : l'accorder donnerait Business à qui sait envoyer
  un POST.
- `GET .../subscription/quote` chiffre sans encaisser — le client voit le montant
  avant d'être envoyé chez un fournisseur.
- Montants **hors taxes**, et la réponse le déclare (`taxIncluded: false`) : la
  fiscalité de la vente numérique n'est pas arbitrée (voir plus bas).

### Paiements

- `apps/api/src/payments/payment-provider.ts` — interface `PaymentProvider`
  commune. Trois implémentations : `stripe`, `paypal`, `manual`.
- **Signature vérifiée avant toute lecture du corps.** Un rappel non signé est un
  formulaire public qui accorde des abonnements. Comparaison en temps constant,
  tolérance d'horodatage de 5 minutes, et **aucun repli** : sans secret
  configuré, le fournisseur est indisponible (503), jamais permissif.
- **Idempotence** par index unique `{provider, eventId}` sur `payment_events`,
  inséré *avant* traitement. Un rejeu répond 200 sans rien refaire.
- Rattachement à une organisation par métadonnées, à défaut par jointure exacte
  sur `subscriptions.{provider, providerSubscriptionId}`. Aucune heuristique :
  un rappel non rattachable reste **orphelin et visible**, jamais crédité à une
  organisation approchante.
- Chaque transition est journalisée dans `audit_events` (S20a).

### Ce qui marche sans compte marchand, et ce qui attend

| Moyen | Fournisseur | État |
|---|---|---|
| Mobile money | `manual` | **Opérationnel.** Dépôt + référence, confirmation par un rôle plateforme. |
| Virement | `manual` | **Opérationnel.** Même circuit. |
| Carte bancaire | `stripe` | Code complet, **attend** `LALANDA_STRIPE_RESTRICTED_KEY` et `LALANDA_STRIPE_WEBHOOK_SECRET`. |
| PayPal | `paypal` | Code complet, **attend** identifiants OAuth, `webhookId` et des `plan_id` créés dans le catalogue marchand. |

**Aucun agrégateur mobile money n'a été intégré**, et c'est délibéré. pawaPay,
Flutterwave et MaxiCash exigent tous un compte marchand vérifié pour obtenir des
identifiants **et** pour connaître le schéma exact de signature de leurs rappels,
qui n'est pas vérifiable publiquement de bout en bout. Un fournisseur écrit sur
des suppositions passerait des tests écrits contre ces mêmes suppositions : une
intégration verte qui accepte n'importe quel rappel. Le fournisseur `manual` ne
prétend rien et fonctionne aujourd'hui.

Limite assumée du circuit manuel : **aucun renouvellement automatique**. Un dépôt
mobile money est un paiement ponctuel, il n'existe pas de mandat de prélèvement.
L'abonnement arrive à échéance et repasse par `past_due` comme les autres.
L'interface le dit explicitement au moment du choix.

### Notifications : ce que S22b n'envoie pas, et pourquoi

**S22b n'envoie aucun email.** Ce n'est pas un oubli, et surtout ce n'est pas une
seconde interface d'envoi : le module `mail/` livré par S22a (`MailService`,
repli journal sans SMTP) reste le seul chemin d'envoi du dépôt. S22b n'en a
créé aucun autre et n'en créera pas.

L'information d'abonnement circule aujourd'hui **dans l'application**, par
`statusNotice()` (`subscription-lifecycle.ts`), calculée à la lecture : fin
d'essai proche, échec de paiement, période de grâce, suspension. C'est cohérent
avec l'absence d'ordonnanceur (ADR-0009 : ni `@nestjs/schedule`, ni worker).

Deux cas restent ouverts, et ils ne se valent pas :

- **Rappel de fin d'essai — non réalisable en l'état.** Un rappel « il vous reste
  3 jours » n'a de sens qu'envoyé *sans* que l'utilisateur soit là. Or le seul
  déclencheur disponible est la lecture de l'abonnement, c'est-à-dire un
  utilisateur déjà devant l'écran — à qui la bannière a déjà tout dit. Sans
  ordonnanceur, l'email n'ajoute rien. Il demande une décision d'architecture,
  pas quelques lignes.
- **Échec de paiement — réalisable, non fait, assumé.** Le webhook est un
  déclencheur événementiel : il n'a besoin d'aucun cron. Le blocage est le
  destinataire. `BillingService` ne dépend que du modèle `Subscription` et d'un
  `AuditService` optionnel ; `subscription.schema.ts` ne stocke aucune adresse.
  Notifier suppose donc de résoudre organisation → propriétaire → email, soit une
  dépendance nouvelle vers les utilisateurs dans un service dont la surface a été
  tenue volontairement étroite. C'est un ajout défendable, mais c'en est un — pas
  un branchement. Il n'a pas été fait au moment de l'intégration pour ne pas
  glisser une fonctionnalité non testée dans une fusion.

Recommandation : traiter l'email d'échec de paiement en premier (valeur réelle,
coût maîtrisé, `MailService` déjà disponible et `@Global`), et ne rouvrir le
rappel de fin d'essai qu'avec la décision sur l'ordonnanceur.

### Valeurs posées par défaut, à arbitrer

- **Période de grâce : 7 jours.** Ce document la laisse « à définir ». Assez pour
  qu'un client en déplacement remplace une carte, assez court pour que l'impayé
  ne devienne pas un abonnement gratuit. `GRACE_DAYS` dans `pricing-catalog.ts`.
- **Business n'a pas de tarif annuel.** La page publique n'en annonce aucun ; le
  catalogue vaut donc `null` et l'API refuse ce couple (`PLAN_NOT_SELLABLE`)
  plutôt que de deviner un « 490 USD/an » plausible.

## Divergence tarifaire — signalement et avis (S22b) — ARBITRÉ

> **Ce qui suit est conservé comme trace du raisonnement, pas comme état du
> produit.** Le décideur a arbitré depuis, et la § *La grille* fait foi. Résumé de
> ce qui a été retenu de cet avis :
>
> | Proposition de S22b | Décision |
> |---|---|
> | Insérer un palier intermédiaire (§ 2) | **Retenue** — c'est `cabinet`, 39 USD, 3 sièges, 20 projets. |
> | Traiter *Enterprise* comme un devis hors grille (§ 2) | **Retenue** — c'est `expert`, `selfServe: false`, sans prix Stripe ni tunnel. |
> | Ouvrir un annuel Business (§ 4) | **Retenue** — 790 USD/an. |
> | Pousser l'annuel à deux mois offerts (§ 4) | **Retenue** — les trois offres en libre-service sont à 10 mois payés pour 12 (16 % arrondi bas). |
> | Compter les appels IA avant de vendre un quota (§ 3) | **Faite** — voir § *Quota de messages IA*. |
> | Garder Pro à 9 et Business à 49 | **Écartée** — 19 et 79. Les montants relèvent du décideur, pas de cet avis. |
> | Antériorité des comptes existants | **Écartée** — aucune antériorité (voir § *Antériorité*). |
> | Appliquer `seats` | **Non faite** — reste ouverte, voir § *Ce qui reste à faire*. |
> | Devise de règlement et fiscalité (§ 5) | **Toujours ouvertes** — inchangé, et toujours bloquantes avant le premier encaissement. |

**Le constat, d'abord.** Trois grilles coexistaient :

1. ce document, § *Packs proposés* : **quatre** packs (Starter, Pro, Business,
   Enterprise), sans montants;
2. la page `/pricing` : **trois** offres — Free 0, Pro 9 USD/mois (ou 90/an),
   Business 49 USD/mois;
3. le code (`entitlements.ts`, `pricing-catalog.ts`) : aligné sur la page, qui
   fait foi comme promesse publique.

La divergence était déjà signalée en S16b. Elle n'est **pas** résolue ici, et
elle ne peut pas l'être par un développeur : c'est une décision commerciale.

**L'avis qui suit est une proposition argumentée, pas un changement.** Aucun prix
n'a été modifié dans le code.

### 1. Le coût marginal réel n'est pas l'IA

L'appel IA (`gpt-4o-mini`, `ai-actions.service.ts`) porte un contexte de plan et
rend une explication courte. À quelques milliers de jetons d'entrée et moins d'un
millier en sortie, l'ordre de grandeur est de **l'ordre du millième de dollar par
appel** aux tarifs publics de cette classe de modèle — soit environ un millier
d'appels pour 1 USD. Même en supposant un utilisateur Pro très actif à 200 appels
par mois, la charge IA reste **sous 1 % d'un abonnement à 9 USD**.

Deux réserves, l'une méthodologique et l'autre technique :

- les tarifs exacts doivent être revérifiés au moment de l'arbitrage, ils bougent;
- **aucune borne de jetons n'est posée aujourd'hui** (`openai-client.ts` ne
  définit pas de `max_tokens`). Le coût par appel est donc théoriquement non
  borné. C'est un risque d'exploitation avant d'être un risque de marge, et il
  se corrige par une borne, pas par un prix.

Le vrai coût marginal est ailleurs : **l'export PDF passe par Puppeteer**, donc
par un Chromium par rendu. C'est de la mémoire et du CPU, et cela se dimensionne
en serveurs, pas en jetons. Un plan qui promet des exports illimités engage plus
que celui qui promet de l'IA illimitée.

### 2. Quatre packs sont un pack de trop, mais l'écart 9 → 49 est trop large

Les quatre packs du tableau ci-dessus supposent une force de vente pour porter
l'*Enterprise*. En l'absence de contrat cadre, de SSO et de multi-entités livrés,
*Enterprise* n'est pas une offre : c'est une ligne « nous contacter ».

À l'inverse, l'écart entre Pro (9) et Business (49) est un facteur **5,4** pour
un saut fonctionnel qui, aujourd'hui, se résume à *white-label + 20 sièges +
API*. Un cabinet de trois personnes n'a pas besoin de 20 sièges et ne paiera pas
49 USD ; il restera sur un Pro mono-siège, ce qui est exactement la fuite de
revenu que produit un palier manquant.

**Proposition : trois offres payantes plutôt que deux, et un « nous contacter »
qui n'est pas un pack.**

- garder Free et Pro tels quels;
- insérer un palier **Équipe** entre les deux, autour de **19–25 USD/mois**, avec
  **3 à 5 sièges** et l'export sans filigrane — c'est le besoin du cabinet et de
  l'incubateur de quartier, qui est la clientèle réelle en RDC;
- garder Business à 49 USD en le recentrant sur ce qui le justifie
  (white-label, API, 20 sièges, support prioritaire);
- traiter *Enterprise* comme un devis, hors grille.

### 3. Les quotas doivent exister avant d'être vendus

Ce document liste `ai.monthly_quota`, `scenarios.max`, `members.max`. **Aucun
n'est appliqué** : `Entitlements` ne porte que `maxProjects`, `pdfWatermark` et
`seats` (non contrôlé). Vendre un « quota IA supérieur » sans compteur, c'est
vendre une différence que rien ne matérialise — et c'est aussi ce qui empêche de
défendre un palier intermédiaire, qui a besoin d'un axe mesurable.

**Priorité recommandée avant tout changement de grille :** un compteur d'appels
IA par organisation et par mois, et l'application de `seats`. Sans eux, un
nouveau palier ne serait qu'une ligne de plus sur une page.

### 4. L'offre annuelle est sous-exploitée

L'annuel Pro à 90 USD représente **16 % d'économie** (et non 17 : la page arrondit
vers le bas, volontairement). C'est faible face au standard de 2 mois offerts
(≈ 17 %) et surtout face à ce que l'annuel apporte **en RDC** : il supprime onze
occasions d'échec de paiement là où le prélèvement récurrent est fragile et où le
mobile money ne se renouvelle pas tout seul.

**Proposition : pousser l'annuel plus franchement (2 mois offerts, soit 90 USD
maintenu mais présenté comme tel), et ouvrir un annuel Business** — son absence
oblige aujourd'hui le segment le plus solvable à repasser par un prélèvement
mensuel chaque mois.

### 5. La devise et la fiscalité restent les vrais bloquants

Facturer en USD est cohérent avec l'usage congolais, mais **un client qui paie en
mobile money paie en CDF**. La conversion aura lieu quelque part — chez
l'opérateur, ou chez nous. Tant qu'aucune politique de taux daté n'est arbitrée,
le circuit manuel expose l'écart de change à l'administrateur qui confirme le
dépôt, ce qui est un travail invisible et une source d'erreur.

De même, la fiscalité de la vente de service numérique n'est pas tranchée : tous
les montants produits par l'API sont explicitement hors taxes, et l'interface le
dit. **Ce point doit être arbitré avant le premier encaissement réel**, pas après.

### Ce qui était demandé au décideur

1. ~~Trancher entre la grille de ce document et les offres de la page publique.~~
   **Fait** — voir § *La grille*.
2. ~~Se prononcer sur le palier intermédiaire et sur l'annuel Business.~~
   **Fait** — Cabinet 39, annuel Business 790.
3. ~~Antériorité des comptes déjà inscrits.~~ **Fait** — aucune antériorité.
4. **Valider ou corriger la période de grâce de 7 jours.** Toujours ouvert.
5. **Arbitrer devise de règlement et fiscalité (§ 5).** Toujours ouvert, et
   toujours bloquant avant le premier encaissement réel.

## Ce qui reste à faire

- **`seats` n'est pas appliqué.** La grille contractualise 1, 1, 3, 20 sièges et
  « négocié », et le tableau de bord de l'organisation SIGNALE un dépassement
  (`depassements()`), mais rien ne refuse l'invitation d'un membre au-delà de la
  limite. Vendre des sièges sans les compter, c'est vendre une différence que
  rien ne matérialise — le même reproche que S22b adressait au quota IA, qui lui
  est désormais appliqué.
- **`pdfExportsPerMonth` n'est pas appliqué.** Le filigrane l'est ; le nombre
  d'exports par mois ne l'est pas. C'est le poste de coût marginal RÉEL (Puppeteer,
  donc un Chromium par rendu), et il est aujourd'hui non borné. Le compteur
  existe déjà pour l'IA (`ai_usage_events`) : le même mécanisme s'applique, avec
  la même fenêtre mensuelle et le même style de refus.
- **`scenarios.max` et `api.enabled` / `sso.enabled`** ne sont ni dans
  `Entitlements` ni appliqués. Le comparatif public les décrit comme éditoriaux et
  ne promet aucun nombre là où rien n'est compté.
- **Période de grâce (7 jours)** : valeur par défaut posée, non arbitrée.
- **Devise de règlement et fiscalité** : voir § 5 ci-dessus.

## Validation commerciale requise

Reste à étudier : coûts d’exports (Puppeteer), moyens de paiement locaux, devises
de facturation, fiscalité de vente numérique, politique de remboursement.

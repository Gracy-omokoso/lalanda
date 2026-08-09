# 28 — Conformité légale

**Statut : Draft.**
**Version du corpus contractuel : `2026-08-09`.**

> **AVERTISSEMENT — LES TEXTES LÉGAUX PUBLIÉS PAR LALANDA SONT DES PROJETS.**
>
> Les cinq documents (CGU, CGV, politique de confidentialité, politique de
> cookies, mentions légales) ont été rédigés par l’équipe produit. Ils **n’ont
> pas été relus par un juriste** et ne doivent pas être présentés comme
> conformes à un droit applicable. **Une relecture juridique est un préalable à
> la mise en production.** Tant qu’elle n’a pas eu lieu, chaque page affiche un
> bandeau qui le dit au lecteur, piloté par `LEGAL_REVIEWED_BY_COUNSEL` dans
> `apps/web/src/lib/legal.ts`.

Ce document ne cherche pas à trancher les questions juridiques ouvertes. Il
recense ce qui a été **construit**, ce qui reste **inconnu**, et ce qui doit être
**arbitré par un conseil** avant toute mise en service commerciale.

---

## 1. Éditeur du service

Lalanda est un produit de **Televerx LLC**.

C’est la **seule information d’identification de l’éditeur qui soit établie à ce
jour**. Elle est déclarée une fois, dans `packages/shared/src/legal/index.ts`
(`PUBLISHER_NAME`), et importée partout ailleurs.

### 1.1 Ce qui reste inconnu

Aucune des informations ci-dessous n’a été communiquée. Elles sont rendues dans
les pages sous forme de marqueurs `[À COMPLÉTER : …]` **visibles par le lecteur**,
et récapitulées dans `PUBLISHER_UNKNOWNS` (`apps/web/src/lib/legal.ts`) :

- forme juridique complète, État ou pays d’immatriculation ;
- numéro d’enregistrement de la société ;
- adresse du siège social ;
- capital social, si la forme juridique en fait état ;
- nom du représentant légal et du directeur de la publication ;
- adresse email de contact ;
- numéro de téléphone, si l’éditeur souhaite en publier un ;
- identité et adresse de l’hébergeur (cible ADR-0009 : DigitalOcean, non
  provisionné à ce jour).

**Règle appliquée : rien n’a été déduit.** Inventer l’adresse ou le numéro
d’immatriculation d’une société réelle ne produit pas un document incomplet mais
un document **faux**, publié sous la signature d’une personne morale existante.
Un marqueur visible est un défaut qu’on corrige ; une mention inventée est une
affirmation que personne ne pense à vérifier.

### 1.2 Question ouverte structurante — à poser au juriste

**La dénomination « LLC » suggère une immatriculation aux États-Unis. C’est une
indication, pas une conclusion.** L’État d’immatriculation n’est pas établi. Si
cette indication se confirme, elle emporte des conséquences sur au moins trois
points, qui sont **liés entre eux et ne peuvent pas être arbitrés séparément** :

1. **Droit applicable au contrat.** Lalanda cible l’Afrique francophone (zone
   OHADA) et, par la diaspora, des utilisateurs susceptibles d’être établis dans
   l’Union européenne. Un éditeur américain contractant avec des consommateurs de
   ces zones ne peut pas librement écarter les règles impératives de leur droit
   de résidence.
2. **Juridiction compétente.** Une clause attributive de juridiction au profit
   d’un tribunal américain est, dans plusieurs droits, **inopposable à un
   utilisateur consommateur**, qui conserve le bénéfice des tribunaux de son lieu
   de résidence. La clause peut par ailleurs devoir être accompagnée d’un
   dispositif de médiation préalable.
3. **Transferts de données hors de l’Union européenne.** Si des utilisateurs sont
   établis dans l’UE, l’hébergement et les traitements réalisés depuis les
   États-Unis relèvent d’un régime de transfert qui exige un instrument juridique
   (clauses contractuelles types ou équivalent), et probablement la désignation
   d’un représentant dans l’Union.

**Ces trois points sont des questions à poser, pas des positions à retenir.** Ils
sont marqués comme tels dans les pages concernées (CGU § droit applicable et
juridiction, politique de confidentialité § transferts).

---

## 2. Ce qui a été construit

### 2.1 Les cinq documents

| Document | Route | Fichier |
|---|---|---|
| Conditions générales d’utilisation | `/cgu` | `apps/web/src/app/(marketing)/cgu/page.tsx` |
| Conditions générales de vente | `/cgv` | `apps/web/src/app/(marketing)/cgv/page.tsx` |
| Politique de confidentialité | `/confidentialite` | `apps/web/src/app/(marketing)/confidentialite/page.tsx` |
| Politique de cookies | `/cookies` | `apps/web/src/app/(marketing)/cookies/page.tsx` |
| Mentions légales | `/mentions-legales` | `apps/web/src/app/(marketing)/mentions-legales/page.tsx` |

Le registre `LEGAL_DOCUMENTS` (`apps/web/src/lib/legal.ts`) est la **source
unique** : titres, chemins, résumés et dates de mise à jour en sont dérivés, de
même que les liens des deux pieds de page. Une page ajoutée sans être inscrite au
registre n’apparaît nulle part — et une page publiée mais introuvable est
difficilement opposable.

**Les pages légales ne sont ni « marketing » ni « protégées »** au sens de
`apps/web/src/lib/routes.ts`. C’est délibéré : un membre connecté qui clique sur
« CGU » depuis le pied de page applicatif doit **lire les CGU**, pas être redirigé
vers `/projects`. Un test (`apps/web/src/lib/legal.test.ts`) vérifie qu’aucun
chemin légal n’a glissé dans les tableaux de `routes.ts`.

### 2.2 Version du corpus et preuve d’acceptation

`LEGAL_VERSION` (`packages/shared/src/legal/index.ts`) couvre **l’ensemble** des
documents opposables plutôt qu’un document isolé : un utilisateur accepte un état
du corpus à une date, pas cinq numéros de version indépendants.

Elle est déclarée dans `packages/shared` et importée par le web **et** par l’API.
Deux déclarations parallèles produiraient la panne la plus discrète possible :
une acceptation enregistrée comme « à jour » pour un utilisateur qui a lu
l’ancienne version.

**Règle d’évolution.** Toute modification **substantielle** — nouvelle finalité de
traitement, nouveau sous-traitant, changement de prix ou de durée d’engagement,
extension des usages interdits — impose de faire avancer `LEGAL_VERSION` **et**
d’ajouter l’ancienne valeur à `KNOWN_LEGAL_VERSIONS`. Les acceptations
antérieures deviennent périmées et l’accord est redemandé. Une correction de
typographie ne fait pas avancer la version.

`KNOWN_LEGAL_VERSIONS` sert à **refuser une valeur inventée** : sans cette liste,
un client pourrait enregistrer `termsVersion: '2099-01-01'` et ne plus jamais se
voir redemander son accord. Aucune entrée ne doit en être retirée — les
acceptations passées y font référence.

### 2.3 Acceptation à l’inscription

Écran : `apps/web/src/app/(auth)/register/page.tsx`.

- **La case n’est pas pré-cochée** (`useState(false)`) et ne doit jamais l’être.
  Une case pré-cochée transforme l’acceptation en défaut qu’on subit :
  l’utilisateur n’a alors rien accepté, il a omis de refuser.
- Elle porte des **liens vers les CGU, les CGV et la politique de
  confidentialité**, ouverts dans un nouvel onglet pour ne pas perdre la saisie.
- Le refus est bloqué **deux fois** : par l’attribut `required` et par une
  vérification dans le gestionnaire de soumission. Un `required` retiré par
  l’inspecteur ne suffit pas à créer un compte sans accord.
- L’accord est **enregistré**, pas seulement vérifié : `POST
  /legal/terms/acceptance` avec la version **affichée à cet écran**. Si
  l’enregistrement échoue, on ne navigue pas en silence — le compte existe mais
  l’accord n’est pas prouvé, et l’utilisateur se voit proposer de réessayer.

Côté API (`apps/api/src/legal/`), la collection `terms_acceptances` conserve
`userId`, `termsVersion` et `acceptedAt`. L’enregistrement est **idempotent par
construction** (`$setOnInsert` sur un upsert indexé unique) : un double clic, un
rejeu réseau ou un retour arrière du navigateur ne réécrivent pas la date qui
fait la preuve. La date conservée est celle du **premier** accord.

L’identité vient de la **session**, jamais du corps de la requête ; un `userId`
glissé dans le corps est refusé en 400. Les deux routes sont dispensées de
permission d’organisation, ce qui est documenté dans
`apps/api/src/authz/routes-coverage.test.ts` : l’acceptation est demandée à
l’inscription, à l’instant où l’organisation personnelle vient d’être créée, et
c’est en outre un fait **personnel** — un utilisateur accepte des conditions, pas
une organisation.

### 2.4 Consentement aux cookies

Logique pure : `apps/web/src/lib/cookie-consent.ts`. Interface :
`apps/web/src/components/cookie-consent.tsx`, montée à la racine
(`apps/web/src/app/layout.tsx`) pour couvrir les pages publiques **et**
l’application — un visiteur peut arriver directement sur `/login`.

Deux règles sont **appliquées**, pas seulement affichées :

1. **Refus par défaut.** Tant qu’aucun choix n’est enregistré, `isAllowed`
   renvoie `false` pour toute catégorie non essentielle. L’état « pas encore
   répondu » n’est jamais interprété comme une acceptation. Un cookie corrompu,
   illisible ou de version antérieure retombe également sur le refus.
2. **« Refuser » est aussi visible qu’« Accepter »**, et écrit un choix au même
   titre. Sans cela, un refus ferait réapparaître la bannière à chaque page —
   la version passive du dark pattern : fatiguer jusqu’à l’acceptation.

Les cookies **essentiels** (session de connexion, cookie de consentement
lui-même) ne figurent pas parmi les choix : les présenter comme optionnels serait
mensonger, puisque les refuser rendrait le service inopérant.

**État réel : Lalanda ne pose aucun cookie non essentiel à ce jour** — pas de
mesure d’audience, pas de régie publicitaire, pas de widget tiers. Le dispositif
existe pour que le choix soit connu **avant** qu’un tel outil soit introduit, et
pour qu’il n’existe qu’un seul endroit où le vérifier (`isAllowed`). Toute
introduction d’un traceur doit passer par cette fonction.

`CONSENT_VERSION` doit être incrémentée dès qu’une catégorie est ajoutée ou
qu’une finalité change : un choix exprimé sur l’ancien formulaire ne dit rien du
nouveau. Le choix est conservé environ six mois, après quoi la question est
reposée.

### 2.5 Transmission de données à OpenAI

C’est le point le plus sensible de la politique de confidentialité, et il y est
traité en section dédiée (« Assistance IA : ce qui est transmis à OpenAI »).

**Ce qui est dit à l’utilisateur :**

- La fonction d’**actions correctives** (module `ai/`) transmet des données de
  projet à **OpenAI**, prestataire tiers.
- Cette transmission n’a lieu **que** lorsque l’utilisateur déclenche la
  fonction, et seulement si une clé d’accès OpenAI est configurée.
- **Comment s’y opposer**, explicitement : ne pas utiliser la fonction d’actions
  correctives, ou nous demander de la désactiver. Un réglage en libre-service
  dans les paramètres de l’organisation est identifié comme **non implémenté à ce
  jour** et marqué comme tel.
- Les données ne sont pas utilisées pour entraîner un modèle.

**Ce qui reste ouvert et est marqué comme tel :** l’entité juridique contractante
d’OpenAI et l’adresse de son établissement, l’accord de traitement (DPA) à
conclure, la durée de conservation appliquée de leur côté, et l’instrument
encadrant le transfert hors du pays de l’utilisateur. Ces points sont à
**formaliser avant mise en service commerciale**.

### 2.6 Pieds de page

Les cinq documents sont liés depuis :

- le pied de page **marketing** (`apps/web/src/app/(marketing)/layout.tsx`), avec
  la mention « Édité par Televerx LLC » ;
- le pied de page **applicatif** (`apps/web/src/app/(app)/layout.tsx`).

Les deux utilisent le même composant `apps/web/src/components/legal-links.tsx`,
dérivé du registre.

---

## 3. Décisions à faire trancher avant mise en production

Les points ci-dessous sont, dans les pages, des marqueurs `[À COMPLÉTER : …]`
**visibles par le lecteur**. Un marqueur invisible dans une page publiée est
exactement la façon dont une mention légale part en production incomplète sans
que personne ne s’en aperçoive.

### 3.1 Questions juridiques (conseil requis)

| Question | Où |
|---|---|
| Droit applicable au contrat (§ 1.2) | CGU |
| Juridiction compétente, médiation préalable, médiation de la consommation | CGU |
| Plafond de responsabilité retenu | CGU |
| Bases légales des traitements (contrat, intérêt légitime, obligation légale, consentement) | Confidentialité |
| Désignation d’un DPO et d’un représentant dans l’UE | Confidentialité |
| Pays d’hébergement, localisation des traitements, instrument de transfert | Confidentialité |
| Procédure de notification d’incident (délai, canal, autorité) | Confidentialité |
| Droit de rétractation : existence, durée, modalités, exécution immédiate | CGV |
| Mentions obligatoires du parcours d’achat (droit de la consommation) | CGV |
| Traitement des taxes (TVA ou équivalent) selon le pays de l’acheteur | CGV |
| Frais de recouvrement selon le droit applicable | CGV |

### 3.2 Décisions commerciales (non arbitrées — rien n’a été inventé)

| Décision | Où |
|---|---|
| Devise(s) de facturation et règle de conversion | CGV |
| Prix affichés HT ou TTC | CGV |
| Carte bancaire exigée ou non à l’entrée en essai (`docs/13-PRICING.md` la laisse ouverte) | CGV |
| Bascule en fin d’essai : reconduction automatique ou arrêt sans prélèvement | CGV |
| Durée de la période de grâce après l’essai | CGV |
| Moyens de paiement acceptés (dont mobile money) et prestataire retenu | CGV |
| Information préalable à la reconduction (délai, canal) | CGV |
| Politique de remboursement : cas ouverts, délai, modalités | CGV |
| Délais de relance, de suspension et de conservation après suspension | CGV |
| Préavis avant hausse de prix | CGV |

### 3.3 Faits à relever (pas à déduire)

| Fait | Où |
|---|---|
| Identification complète de Televerx LLC (§ 1.1) | Mentions légales |
| Adresse email de contact | Les cinq pages |
| Directeur de la publication | Mentions légales |
| Hébergeur — cible ADR-0009 (DigitalOcean), infrastructure non provisionnée | Mentions légales |
| Entité contractante d’OpenAI et adresse de son établissement | Confidentialité |
| DPA OpenAI, conservation, instrument de transfert | Confidentialité |

---

## 4. Avant de basculer `LEGAL_REVIEWED_BY_COUNSEL` à `true`

Cette constante pilote le bandeau « projet non validé » affiché en tête de chaque
page. **Ne la basculer qu’après une relecture juridique effective**, dans le même
lot que les corrections qu’elle aura demandées. Liste de contrôle :

1. Tous les marqueurs `[À COMPLÉTER : …]` sont levés — aucun ne subsiste dans les
   cinq pages.
2. Les questions du § 1.2 (droit applicable, juridiction, transferts) sont
   tranchées par un conseil, et les clauses correspondantes réécrites.
3. Le DPA OpenAI est conclu, et la section « Assistance IA » de la politique de
   confidentialité reflète son contenu réel.
4. L’hébergeur est provisionné et nommé.
5. Les décisions commerciales du § 3.2 sont arbitrées et les CGV réécrites en
   conséquence.
6. `LEGAL_VERSION` est avancée et l’ancienne valeur ajoutée à
   `KNOWN_LEGAL_VERSIONS` — la réécriture est substantielle, les acceptations
   antérieures portent sur un autre texte et l’accord doit être redemandé.
7. Les dates `updatedAt` du registre sont mises à jour.

---

## 5. Fichiers de référence

| Rôle | Fichier |
|---|---|
| Version du corpus, nom de l’éditeur, marqueur | `packages/shared/src/legal/index.ts` |
| Registre des documents, état de relecture, inconnues éditeur | `apps/web/src/lib/legal.ts` |
| Consentement cookies (logique) | `apps/web/src/lib/cookie-consent.ts` |
| Bannière de consentement | `apps/web/src/components/cookie-consent.tsx` |
| Liens légaux des deux pieds de page | `apps/web/src/components/legal-links.tsx` |
| Gabarit et fragments des pages légales | `apps/web/src/app/(marketing)/_components/legal-page.tsx` |
| Acceptation à l’inscription | `apps/web/src/app/(auth)/register/page.tsx` |
| Preuve d’acceptation (API) | `apps/api/src/legal/` |

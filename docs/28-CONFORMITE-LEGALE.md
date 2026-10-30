# 28 — Conformité légale

**Statut : Draft.**
**Version du corpus contractuel : `2026-10-30`** (précédente : `2026-08-09`).

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

**Décision de la dirigeante, 30 oct. 2026 ([ADR-0043](adr/ADR-0043-editeur-go-freelance-sarlu.md)).**
Lalanda est porté par **Go freelance SARLU**, société à responsabilité limitée
unipersonnelle de **droit congolais (République démocratique du Congo)**.
**Televerx LLC** est son **partenaire de développement et d’intégration** ; il
n’est pas l’éditeur et ne contracte pas avec l’utilisateur.

Jusqu’au corpus `2026-08-09`, l’éditeur affiché était Televerx LLC.

L’identité est déclarée une seule fois, dans `packages/shared/src/legal/index.ts`,
et importée partout ailleurs :

| Constante | Valeur |
|---|---|
| `PUBLISHER_NAME` | Go freelance SARLU |
| `PUBLISHER_LEGAL_FORM` | société à responsabilité limitée unipersonnelle (SARLU) |
| `PUBLISHER_GOVERNING_LAW` | droit congolais (République démocratique du Congo) |
| `DEVELOPMENT_PARTNER_NAME` | Televerx LLC |
| `DEVELOPMENT_PARTNER_ROLE` | partenaire de développement et d’intégration de Go freelance SARLU |

**Où chacun apparaît.** L’éditeur : les cinq pages, le pied de page marketing
(« Édité par Go freelance SARLU »). Televerx LLC : **uniquement** les mentions
légales (§ « Développement et intégration »), ni dans les pieds de page, ni dans
la politique de confidentialité, ni dans les CGU et CGV. Les e-mails et les PDF
du dépôt ne nomment pas l’éditeur ; rien n’y a changé.

### 1.1 Mentions volontairement non publiées

**Choix de la dirigeante, 30 oct. 2026 : « pas besoin de toutes ces infos ».**
Les informations suivantes ne sont pas fournies et **ne sont pas publiées** —
ni en clair, ni sous forme de marqueur « à compléter » :

- numéro RCCM ;
- identification nationale (Id. Nat.) ;
- numéro d’impôt (NIF) ;
- adresse du siège social ;
- capital social ;
- nom du gérant / représentant légal ;
- nom du directeur de la publication ;
- numéro de téléphone.

La liste est tenue dans `PUBLISHER_UNPUBLISHED_MENTIONS`
(`packages/shared/src/legal/index.ts`), **rendue sur aucune page**. Les pages
publiques n’affichent que ce qui est connu : dénomination, forme juridique et
droit dont relève la société, les trois adresses e-mail de contact, l’hébergeur,
et le partenaire. Le directeur de la publication est désigné comme « le
représentant légal de Go freelance SARLU », sans nom.

**Point à faire valider par un juriste.** Plusieurs de ces mentions (RCCM,
Id. Nat., NIF, siège) sont **habituellement attendues** dans des mentions
légales et sur les documents commerciaux d’une société. Leur absence est un
choix assumé, pas une conformité établie. Si une mention est fournie, elle
devient une constante de `packages/shared/src/legal/index.ts` (un seul endroit),
sort de `PUBLISHER_UNPUBLISHED_MENTIONS`, et est affichée par
`apps/web/src/app/(marketing)/mentions-legales/page.tsx`.

**Règle maintenue : rien n’a été déduit.** Aucune de ces valeurs n’a été
inventée ou cherchée ailleurs.

### 1.2 Hébergeur

L’hébergeur nommé est **DigitalOcean** (serveurs virtuels « Droplets ») : c’est
la décision acceptée d’[ADR-0009](adr/ADR-0009-infrastructure-digitalocean.md),
et le dépôt atteste son exploitation (`scripts/deploy-vps.sh`, déploiement sur
le Droplet ; `docs/24-INFRASTRUCTURE.md`, variables « déjà posées en
production », MinIO « en service » sur le Droplet).

**Ce que le dépôt n’établit pas** et qui n’est donc pas publié : la dénomination
sociale exacte de l’entité contractante DigitalOcean, son adresse, et la région
réelle du Droplet de production (ADR-0009 dit `ams3` « par défaut », sans
constat). La section « Transferts » de la politique de confidentialité garde
donc son marqueur sur le pays d’hébergement. `docs/24` consigne depuis le
30 oct. 2026 que le Droplet de production est provisionné et en service.

### 1.3 Questions ouvertes à poser au juriste (remplace l’analyse « LLC »)

L’ancienne analyse partait d’une indication — « LLC » suggérait une
immatriculation aux États-Unis — et en tirait trois questions (droit applicable,
juridiction, transferts). **Elle est caduque** : l’éditeur est une société de
droit congolais. Aucune règle de droit congolais n’est pour autant posée ici.
**Ce qui doit être tranché par un juriste :**

1. **Droit applicable au contrat.** La nationalité de l’éditeur ne fixe pas, à
   elle seule, le droit du contrat. Faut-il choisir le droit congolais ? Comment
   s’articule-t-il avec les règles impératives protégeant les consommateurs
   d’autres pays de la zone OHADA et de l’Union européenne (diaspora) ?
2. **Juridiction compétente** et, le cas échéant, médiation préalable ou
   médiation de la consommation ; opposabilité d’une clause attributive à un
   utilisateur consommateur établi hors de RDC.
3. **Protection des données.** Régime congolais applicable au traitement par
   un responsable établi en RDC ; formalités éventuelles auprès d’une autorité ;
   pour les utilisateurs établis dans l’UE, applicabilité du RGPD à un
   responsable hors UE, désignation d’un représentant dans l’Union.
4. **Transferts.** Encadrement des transferts vers DigitalOcean (région à
   constater) et OpenAI, au regard du droit congolais et, le cas échéant, du
   RGPD.
5. **Mentions obligatoires** de l’éditeur et des documents commerciaux (§ 1.1) :
   lesquelles sont exigées, et où.
6. **Conservation des factures et pièces comptables** : durée applicable à une
   SARLU congolaise (politique de confidentialité, marqueur conservé).
7. **Fiscalité des abonnements** et facture normalisée (§ 6).
8. **Rôle de Televerx LLC** : nature du partenariat (sous-traitant au sens de la
   protection des données ou non, accès aux données de production), qui
   conditionne sa mention éventuelle dans la politique de confidentialité —
   aujourd’hui exclue par décision.

9. **Gestion du personnel des clients (ADR-0045, R4).** Lalanda tient, pour le
   compte de l’organisation cliente, des dossiers de salariés (registre non
   sensible ; salaire de base déclaré, coordonnées bancaires, pièces d’identité,
   coordonnées personnelles chiffrés). À qualifier : rôle de Go freelance SARLU
   (sous-traitant présumé, l’organisation cliente restant responsable de son
   traitement), information des salariés, base légale, durée de conservation des
   dossiers et des pièces après la sortie (réglage `retention` vide par défaut :
   aucune purge automatique, anonymisation manuelle seulement).

**Registre de traitement — « gestion du personnel » (ADR-0045, lot H2).**
Finalité : tenue du registre du personnel de l’organisation cliente, organigramme,
absences, échéances (paie exclue). Catégories : identité et poste ; salaire de
base déclaré, coordonnées bancaires, pièces d’identité, coordonnées personnelles
(chiffrés, `hr_employee_private`). Destinataires : détenteurs de `hr.read` pour le
registre ; de `hr.sensitive.read` (Propriétaire, Directeur financier, Responsable
RH) pour les données sensibles ; le salarié pour les siennes ; jamais l’IA, les
exports, les notifications ni la plateforme. Durée : **à fixer avec le juriste**.

Ces points restent marqués comme questions ouvertes dans les pages concernées
(CGU § droit applicable, politique de confidentialité § transferts et
conservation).

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
- L’accord est **enregistré**, pas seulement vérifié, et **au moment même où le
  compte naît** (v0.4.3) : la version **affichée à cet écran** part dans la
  requête d’inscription (`termsVersion`), et les `databaseHooks` de better-auth
  (`apps/api/src/auth/auth.ts`) la **refusent** si elle n’a jamais été publiée
  (400 `TERMS_NOT_ACCEPTED`, aucun compte créé) puis l’**enregistrent** une fois
  le compte écrit. Cela vaut pour tout appel à `/auth/sign-up/email`, pas
  seulement pour le formulaire.

  *Pourquoi ce changement.* Jusqu’à la v0.4.2, l’accord partait **après**
  l’inscription par `POST /legal/terms/acceptance`, qui exige une session. Le
  18 oct. 2026, l’activation de `AUTH_REQUIRE_EMAIL_VERIFICATION=true` a supprimé
  cette session (on ne se connecte qu’une fois l’adresse confirmée) : l’appel
  tombait en 401, le compte existait **sans preuve d’accord**, et rien ne la
  redemandait ensuite. La route `POST /legal/terms/acceptance` subsiste pour une
  future ré-acceptation (nouvelle version des textes).

  *Limite connue.* Un compte créé par **Google** ne passe pas par ce formulaire
  et n’enregistre pas d’accord. Au 18 oct. 2026, 3 comptes sur 12 n’ont aucun
  accord enregistré (comptes antérieurs à S22c ou créés par Google). Un écran de
  ré-acceptation à la connexion fermerait les deux cas — non tranché.

### 2.3 bis Nouvelle acceptation : version `2026-10-30` (30 oct. 2026)

La dirigeante a décidé que les utilisateurs existants acceptent à nouveau les
CGU et les CGV **à leur prochaine connexion**. `LEGAL_VERSION` passe de
`2026-08-09` à `2026-10-30`, l’ancienne valeur reste dans
`KNOWN_LEGAL_VERSIONS`. Dates `updatedAt` mises à jour : CGU, CGV, politique de
confidentialité, mentions légales (la politique de cookies ne change pas).

**Ce qui marche dès cette version :**

- toute acceptation antérieure (`2026-08-09`) est désormais **périmée** :
  `GET /legal/terms/acceptance` rend `isCurrent: false` pour ces comptes ;
- une inscription par e-mail enregistre `2026-10-30` ;
- `POST /legal/terms/acceptance` accepte `2026-10-30` (et, comme avant, refuse
  une version jamais publiée).

**Écran de nouvelle acceptation — livré le 30 oct. 2026.** Constat initial :
aucun écran ni garde ne redemandait l’accord. Il est construit :

- `apps/web/src/app/(app)/_components/terms-gate.tsx`, monté dans la coquille
  applicative : après connexion, `GET /legal/terms/acceptance` ; si
  `isCurrent` est faux, fenêtre **bloquante** (`Modal` de `@lalanda/ui` avec
  `dismissible={false}` : ni bouton Fermer, ni `Échap`, ni clic sur le fond),
  liens vers CGU, CGV et confidentialité (nouvel onglet), case « J’ai lu et
  j’accepte » non pré-cochée, puis `POST /legal/terms/acceptance` avec la
  version **affichée**. Seule autre sortie : « Se déconnecter ».
- Décisions dans le modèle pur `terms-gate-model.ts` (testé) : rien n’est
  affiché tant que la réponse n’est pas arrivée (pas de clignotement) ; un
  échec de la vérification n’est **pas** bloquant (bandeau « Réessayer ») ;
  un échec de l’enregistrement affiche un message et laisse réessayer ; si le
  serveur exige une version plus récente que celle de la page, on demande de
  recharger au lieu d’enregistrer un accord sur un texte non lu.
- Couvre aussi les comptes Google et les comptes antérieurs à S22c.
- e2e `legal.e2e.test.ts` : un accord `2026-08-09` est `isCurrent: false`, puis
  redevient à jour après acceptation, l’historique gardant les deux.

Limite : la garde est côté interface. L’API ne refuse aucune route à un
utilisateur dont l’accord est périmé — un appel direct à l’API reste possible.

*Constat initial (avant l’écran), pour mémoire :*

- Côté web, `api.getTermsAcceptance()` et `api.acceptTerms()`
  (`apps/web/src/lib/api.ts`) ne sont **appelés nulle part** ; ni la connexion,
  ni le layout `(app)`, ni le middleware ne lisent `isCurrent`.
- Côté API, aucune route n’est refusée à un utilisateur dont l’accord est
  périmé ; la session s’ouvre normalement.

Retenu : l’application est bloquée jusqu’à l’accord (pas de report).

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

### 2.5 bis Envoi d’e-mails : Zoho ZeptoMail (30 oct. 2026)

La politique de confidentialité affirmait qu’aucun e-mail n’était envoyé. C’est
faux depuis ADR-0014 (amendement S22m) : Lalanda envoie ses e-mails par **Zoho
ZeptoMail** — vérification d’adresse, réinitialisation du mot de passe,
invitations, brief du matin et alertes, et documents de vente envoyés aux
clients des organisations (ADR-0042). ZeptoMail figure désormais dans le tableau
des prestataires (« En service ») et la limite fausse est retirée. Rien n’est
affirmé sur ses garanties contractuelles, sa localisation ou ses durées de
conservation : ces points relèvent du marqueur « Transferts » et des questions
du § 1.3.

### 2.6 Pieds de page

Les cinq documents sont liés depuis :

- le pied de page **marketing** (`apps/web/src/app/(marketing)/layout.tsx`), avec
  la mention « Édité par Go freelance SARLU » (Televerx LLC n’y figure pas) ;
- le pied de page **applicatif** (`apps/web/src/app/(app)/layout.tsx`).

Les deux utilisent le même composant `apps/web/src/components/legal-links.tsx`,
dérivé du registre.

---

## 3. Décisions à faire trancher avant mise en production

Les points ci-dessous sont, dans les pages, des marqueurs `[À COMPLÉTER : …]`
**visibles par le lecteur** — à l’exception des mentions d’identification de
l’éditeur, non publiées par décision (§ 1.1) et qui ne font plus l’objet d’aucun
marqueur. Un marqueur invisible dans une page publiée est
exactement la façon dont une mention légale part en production incomplète sans
que personne ne s’en aperçoive.

### 3.1 Questions juridiques (conseil requis)

| Question | Où |
|---|---|
| Droit applicable au contrat (§ 1.3) | CGU |
| Juridiction compétente, médiation préalable, médiation de la consommation | CGU |
| Plafond de responsabilité retenu | CGU |
| Bases légales des traitements (contrat, intérêt légitime, obligation légale, consentement) | Confidentialité |
| Désignation d’un DPO et d’un représentant dans l’UE | Confidentialité |
| Mentions d’identification non publiées (RCCM, Id. Nat., NIF, siège…) — § 1.1 | Mentions légales (non affichées) |
| Région du Droplet, localisation des traitements, instrument de transfert | Confidentialité |
| Procédure de notification d’incident (délai, canal, autorité) | Confidentialité |
| Droit de rétractation : existence, durée, modalités, exécution immédiate | CGV |
| Mentions obligatoires du parcours d’achat (droit de la consommation) | CGV |
| Traitement des taxes (TVA ou équivalent) selon le pays de l’acheteur | CGV |
| Frais de recouvrement selon le droit applicable | CGV |
| Gestion du personnel des clients : qualification, information des salariés, conservation (§ 1.3, point 9) | Confidentialité, ADR-0045 |

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
| Dénomination exacte et adresse de l’entité DigitalOcean contractante (§ 1.2) | non publiées |
| Région réelle du Droplet de production (§ 1.2) | Confidentialité |
| Entité contractante d’OpenAI et adresse de son établissement | Confidentialité |
| DPA OpenAI, conservation, instrument de transfert | Confidentialité |

---

## 4. Avant de basculer `LEGAL_REVIEWED_BY_COUNSEL` à `true`

Cette constante pilote le bandeau « projet non validé » affiché en tête de chaque
page. **Ne la basculer qu’après une relecture juridique effective**, dans le même
lot que les corrections qu’elle aura demandées. Liste de contrôle :

1. Tous les marqueurs `[À COMPLÉTER : …]` sont levés — aucun ne subsiste dans les
   cinq pages — et le choix de ne pas publier les mentions du § 1.1 est validé.
2. Les questions du § 1.3 (droit applicable, juridiction, transferts) sont
   tranchées par un conseil, et les clauses correspondantes réécrites.
3. Le DPA OpenAI est conclu, et la section « Assistance IA » de la politique de
   confidentialité reflète son contenu réel.
4. L’hébergeur est nommé (fait : DigitalOcean) et la région du Droplet constatée.
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
| Version du corpus, identité de l’éditeur et du partenaire, mentions non publiées, marqueur | `packages/shared/src/legal/index.ts` |
| Registre des documents, état de relecture, contacts | `apps/web/src/lib/legal.ts` |
| Consentement cookies (logique) | `apps/web/src/lib/cookie-consent.ts` |
| Bannière de consentement | `apps/web/src/components/cookie-consent.tsx` |
| Liens légaux des deux pieds de page | `apps/web/src/components/legal-links.tsx` |
| Gabarit et fragments des pages légales | `apps/web/src/app/(marketing)/_components/legal-page.tsx` |
| Acceptation à l’inscription | `apps/web/src/app/(auth)/register/page.tsx` |
| Preuve d’acceptation (API) | `apps/api/src/legal/` |

---

## 6. Point signalé, non résolu — facture normalisée des abonnements

Si **Go freelance SARLU vend les abonnements Lalanda**, c’est une société
congolaise assujettie, et ses propres factures d’abonnement relèvent a priori de
la **facture normalisée DGI** (ADR-0019, ADR-0024). Aucune règle n’est tranchée
ici ; l’écart constaté le 30 oct. 2026 est le suivant :

- **Encaissement** (`apps/api/src/payments/`, docs/13-PRICING § Paiements) :
  `manual` (mobile money, virement), seul circuit opérationnel, confirmé par un
  administrateur plateforme ; `stripe` et `paypal` codés mais en attente
  d’identifiants marchands.
- **Émetteur** : aucun document de facture n’est produit par Lalanda pour un
  abonnement. Le circuit manuel ne produit aucune pièce ; Stripe émettrait ses
  propres factures, au nom du titulaire du compte marchand, qui n’est pas
  documenté. Les montants sont **hors taxes** (`taxIncluded: false`), la
  fiscalité de la vente numérique n’est pas arbitrée.
- **Normalisation** : le module ventes sait émettre et normaliser des factures
  DGI **pour les organisations clientes** (leurs propres ventes), pas pour la
  plateforme. `billing/` et `payments/` n’ont aucun lien avec `sales/` ni avec
  e-DEF.

Questions ouvertes : quelle entité tient les comptes marchands ; TVA applicable
aux abonnements ; une facture normalisée par encaissement (y compris
mobile money manuel) ; utilisation du module ventes de Lalanda par
Go freelance SARLU elle-même (organisation plateforme dotée de ses identifiants
DGI) ou circuit distinct ; traitement des clients hors RDC. Les CGV promettent
déjà « une facture est émise à chaque échéance » : la promesse n’est pas tenue
aujourd’hui.

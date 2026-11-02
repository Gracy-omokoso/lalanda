# ADR-0053 — Administration de la plateforme : une console Lalanda séparée de l'espace des organisations, rôles et actions plateforme, blocages motivés et effectifs, abonnements et paiements manuels, fonctionnalités par offre, journaux, annonces par catégorie, statistiques et finances du site

Statut : Proposed
Date : 2026-11-02
Décideurs : Gracy Omokoso (dirigeante) — **besoin exprimé** : « éclater l'espace administrateur de
l'espace membre (organisation) : les infos se mélangent ». Voir chaque compte, les abonnements, les
intégrations, tous les utilisateurs, bloquer et débloquer ; gérer les fonctionnalités selon les offres ;
voir les journaux de toute la plateforme ; envoyer notifications et messages à tous les utilisateurs par
catégorie ; voir les statistiques et les finances du site — **tout cela réservé aux administrateurs de
Lalanda en tant que plateforme** ; CTO Lalanda (contrat technique). Le cadrage est **proposé** : chaque
choix qui appartient à la dirigeante porte une valeur par défaut, la plus prudente, appliquée tant
qu'elle ne tranche pas autrement (§ Décisions ouvertes). **Aucune règle juridique n'est posée par cet
ADR** : base légale des accès du personnel de Lalanda, information des personnes bloquées, messages de
masse et prospection, durées de conservation sont des **questions** pour le juriste (§ Questions), sans
effet automatique tant qu'il n'a pas répondu.

> **Précise et complète [ADR-0012](ADR-0012-modele-rbac-complet.md) § 4 et § 5** sans changer la
> matrice rôle d'organisation × action : les six rôles plateforme sont conservés ; un **catalogue
> d'actions plateforme**, distinct des 57 actions d'organisation, leur est donné (§ 5). **Lève une
> contradiction** entre ADR-0012 § 5 (« un super-administrateur n'est pas membre des organisations
> clientes ») et le code (`AuthGuard` exige une organisation, § Faits F2).
> **S'appuie sans les modifier** sur [ADR-0013](ADR-0013-stockage-secrets-integration.md) (coffre,
> ré-authentification de dix minutes), [ADR-0017](ADR-0017-interrupteur-integrations.md) (sens de
> « désactivée »), [ADR-0041](ADR-0041-autorisations-par-membre.md) (autorisations par membre, **sans
> effet sur les rôles plateforme**), [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) (l'éditeur, donc
> l'employeur des opérateurs, est Go freelance SARLU).
> **Dépend d'[ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md)** pour les finances : tant qu'aucune
> pièce n'est remise aux abonnés, la console montre des **encaissements constatés**, jamais un
> « chiffre d'affaires » au sens fiscal ou comptable (§ 6.8).
> **Distinct d'ADR-0052** (mise en route d'une organisation, rédigé en parallèle) : ADR-0052 traite de ce
> qu'une organisation règle **chez elle** ; cet ADR retire de son espace ce qui ne la regarde pas et
> range ce qui regarde Lalanda. Les seules zones communes sont listées au § Zones de conflit.

## Contexte

L'espace d'administration existe depuis S21b (`/admin`, ADR-0012 § 4, ADR-0013). Côté API, il est
correctement fermé : chaque route `/admin/**` exige un rôle plateforme (`@RequirePlatformRole`,
vérifié par `routes-coverage.test.ts`), le journal plateforme est séparé de celui des organisations, et
aucun rôle plateforme n'a de droit implicite sur les données d'une organisation cliente. Ce qui se
mélange est ailleurs :

1. **La même coquille pour deux métiers.** La console vit dans le groupe de routes `(app)`, sous la
   coquille de l'organisation (sélecteur d'organisation, barre de modules BUILD · RUN · GROW,
   acceptation des conditions, cloche des notifications de l'organisation active). L'entrée
   « Administration » est rangée dans le même menu que « Membres », « Paramètres » et « Abonnement ».
   Un opérateur qui est aussi membre d'une organisation ne sait plus s'il agit pour elle ou pour
   Lalanda.
2. **Un opérateur doit appartenir à une organisation cliente** pour ouvrir la console (F2).
3. **Des gestes plateforme écrivent dans le journal du client**, et inversement d'autres gestes qui
   touchent le client n'y apparaissent jamais (F3, F4).
4. **Bloquer ne bloque pas** : un compte désactivé ou une organisation suspendue est déconnecté, puis se
   reconnecte (F5).
5. **Des pans entiers n'ont pas d'écran** : la confirmation des paiements manuels et les Country Packs
   se pilotent par appels d'API bruts ; les rôles `platform_billing` et `platform_country_pack_manager`
   n'ouvrent même pas la console (F7).
6. **Rien n'existe** pour les fonctionnalités par offre, les annonces par catégorie, les statistiques
   au-delà de quelques compteurs, ni les finances du site.

### Faits du dépôt qui commandent les décisions (état des lieux du 2 nov. 2026)

**Ce qui est déjà réservé à la plateforme, et bien fermé :**

| Surface | Garde | Où |
|---|---|---|
| `/admin/overview`, `/admin/organizations/**`, `/admin/users/**`, `/admin/audit-events` | plancher `platform_super_admin`, `platform_admin`, `platform_support` ; écritures resserrées | `apps/api/src/admin/admin.controller.ts:72`, `:133`, `:145`, `:161`, `:181`, `:198`, `:208` |
| `/admin/integrations/**`, `/admin/reauth` | `platform_super_admin` seul, ré-authentification de dix minutes avant écriture | `apps/api/src/integrations/integrations.controller.ts:51-56`, `:144-146` |
| `/payments/manual/*`, `/payments/maintenance/sweep` | `platform_billing`, `platform_admin`, `platform_super_admin` | `apps/api/src/payments/payments.controller.ts:227-321` |
| `/accounting/platform/chart-packs/**` | `platform_country_pack_manager` | `apps/api/src/accounting/chart/accounting-chart-packs.controller.ts:58-60` |
| Journal plateforme | sentinelle `organizationId: 'platform'` ; jamais lu par `/audit-events` | `apps/api/src/integrations/platform-audit.service.ts:36`, `:82` |
| Interdits absolus | 12 actions refusées à tout rôle plateforme (`PLATFORM_FORBIDDEN_ACTIONS`) | `apps/api/src/authz/permissions.ts`, docs/12 |

**Isolation entre organisations : aucune fuite trouvée.** Toute route d'organisation passe par
`PermissionsGuard`, qui résout le rôle **par appartenance** (`resolveOrgRole`) sur le `:orgId` de la
route ou l'organisation active ; un non-membre reçoit `404 ORG_NOT_FOUND`
(`apps/api/src/authz/permissions.guard.ts:85-94`). Le cookie d'organisation active n'est retenu que si
l'utilisateur en est membre (`apps/api/src/auth/auth.guard.ts:66-73`). Le journal d'organisation filtre
sur `organizationId` (`apps/api/src/authz/audit.service.ts:133`). `GET /organizations` ne liste que les
appartenances de l'appelant. Un rôle plateforme n'élargit aucune route d'organisation : une route qui ne
déclare pas `@RequirePlatformRole` ne lit jamais les rôles plateforme (`permissions.guard.ts:64-79`), et
les `support_grants` d'ADR-0012 § 5 ne sont pas implémentés (refus par défaut, docs/12 § Reste à
faire).

**Mélanges et fuites relevés :**

| N° | Constat | Où | Gravité |
|---|---|---|---|
| **F1** | La console est montée sous la coquille de l'organisation (`AppShell` : sélecteur d'organisation, barre de modules, `TermsGate`, cloche) ; l'entrée « Administration » est dans le menu de l'organisation | `apps/web/src/app/(app)/layout.tsx:14`, `apps/web/src/app/(app)/admin/layout.tsx:39`, `apps/web/src/app/(app)/_components/user-menu-model.ts:137` | mélange |
| **F2** | `AuthGuard` refuse `403 NO_ORGANIZATION` à qui n'a aucune appartenance : un opérateur **doit** être membre d'une organisation cliente pour appeler `/admin/**` et `/me/platform-access`, à l'opposé d'ADR-0012 § 5 | `apps/api/src/auth/auth.guard.ts:76-78` | mélange structurant |
| **F3** | **Fuite plateforme → organisation.** Confirmer un paiement manuel écrit l'événement `subscription.payment.succeeded` dans le journal **du client** (`organizationId` du client), avec l'identifiant de l'opérateur et un rôle **codé en dur** `platform_billing`, quel que soit le rôle réel ; l'écran du journal de l'organisation affiche les huit derniers caractères de cet identifiant et le rôle plateforme. Le journal plateforme, lui, ne reçoit rien. Le refus d'un dépôt n'est journalisé nulle part | `apps/api/src/payments/payments.controller.ts:275`, `apps/api/src/billing/billing.service.ts:525-539`, `apps/api/src/payments/payments.service.ts:314-333`, `apps/web/src/app/(app)/organisation/_components/audit-panel.tsx:148-150` | **fuite** (identité interne) et journal inexact |
| **F4** | Inverse : changer le plan d'une organisation, la suspendre ou lever la suspension n'écrit que dans le journal plateforme ; le client n'en voit **aucune trace**. Le changement de plan n'exige **aucun motif** ; `BillingService.setPlan` remet l'abonnement `active` sans événement de paiement | `apps/api/src/admin/admin.service.ts:216-307`, `apps/api/src/admin/admin.dto.ts:10`, `apps/api/src/billing/billing.service.ts:212-229` | opacité |
| **F5** | **Blocage inopérant.** `disabledAt` et `organization_suspensions` ne sont lus nulle part hors de `admin.service.ts` : la désactivation et la suspension révoquent les sessions, la reconnexion réussit | `apps/api/src/admin/organization-suspension.schema.ts:19-22`, docs/17:91 | défaut de sécurité connu |
| **F6** | Désactiver un compte n'exige **aucun motif** ; le motif d'attribution d'un rôle plateforme est facultatif ; **aucune ré-authentification** sur l'attribution de rôle, la suspension, la désactivation ou le changement de plan, alors qu'ADR-0012 § 5 l'exige pour l'attribution | `apps/api/src/admin/admin.dto.ts:33`, `:42` ; `admin.controller.ts` n'importe pas `ReauthGuard` | contrôle manquant |
| **F7** | `platform_billing`, `platform_template_editor` et `platform_country_pack_manager` n'ouvrent pas la console (`ADMIN_READ_ROLES`) ; la file des paiements manuels et les Country Packs n'ont **aucun écran** | `apps/api/src/admin/platform-access.controller.ts:45-49` | trou fonctionnel |
| **F8** | **Minimisation.** L'écran dit la recherche obligatoire, mais `GET /admin/users` sans `q` rend les 50 derniers comptes (jusqu'à 200) avec leur adresse e-mail, y compris au support | `apps/api/src/admin/admin.service.ts:313-322`, `apps/web/src/app/(app)/admin/_components/users-panel.tsx:5-10` | sur-exposition |
| **F9** | Aucun contrôle de **conflit d'intérêts** : un opérateur membre d'une organisation peut confirmer son propre paiement, changer son propre plan ou lever sa propre suspension | `payments.controller.ts:262-282`, `admin.controller.ts:132-167` | séparation des tâches absente |
| **F10** | Libellé du menu : « organisations, **packs**, journaux » alors qu'aucun onglet Packs n'existe | `apps/web/src/app/(app)/_components/user-menu-model.ts:140` | mineur |
| **F11** | Aucune authentification à deux facteurs dans le dépôt (ni `twoFactor`, ni clé d'accès) ; docs/17 l'exige pour les rôles sensibles, docs/12 la pose en préalable à l'ouverture de `/admin` en production | `apps/api/src/auth/auth.ts`, docs/17:25, docs/12 § Reste à faire | exigence non tenue |

**Ce qu'un administrateur d'organisation voit aujourd'hui et ne devrait pas** : uniquement F3 — un
fragment d'identifiant d'opérateur et un nom de rôle plateforme dans son journal. Il ne voit ni les
autres organisations, ni les comptes, ni les intégrations, ni le journal plateforme. **Ce qu'un
opérateur voit et ne devrait pas** : F8 (annuaire des adresses sans recherche). **Ce qu'il fait sans
trace suffisante** : F3, F4, F6, F9.

**Autres faits utiles.** Les droits par offre (`Entitlements`, six champs) vivent en code dans
`@lalanda/shared/pricing` ; la répartition des fonctionnalités par offre est **« À ARBITRER »**
(docs/13) ; l'offre Expert « s'accorde manuellement, par un rôle plateforme » (docs/13). L'envoi
d'e-mails passe par le seul `MailService` (ZeptoMail, docs/28 § 2.5 bis) ; les notifications in-app
sont propres à chaque organisation (`apps/api/src/notifications/`, `analytics.read`). Le circuit de
paiement opérationnel est `manual` (mobile money, virement), sans pièce remise (ADR-0047).

## Options considérées

### O1 — Où vit la console ?

- **(a) Rester sous `(app)`**, en masquant mieux : ne règle ni F1 ni F2.
- **(b) Groupe de routes séparé dans la même application web**, avec sa propre coquille (pas
  d'organisation active, pas de modules), même domaine. Coût faible ; isole l'interface ; ne sépare pas
  les cookies.
- **(c) Sous-domaine dédié** (`console.` + domaine de production) servi par la même application :
  cookies de session et politique de sécurité de contenu propres, surface d'attaque réduite (une faille
  XSS dans un module client n'atteint pas la console). Demande DNS, certificat, configuration
  better-auth multi-origine, et un second cookie de session.
- **(d) Application distincte** (`apps/console`) : séparation maximale, double maintenance.

**Retenu : (b) en v1, construit pour basculer en (c)** sans réécriture (la coquille ne dépend d'aucune
donnée d'organisation). Le sous-domaine est une décision ouverte (n° 1).

### O2 — Comment exprimer les droits plateforme ?

- **(a) Rôles seuls** (`@RequirePlatformRole`, état actuel) : chaque route recopie une liste de rôles ;
  une évolution de la matrice oblige à relire tous les contrôleurs.
- **(b) Catalogue d'actions plateforme + matrice rôle plateforme × action**, sur le modèle de
  `permissions.ts` : une route déclare une action, la matrice dit qui la détient, un test l'épuise.

**Retenu : (b).** Le catalogue est **distinct** des 57 actions d'organisation : une action plateforme
porte sur des ressources de Lalanda (comptes, abonnements, annonces), jamais sur le contenu d'une
organisation. La matrice existante `PLATFORM_PERMISSION_MATRIX` (rôle plateforme × action
d'organisation, `native` / `delegated` / `forbidden`) reste la vérité pour l'accès délégué futur.

### O3 — Que montrer au client des gestes plateforme qui le touchent ?

- **(a) Rien** (F4 actuel) : un client découvre un plan changé sans explication.
- **(b) Tout, avec l'identité de l'opérateur** (F3 actuel, partiellement) : expose le personnel de
  Lalanda.
- **(c) Un miroir pseudonyme** : l'événement apparaît dans le journal de l'organisation avec l'acteur
  « Équipe Lalanda », le motif destiné au client et la référence de l'événement plateforme ; l'identité
  réelle reste dans le journal plateforme.

**Retenu : (c)** (décision ouverte n° 6).

### O4 — Effet d'une suspension d'organisation

- **(a) Déconnexion seule** (état actuel) : sans effet réel.
- **(b) Accès refusé en totalité** : prend les données du client en otage.
- **(c) Lecture seule** : écritures refusées (`423 ORGANIZATION_SUSPENDED`), lecture et exports
  conservés, bannière explicative.

**Retenu : (c)** par défaut (décision ouverte n° 4). La suspension **administrative** reste distincte de
l'état d'abonnement `suspended` (impayé → droits de l'offre gratuite, docs/13) : deux mots différents à
l'écran.

### O5 — Fonctionnalités par offre : éditables dans la console ?

- **(a) Grille éditable en direct** : un clic change une règle commerciale pour tous les clients, sans
  revue de code ni test.
- **(b) Catalogue de drapeaux en code, lu par la console** ; les valeurs par offre restent en code
  (revue, tests, version) ; la console montre qui a quoi, qui dépasse, et propose des **dérogations
  par organisation** motivées et datées.
- **(c) Rien** : la question reste dans docs/13.

**Retenu : (b)**, sans aucune garde nouvelle tant que la répartition de docs/13 n'est pas arbitrée
(décision ouverte n° 10).

### O6 — Annonces de masse

- **(a) Envoi immédiat par un opérateur** : une erreur de catégorie touche des milliers de personnes.
- **(b) Brouillon → aperçu du nombre de destinataires → approbation par une seconde personne → envoi
  confirmé** ; approbateur unique toléré et marqué quand la plateforme n'a qu'un détenteur.

**Retenu : (b)**, canal in-app seul en v1 (décision ouverte n° 9).

## Décision

### 1. Vocabulaire

| Terme | Sens |
|---|---|
| **Console Lalanda** (« la console ») | l'espace des opérateurs de la plateforme ; remplace « Administration » dans l'interface pour ne plus se confondre avec le rôle d'organisation « Administrateur » |
| **Opérateur** | personne détenant au moins un rôle plateforme (`platform_roles`, non révoqué, non expiré) |
| **Espace organisation** | tout ce qui dépend d'une organisation active : modules, réglages, membres, abonnement vu par le client |
| **Suspension administrative** | décision motivée d'un opérateur sur une organisation (`organization_suspensions`) ; distincte de l'état d'abonnement `suspended` |
| **Blocage d'un compte** | décision motivée d'un opérateur sur une personne (`user.disabledAt`) |
| **Geste plateforme** | toute écriture d'un opérateur, et toute lecture de la fiche détaillée d'une organisation ou d'un compte |
| **Miroir** | copie pseudonyme d'un geste plateforme dans le journal de l'organisation qu'il touche |
| **Octroi manuel** | changement de plan sans paiement (offre Expert, geste commercial, correction) |
| **Encaissements constatés** | sommes confirmées par un paiement vérifié (rappel signé ou dépôt manuel confirmé) ; **pas** un chiffre d'affaires fiscal (ADR-0047) |
| **Catégorie de destinataires** | filtre déclaratif sur des métadonnées de plateforme (§ 6.6), jamais sur le contenu d'une organisation |

### 2. La frontière

#### 2.1 Interface

- La console quitte `apps/web/src/app/(app)/admin/**` pour un groupe de routes propre,
  `apps/web/src/app/(console)/admin/**`, avec **sa** coquille : pas de sélecteur d'organisation, pas de
  barre de modules, pas de cloche d'organisation, pas de `TermsGate` d'organisation. Elle n'appelle
  aucune route d'organisation (`/me/permissions`, `/notifications`, `/organizations/current/**`) : un
  test de modèle le vérifie sur la liste des appels de la coquille.
- L'URL `/admin` est conservée (docs, liens, tests) ; le sous-domaine est la décision ouverte n° 1.
- Bandeau permanent « Console Lalanda — vous agissez pour la plateforme », couleur propre, rôle(s)
  affiché(s).
- Dans l'espace organisation, l'entrée « Administration » devient **« Console Lalanda »**, dans son
  propre groupe du menu, visible des seuls opérateurs ; elle ouvre la console dans sa coquille
  (décision ouverte n° 17). Le libellé faux « packs » disparaît (F10).

#### 2.2 API

- **`PlatformAuthGuard`** (nouveau, `apps/api/src/authz/platform-auth.guard.ts`) : session valide, compte
  non bloqué, **aucune résolution d'organisation**. Il remplace `AuthGuard` sur `/admin/**`,
  `/me/platform-access`, la file des paiements manuels (§ 6.2) et `/accounting/platform/**`. Corrige F2 :
  un opérateur sans appartenance ouvre la console.
- **`@RequirePlatformAction(action)`** (nouveau décorateur) lu par `PermissionsGuard` ; `@RequirePlatformRole`
  reste accepté pendant une version, puis `routes-coverage.test.ts` l'interdit sur les routes nouvelles.
- **Préfixe unique** : toute route de la console vit sous `/admin/**`. Les routes `/payments/manual/*` et
  `/payments/maintenance/sweep` sont **dupliquées** sous `/admin/billing/**` puis retirées une version
  plus tard (compatibilité N-1, comme `member`).
- **Aucune route `/admin/**` ne lit une collection métier d'organisation** (`projects`, `plans`,
  `sales_*`, `treasury_*`, `hr_*`, `accounting_*`, `stock_*`, `documents`, `crm_*`, `work_*`…). Un test de
  source (`admin.sources.test.ts`) liste les modèles injectés dans `apps/api/src/admin/**` et échoue sur
  tout modèle hors d'une liste blanche de métadonnées (`organizations`, `memberships`, `user`,
  `subscriptions`, `payment_events`, `manual_payment_requests`, `platform_roles`,
  `organization_suspensions`, `ai_usage_events`, `pdf_export_usage`, `audit_events` en portée
  `platform` seulement, collections nouvelles de cet ADR).

#### 2.3 Rôles plateforme distincts

Les six rôles d'ADR-0012 § 2 sont conservés, dans `platform_roles`, jamais dans `memberships`. Un rôle
plateforme **n'ajoute rien** dans une organisation ; une appartenance **n'ajoute rien** dans la console.
Les autorisations par membre (ADR-0041) ne s'appliquent pas aux rôles plateforme. **Aucun rôle nouveau**
(décision ouverte n° 7). `ADMIN_READ_ROLES` disparaît au profit de la matrice du § 5 : chaque rôle
ouvre la console et n'y voit que ses modules (corrige F7).

#### 2.4 Authentification renforcée

- **État** : aucune double authentification n'existe (F11). Elle **n'est donc pas imposée** par cet ADR ;
  son introduction est la décision ouverte n° 2.
- **En attendant (défaut)** : toute **écriture** de la console exige la ré-authentification de dix
  minutes d'ADR-0013 (`ReauthGuard`, aujourd'hui limitée aux intégrations) ; la session de console
  expire après 12 heures d'inactivité ; l'attribution d'un rôle plateforme est refusée si l'attributaire
  n'a pas vérifié son adresse e-mail.
- **Si la double authentification est retenue** (lot P8) : TOTP par le greffon `twoFactor` de
  better-auth, enrôlement dans `/compte/securite`, codes de secours ; `PlatformAuthGuard` refuse
  `403 PLATFORM_2FA_REQUIRED` à un opérateur non enrôlé, sauf pour l'enrôlement lui-même.

#### 2.5 Journal de chaque geste plateforme

- **Toute** écriture de la console, et toute lecture d'une fiche détaillée (organisation, compte),
  écrit **un** événement dans le journal plateforme (`PlatformAuditService`, portée `platform`) :
  acteur réel, **rôles réellement détenus** (relus, jamais déduits de la route : corrige
  `payments.controller.ts:275`), action, cible, motif, adresse IP tronquée, horodatage.
- Ajout seul : aucune route ne modifie ni ne supprime un événement ; la console le lit, filtre et
  exporte (export lui-même journalisé, `platform.audit.exported`).
- **Miroir** dans le journal de l'organisation touchée (O3-c) pour : changement de plan, octroi manuel,
  confirmation ou refus d'un paiement manuel, suspension et levée, blocage d'un de ses membres, accès
  délégué (futur). Acteur affiché : `platform:lalanda`, libellé « Équipe Lalanda » ; métadonnées :
  motif **destiné au client**, référence de l'événement plateforme ; **jamais** l'identifiant ni le rôle
  de l'opérateur (corrige F3).
- Les écritures de `BillingService` déclenchées par un opérateur passent ce pseudonyme à
  `audit.record` ; les rappels de paiement signés gardent `system`.

#### 2.6 Accès aux données d'une organisation : minimisation et justification

- La console voit des **métadonnées** (ADR-0012 § 5.1) : nom, pays, type, date de création, offre,
  état d'abonnement, nombre de membres, de projets, consommation des quotas, adresse du Propriétaire
  (pour le contact). **Aucun montant, aucun contenu, aucun nom de client ou de salarié.** La liste
  blanche des champs servis est figée par un test d'instantané des clés de réponse.
- **Recherche obligatoire côté serveur** : `GET /admin/users` sans `q` d'au moins trois caractères →
  `400 SEARCH_REQUIRED` ; idem pour la liste des organisations au-delà de la première page (corrige F8).
- **Ouvrir la fiche détaillée** d'une organisation ou d'un compte exige un **motif** choisi dans une liste
  (assistance, facturation, sécurité, abus, demande légale) et journalise la lecture
  (`platform.organization.viewed`, `platform.user.viewed`).
- **Contenu d'une organisation** : uniquement par l'accès délégué d'ADR-0012 § 5 (`support_grants`,
  consentement d'un Propriétaire, durée bornée), **hors v1** (décision ouverte n° 12). D'ici là, refus.
- **Conflit d'intérêts** (corrige F9) : `platformSelfDealingDecision(actor, organizationId)`, fonction
  pure — un opérateur **membre** de l'organisation cible ne confirme pas son paiement, ne change pas son
  offre, n'accorde pas de dérogation, ne suspend ni ne lève sa suspension : `409
  PLATFORM_SELF_DEALING`. Exception unique : il est le seul détenteur de l'action (cas de la dirigeante
  seule), geste marqué `soleOperator: true` dans le journal plateforme et dans le miroir.

### 3. Ce que garde l'espace organisation

| Garde | Où | Changement |
|---|---|---|
| Membres, invitations, rôles, autorisations par membre | `/organisation/membres` | aucun |
| Réglages, identité visuelle, fiscalité, mise en route | `/organisation/**` | aucun (ADR-0052 pour la mise en route) |
| **Abonnement vu par le client** : offre, état, essai, quotas consommés, changement d'offre, demandes de paiement manuel en cours **de l'organisation**, futurs reçus (ADR-0047) | `/souscription`, `/organisation/facturation` | ajout : historique des octrois et dérogations reçus (miroir), motif client |
| **Son journal** | `/organisation/journal` | les gestes plateforme y paraissent en « Équipe Lalanda », jamais un identifiant d'opérateur |
| Consentement à un accès délégué (futur) | `/organisation` | hors v1 |
| Annonces reçues | bannière et cloche | ajout : type de notification `platform.announcement` |

Ce que l'espace organisation **ne montre jamais** : la liste des organisations ou des comptes, l'état des
intégrations de la plateforme, le journal plateforme, les statistiques ou finances de Lalanda, l'identité
des opérateurs.

### 4. Modèle de données

Toutes les collections nouvelles sont de **portée plateforme** (pas d'`organizationId` de locataire, ou
un `organizationId` **cible** explicitement nommé `targetOrganizationId`).

- `organization_suspensions` (existe) : ajout `reasonCategory` (`unpaid`, `abuse`, `fraud`, `legal`,
  `request`, `other`), `clientMessage` (texte destiné au client, 500 car.), `internalNote` (jamais
  servi au client), `mode` (`read_only` | `full`), `liftReason`, `liftedClientMessage`.
- `user` (better-auth, champ ajouté hors schéma comme aujourd'hui) : `disabledAt` (existe),
  `disabledReasonCategory`, `disabledInternalNote`, `disabledBy`.
- `platform_plan_grants` (nouveau) : `{ targetOrganizationId, plan, reasonCategory, clientMessage,
  internalNote, startsAt, endsAt?, grantedBy, revokedAt?, revokedBy?, _schemaVersion }` — trace de chaque
  octroi manuel ; `setPlan` direct disparaît de la console.
- `platform_feature_overrides` (nouveau, décision n° 10) : `{ targetOrganizationId, feature, value,
  reasonCategory, internalNote, endsAt, grantedBy, revokedAt? }`.
- `platform_announcements` (nouveau) : `{ title, body (texte brut, 2 000 car.), channel: 'in_app',
  audience: AudienceFilter, audienceCountAtApproval, status: draft|pending_approval|approved|sent|canceled,
  createdBy, approvedBy?, soleApprover, sentAt?, expiresAt, _schemaVersion }`.
- `platform_announcement_receipts` (nouveau) : `{ announcementId, userId, deliveredAt, readAt?,
  dismissedAt? }`, index unique `{ announcementId, userId }`.
- `audit_events` (existe) : aucune modification de schéma ; miroir écrit avec `actorUserId:
  'platform:lalanda'`, `actorRole: 'platform'`.

### 5. RBAC plateforme

#### 5.1 Catalogue d'actions plateforme (`PLATFORM_ACTIONS`, fichier nouveau `platform-actions.ts`)

| Action | Libellé | Module |
|---|---|---|
| `platform.console.read` | Ouvrir la console et son tableau de bord | socle |
| `platform.orgs.read` | Rechercher et consulter les organisations (métadonnées) | § 6.1 |
| `platform.orgs.suspend` | Suspendre et rétablir une organisation | § 6.1 |
| `platform.users.read` | Rechercher et consulter les comptes | § 6.1 |
| `platform.users.block` | Bloquer et débloquer un compte | § 6.1 |
| `platform.roles.manage` | Attribuer et retirer les rôles plateforme | § 6.1 |
| `platform.billing.read` | Consulter abonnements, demandes et paiements | § 6.2 |
| `platform.billing.confirm` | Confirmer ou refuser un paiement manuel | § 6.2 |
| `platform.billing.grant` | Octroyer une offre sans paiement, la retirer | § 6.2 |
| `platform.features.read` | Consulter le catalogue des fonctionnalités par offre | § 6.3 |
| `platform.features.override` | Accorder une dérogation de fonctionnalité | § 6.3 |
| `platform.integrations.manage` | Gérer les intégrations de la plateforme | § 6.4 |
| `platform.audit.read` | Consulter le journal plateforme et les événements de sécurité | § 6.5 |
| `platform.audit.export` | Exporter le journal plateforme | § 6.5 |
| `platform.announcements.draft` | Préparer une annonce | § 6.6 |
| `platform.announcements.approve` | Approuver et envoyer une annonce (ⓢ) | § 6.6 |
| `platform.stats.read` | Consulter les statistiques agrégées | § 6.7 |
| `platform.finance.read` | Consulter les finances du site | § 6.8 |
| `platform.finance.export` | Exporter les finances du site | § 6.8 |
| `platform.packs.manage` | Gérer les Country Packs et plans comptables | existant |
| `platform.templates.manage` | Gérer les modèles sectoriels | existant (ADR-0012) |

#### 5.2 Matrice (SA super-administrateur, PA administrateur plateforme, SUP support, FAC finance/facturation, TPL éditeur de modèles, CPK gestionnaire comptable/fiscal)

| Action | SA | PA | SUP | FAC | TPL | CPK |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `platform.console.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `platform.orgs.read` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `platform.orgs.suspend` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `platform.users.read` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `platform.users.block` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `platform.roles.manage` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `platform.billing.read` | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| `platform.billing.confirm` | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `platform.billing.grant` | ✓ | ✓ⓢ | ✗ | ✓ⓢ | ✗ | ✗ |
| `platform.features.read` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `platform.features.override` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `platform.integrations.manage` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `platform.audit.read` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `platform.audit.export` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `platform.announcements.draft` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `platform.announcements.approve` | ✓ⓢ | ✓ⓢ | ✗ | ✗ | ✗ | ✗ |
| `platform.stats.read` | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| `platform.finance.read` | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `platform.finance.export` | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `platform.packs.manage` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `platform.templates.manage` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

Écarts avec l'état actuel, à valider (décision ouverte n° 7) : `platform_admin` **perd** la
confirmation des paiements manuels (`payments.controller.ts:264`), qui revient à la finance et au
super-administrateur ; `platform_support` **perd** la liste des organisations au-delà de la recherche et
le journal plateforme ; `platform_billing` **gagne** la console. `platform.packs.manage` reste au seul
gestionnaire comptable et fiscal, comme aujourd'hui (le super-administrateur ne publie pas un pack :
docs/12 § Règles critiques, flux d'approbation des packs).

#### 5.3 Séparation des tâches

- `platformSelfDealingDecision` (§ 2.6) : aucun opérateur n'agit sur une organisation dont il est
  membre ; approbateur unique marqué.
- `broadcastApprovalDecision` : l'auteur d'une annonce ne l'approuve pas ; deux personnes ; exception
  `soleApprover` si un seul détenteur effectif de `platform.announcements.approve`, marquée.
- `platformGrantDecision` : un octroi manuel au-delà de 90 jours, ou de l'offre Expert, exige une
  seconde personne détentrice de `platform.billing.grant` ; exception approbateur unique marquée.
- Attribution de rôle : jamais à soi-même (`SELF_GRANT_FORBIDDEN`, s'ajoute à `SELF_DEMOTION_FORBIDDEN`) ;
  motif **obligatoire** ; échéance obligatoire pour `platform_support` (90 jours maximum par défaut).
- Débloquer exige un motif, comme bloquer ; celui qui a bloqué peut débloquer.
- Les douze interdits absolus de `PLATFORM_FORBIDDEN_ACTIONS` restent inaccessibles depuis la console :
  `routes-coverage.test.ts` continue de l'éprouver.

### 6. Modules de la console

#### 6.1 Comptes et organisations

- Recherche (§ 2.6), fiche métadonnées, motif de consultation.
- **Bloquer un compte** : catégorie + note interne obligatoires (10 caractères minimum), ré-authentification,
  sessions révoquées, **connexion refusée** ensuite (`AuthGuard` et `PlatformAuthGuard` lisent
  `disabledAt` ; un crochet better-auth `session.create.before` refuse l'ouverture de session) :
  `403 ACCOUNT_BLOCKED`, message générique (« Votre compte est bloqué. Contactez le support. »).
  Corrige F5.
- **Suspendre une organisation** : catégorie, message client, note interne, mode (§ O4). Effet appliqué
  par `PermissionsGuard` sur toute route d'organisation : en `read_only`, toute route d'écriture →
  `423 ORGANIZATION_SUSPENDED` ; en `full`, toute route → `423` sauf `GET /organizations` et la page
  d'explication. Les membres d'autres organisations ne sont pas touchés. Miroir dans le journal ;
  Propriétaire prévenu dans l'application (bannière) ; e-mail : décision ouverte n° 5.
- Rétablir : motif client et note, miroir.
- Rôles plateforme : écran du super-administrateur seul (existe), motif et échéance (§ 5.3).

#### 6.2 Abonnements et paiements manuels

- Tableau des abonnements : offre, état, fin d'essai ou de période, moyen ; filtres par état (`trialing`,
  `past_due`, `grace`, `suspended`…). Métadonnées seulement.
- **File des paiements manuels** : référence, organisation, offre, montant dû, moyen, échéance de la
  demande. **Confirmer** : note obligatoire (référence de l'opération reçue), ré-authentification,
  `platformSelfDealingDecision`. **Refuser** : motif obligatoire (existe), désormais **journalisé**
  (corrige F3, refus non tracé). Les deux écrivent au journal plateforme avec le rôle réel et un miroir
  pseudonyme côté client.
- **Octroi manuel** (`platform_plan_grants`) : remplace `PATCH /admin/organizations/:id/plan` ; motif,
  message client, dates ; retrait possible ; `platformGrantDecision`. Le changement passe par un
  événement de cycle de vie nommé (`plan.granted`), plus jamais par `setPlan` qui remet `active` sans
  trace (F4).
- **Aucune pièce fiscale** n'est produite ici : la remise d'un reçu ou d'une facture appartient à
  ADR-0047 ; la console affichera le lien vers la pièce quand elle existera.

#### 6.3 Fonctionnalités par offre

- **Catalogue** `FEATURES` dans `@lalanda/shared/pricing` (fichier nouveau `features.ts`) : une clé par
  fonctionnalité de la table « Répartition des fonctionnalités par offre » de docs/13 (`crm`, `quotes`,
  `normalized_invoicing`, `treasury`, `morning_brief`, `idea_lab`, `business_plan`, `run_work`,
  `purchases`, `hr`, `stock`, `accounting`, `sales_contracts`, `lala_vocal`…), avec : libellé, module,
  préfixes de routes API concernés, valeur par offre. Les six `Entitlements` existants restent tels
  quels.
- **Effet API** : décorateur `@RequireFeature(key)` lu par un `FeatureGuard` **après**
  `PermissionsGuard` ; refus `403 FEATURE_NOT_IN_PLAN` avec l'offre minimale. La règle de docs/13
  s'applique : une limite porte sur les **gestes futurs**, jamais sur le patrimoine (lecture et export
  de l'existant conservés).
- **Effet interface** : `GET /me/features` (organisation active) ; la barre de modules et les écrans
  **expliquent** une fonctionnalité absente (« Disponible avec l'offre … ») plutôt que de la cacher ;
  l'API impose.
- **Console** : grille en lecture seule (offre × fonctionnalité), organisations en dépassement,
  dérogations actives. **Par défaut, toutes les fonctionnalités valent « ouvert » pour toutes les
  offres** (état actuel, décision de la dirigeante du 27 oct. 2026) : le lot P4 ne ferme **rien**.
- **Dérogations** par organisation (`platform_feature_overrides`), motif et échéance obligatoires
  (décision ouverte n° 10).
- À distinguer des modules qu'une organisation choisit d'activer chez elle (mise en route, ADR-0052) :
  l'offre dit ce qui est **permis**, l'organisation choisit ce qui est **allumé**.

#### 6.4 Intégrations

Inchangé sur le fond (ADR-0013, ADR-0017) : super-administrateur seul, écriture seule, ré-authentification,
test avant enregistrement. Change : la page passe dans la coquille de console ; l'action devient
`platform.integrations.manage`. Les intégrations **propres à une organisation**, s'il en vient (ADR-0042,
connexion Google d'envoi), restent dans l'espace organisation.

#### 6.5 Journaux de la plateforme

- **Journal plateforme** : filtres par action, acteur, cible, période ; export CSV journalisé.
- **Événements de sécurité agrégés** : connexions refusées pour compte bloqué, refus `403` sur `/admin/**`,
  ré-authentifications échouées, attributions de rôles — comptes par jour, sans contenu d'organisation.
- **Ce que la console ne montre pas** : le journal d'une organisation (accès délégué seulement), les
  journaux techniques du serveur (stdout, hébergeur), qui restent dans l'outillage d'exploitation
  (docs/24) — décision ouverte n° 11.

#### 6.6 Annonces et notifications par catégorie de destinataires

- **Catégories** (`AudienceFilter`, combinables en ET) : tous les comptes actifs ; Propriétaires
  seulement ; organisations par offre ; par état d'abonnement (essai, impayé, grâce) ; par pays de
  l'organisation ; par rôle d'organisation ; comptes inscrits depuis/avant une date. Aucune catégorie
  ne dépend du contenu d'une organisation.
- **Circuit** : brouillon → **aperçu** (texte rendu + **nombre** de destinataires, jamais la liste des
  adresses) → soumission → **approbation** par une autre personne (§ 5.3) → **envoi**, qui exige de
  **retaper le nombre de destinataires** affiché ; le compte est recalculé à l'envoi et un écart de plus
  de 10 % renvoie à l'approbation. Annulation possible jusqu'à l'envoi.
- **Canal v1 : in-app** (bannière de la coquille d'organisation et cloche, type
  `platform.announcement`), lue par le destinataire quelle que soit son organisation active ; texte
  brut, aucun lien externe sans aperçu. **Aucun e-mail de masse** en v1 (décision ouverte n° 9).
- **Garde-fous** : une annonce expire (30 jours par défaut) ; au plus une annonce active par catégorie
  « tous » ; aucun envoi automatique ni programmé en v1 ; tout l'enchaînement journalisé.

#### 6.7 Statistiques

- Agrégats seulement : organisations (total, actives sur 30 jours, par offre, par pays, par état
  d'abonnement), comptes, essais démarrés et convertis, consommation IA et PDF (compteurs existants),
  modules utilisés (nombre d'organisations qui ont au moins un document dans un module, sans montant).
- **Seuil de diffusion** : aucune case de moins de 5 organisations n'est affichée (« < 5 ») (décision
  ouverte n° 13).
- Calculs par fonctions pures testées (`apps/api/src/admin/stats/stats.ts`) ; aucun chiffre financier
  d'un client.

#### 6.8 Finances du site

- **Encaissements constatés** par mois, par offre, par moyen (`manual`, `stripe`, `paypal`), en USD
  (`BILLING_CURRENCY`) ; **revenu récurrent mensuel déclaré** (somme des abonnements actifs ramenés au
  mois) ; demandes manuelles en attente et expirées ; organisations en `past_due` et `grace` ; crédits
  reportés (`carriedCreditCents`).
- **Moteur** : ces calculs sont des fonctions pures dans `packages/engine/src/platform-revenue/`
  (CLAUDE.md : le moteur est l'unique source des calculs), à partir de `payment_events`,
  `manual_payment_requests` et `subscriptions`. L'interface et l'export consomment ses résultats.
- **Mots** : « encaissements », « revenu récurrent déclaré » ; jamais « chiffre d'affaires »,
  « facturé » ni « TVA » tant qu'ADR-0047 n'est pas tranché et que l'expert-comptable n'a pas répondu
  (décision ouverte n° 14). Aucun taux de change n'est appliqué (docs/13 § 5).
- Export CSV réservé à `platform.finance.export`, journalisé.

### 7. Contrat HTTP (préfixe `/admin`, `PlatformAuthGuard`, `PermissionsGuard`, action plateforme par route)

```
GET    /me/platform-access                              rôles, actions plateforme détenues (PlatformAuthGuard)
GET    /admin/overview                                  platform.console.read
GET    /admin/organizations?q=                          platform.orgs.read      (q ≥ 3 car. au-delà de la 1re page)
GET    /admin/organizations/:organizationId?reason=     platform.orgs.read      (lecture journalisée)
POST   /admin/organizations/:organizationId/suspend     platform.orgs.suspend   (ré-auth)
POST   /admin/organizations/:organizationId/restore     platform.orgs.suspend   (ré-auth)
GET    /admin/users?q=                                  platform.users.read     (q ≥ 3 car., sinon 400)
GET    /admin/users/:userId?reason=                     platform.users.read     (lecture journalisée)
POST   /admin/users/:userId/block                       platform.users.block    (ré-auth)
POST   /admin/users/:userId/unblock                     platform.users.block    (ré-auth)
POST   /admin/users/:userId/platform-roles              platform.roles.manage   (ré-auth)
DELETE /admin/users/:userId/platform-roles/:role        platform.roles.manage   (ré-auth)
GET    /admin/billing/subscriptions                     platform.billing.read
GET    /admin/billing/manual-payments                   platform.billing.read
POST   /admin/billing/manual-payments/:reference/confirm  platform.billing.confirm (ré-auth)
POST   /admin/billing/manual-payments/:reference/reject   platform.billing.confirm (ré-auth)
POST   /admin/billing/sweep                             platform.billing.confirm
GET    /admin/billing/grants                            platform.billing.read
POST   /admin/billing/grants                            platform.billing.grant  (ré-auth)
DELETE /admin/billing/grants/:id                        platform.billing.grant  (ré-auth)
GET    /admin/features                                  platform.features.read
POST   /admin/features/overrides                        platform.features.override (ré-auth)
DELETE /admin/features/overrides/:id                    platform.features.override (ré-auth)
GET    /admin/audit-events                              platform.audit.read
GET    /admin/audit-events/export.csv                   platform.audit.export
GET    /admin/security-events                           platform.audit.read
GET    /admin/announcements                             platform.announcements.draft
POST   /admin/announcements                             platform.announcements.draft
PUT    /admin/announcements/:id                         platform.announcements.draft (brouillon seulement)
POST   /admin/announcements/:id/preview                 platform.announcements.draft (nombre de destinataires)
POST   /admin/announcements/:id/submit                  platform.announcements.draft
POST   /admin/announcements/:id/approve                 platform.announcements.approve (ré-auth)
POST   /admin/announcements/:id/send                    platform.announcements.approve (ré-auth, nombre retapé)
POST   /admin/announcements/:id/cancel                  platform.announcements.draft
GET    /admin/stats                                     platform.stats.read
GET    /admin/finance?from=&to=                         platform.finance.read
GET    /admin/finance/export.csv                        platform.finance.export
/admin/integrations/**                                  platform.integrations.manage (inchangé)
GET    /me/announcements                                AuthGuard (destinataire), aucune action
POST   /me/announcements/:id/dismiss                    AuthGuard (destinataire)
GET    /me/features                                     analytics.read (organisation active)
```

Codes : `400 SEARCH_REQUIRED`, `400 REASON_REQUIRED`, `401 REAUTH_REQUIRED`, `403 ACCOUNT_BLOCKED`,
`403 PLATFORM_2FA_REQUIRED` (si P8), `403 FEATURE_NOT_IN_PLAN`, `409 PLATFORM_SELF_DEALING`,
`409 SELF_APPROVAL_FORBIDDEN`, `409 AUDIENCE_COUNT_MISMATCH`, `423 ORGANIZATION_SUSPENDED`.
`PATCH /admin/organizations/:id/plan`, `PATCH /admin/users/:id/disabled`,
`DELETE /admin/organizations/:id/suspend` et `/payments/manual/*` restent servis **une version**, puis
sont retirés (`410`).

### 8. Ce que cet ADR n'invente pas

- Aucun prix, aucune répartition des fonctionnalités par offre (docs/13 « À ARBITRER ») : le catalogue
  part de l'état actuel, tout ouvert.
- Aucune règle fiscale ni comptable sur les abonnements (ADR-0047, docs/28 § 6).
- Aucune base légale, durée de conservation ni obligation d'information : questions au juriste.
- Aucun délai de relance ni de suspension pour impayé (docs/28 § 3.2, CGV) : la suspension
  administrative est un geste humain motivé, jamais une tâche automatique.

## Hors périmètre (v1), dit explicitement

- Accès délégué au contenu d'une organisation (`support_grants`, ADR-0012 § 5) et usurpation de session.
- E-mails de masse, SMS, notifications poussées ; annonces programmées.
- Édition en direct de la grille des offres et des prix.
- Lecture des journaux d'organisation ou des journaux techniques du serveur depuis la console.
- Facturation des abonnements (ADR-0047).
- Sous-domaine dédié (prévu, non livré).

## Conséquences

- Groupe de routes web nouveau `(console)` ; `(app)/admin/**` déplacé (aucune page d'organisation ne
  change, hors une entrée de menu et le rendu du miroir dans le journal).
- `PlatformAuthGuard`, `@RequirePlatformAction`, `@RequireFeature`, `FeatureGuard` ; `AuthGuard` lit
  `disabledAt` ; `PermissionsGuard` applique la suspension administrative.
- Collections nouvelles : `platform_plan_grants`, `platform_feature_overrides`, `platform_announcements`,
  `platform_announcement_receipts` ; champs ajoutés à `organization_suspensions` et `user`.
- Moteur : module `platform-revenue` nouveau.
- RBAC : 21 actions plateforme, matrice 6 × 21 = **126** cases nouvelles ; aucune action d'organisation
  ajoutée ; `PLATFORM_PERMISSION_MATRIX` et les 1 026 cases existantes inchangées.
- Un type de notification nouveau (`platform.announcement`).
- docs/12 (§ Rôles plateforme, actions plateforme), docs/13 (§ Répartition : le catalogue devient la
  liste de référence), docs/15 (collections), docs/16 (routes), docs/17 (§ Implémenté S21b : limites
  levées), docs/28 (questions § Questions) à amender par le lot de documentation de P0.

## Critères d'acceptation (testables)

1. **Console sans organisation** : un compte sans aucune appartenance, titulaire de
   `platform_super_admin`, obtient `200` sur `GET /me/platform-access` et `GET /admin/overview` ; sans
   rôle plateforme, il obtient `403` (et non `NO_ORGANIZATION`).
2. **Isolation organisation → plateforme (e2e, exhaustif)** : pour chacun des 12 rôles d'organisation,
   Propriétaire compris, sans rôle plateforme, **toutes** les routes `/admin/**` découvertes par
   introspection répondent `403` ; la sonde échoue si une route `/admin/**` nouvelle n'est pas couverte.
3. **Isolation plateforme → organisation (e2e, exhaustif)** : pour chacun des 6 rôles plateforme, un
   opérateur **non membre** reçoit `403 NO_ORGANIZATION` ou `404 ORG_NOT_FOUND` sur **toutes** les
   routes d'organisation déclarant `@RequirePermission` ; un opérateur membre de A seulement reçoit
   `404` sur toute ressource de B (identifiant connu).
4. **Minimisation** : la réponse de `GET /admin/organizations/:id` ne contient **que** les clés de la
   liste blanche (instantané de clés) ; aucune valeur de `projects`, `sales_*`, `treasury_*`, `hr_*`,
   `accounting_*` d'une organisation semée n'apparaît dans aucune réponse `/admin/**` (balayage de
   chaînes témoins, sur le modèle de `no-secret-leak.test.ts`).
5. **Test de source** : `admin.sources.test.ts` échoue si un modèle hors liste blanche est injecté
   sous `apps/api/src/admin/**`.
6. **Recherche obligatoire** : `GET /admin/users` sans `q` ou avec moins de trois caractères →
   `400 SEARCH_REQUIRED`, pour tous les rôles.
7. **Lecture journalisée** : ouvrir une fiche d'organisation sans `reason` → `400 REASON_REQUIRED` ;
   avec, un événement `platform.organization.viewed` portant le motif.
8. **Blocage effectif** : un compte bloqué ne peut plus ouvrir de session (`403 ACCOUNT_BLOCKED` au
   login) ni utiliser une session antérieure ; débloqué, il se reconnecte. Bloquer sans catégorie ou
   note → `400`.
9. **Suspension effective** : organisation en `read_only` : `GET` sur ses ressources `200`, toute
   écriture `423 ORGANIZATION_SUSPENDED` ; en `full`, toute route `423` sauf `GET /organizations` ; les
   autres organisations du même membre restent intactes.
10. **Journal plateforme exact** : la confirmation d'un paiement manuel par un `platform_super_admin`
    écrit dans le journal plateforme `actorRole` = ses rôles réels (jamais `platform_billing` codé en
    dur) ; le refus est journalisé.
11. **Miroir pseudonyme (fuite F3 fermée)** : après confirmation, octroi, suspension, levée ou blocage
    d'un membre, le journal de l'organisation contient l'événement avec `actorUserId =
    'platform:lalanda'` ; **aucun** identifiant, suffixe d'identifiant ni rôle d'opérateur n'apparaît
    dans `GET /audit-events` d'une organisation (balayage).
12. **Journal plateforme invisible du client** : aucun événement de portée `platform` n'est servi par
    `GET /audit-events`, quel que soit le rôle d'organisation.
13. **Conflit d'intérêts** : un opérateur membre de l'organisation A, avec un second détenteur de
    l'action, reçoit `409 PLATFORM_SELF_DEALING` sur confirmation, octroi, dérogation, suspension et
    levée visant A ; seul détenteur → `200` marqué `soleOperator: true`.
14. **Ré-authentification** : sans ré-authentification de moins de dix minutes, toute écriture de la
    console → `401 REAUTH_REQUIRED`.
15. **Matrice plateforme** : `platform-actions.test.ts` épuise les 126 cases ; la sonde e2e vérifie une
    route par action et par rôle ; `platform_admin` → `403` sur la confirmation d'un paiement manuel ;
    `platform_billing` → `200` sur `GET /admin/overview`.
16. **Rôles** : attribuer un rôle sans motif → `400` ; `platform_support` sans échéance ou au-delà de
    90 jours → `400` ; s'attribuer un rôle → `409 SELF_GRANT_FORBIDDEN`.
17. **Octroi manuel** : `POST /admin/billing/grants` sans motif → `400` ; un octroi Expert par une
    personne, un autre détenteur existant → en attente d'une seconde personne ; l'abonnement porte un
    événement `plan.granted`, jamais un `payment.succeeded`.
18. **Fonctionnalités** : avec la grille par défaut, **aucune** route ne répond `FEATURE_NOT_IN_PLAN`
    (non-régression) ; une grille de test fermant `crm` à `free` → `403 FEATURE_NOT_IN_PLAN` sur
    `POST /crm/opportunities`, `200` sur `GET /crm/opportunities` (patrimoine lisible) ; une dérogation active
    rouvre l'écriture, expirée la referme.
19. **Annonce** : l'auteur ne peut pas approuver (`409 SELF_APPROVAL_FORBIDDEN`) quand un autre
    approbateur existe ; `send` sans le nombre exact → `409 AUDIENCE_COUNT_MISMATCH` ; l'annonce
    approuvée atteint exactement les comptes de la catégorie (Propriétaires d'organisations `pro` au
    Congo, jeu semé) et aucun autre ; aucun e-mail n'est émis (faux `MailService`).
20. **Statistiques** : aucune case de moins de 5 organisations n'est servie en clair.
21. **Finances** : avec un jeu semé (deux dépôts manuels confirmés, un rappel Stripe signé, un refusé),
    les encaissements du mois égalent la somme des confirmés, au centime ; aucun libellé ni clé de
    réponse ne contient « chiffre d'affaires », « facturé » ni « TVA » (test des libellés).
22. **Interface** : la coquille de console n'appelle aucune route d'organisation (modèle testé) ; un
    non-opérateur qui force `/admin` voit l'écran de refus sans qu'aucun appel `/admin/**` ne parte ;
    le menu d'organisation n'affiche « Console Lalanda » qu'aux opérateurs.

## Plan de validation

- **API unitaires** : `platform-actions.test.ts` (matrice), tables de vérité de
  `platformSelfDealingDecision`, `broadcastApprovalDecision`, `platformGrantDecision`, résolution des
  catégories de destinataires.
- **API e2e (Mongo en mémoire)** : `platform-isolation.e2e` (critères 1 à 3, 11, 12 ; les deux sens),
  `admin-minimization.e2e` (4, 6, 7), `account-blocking.e2e` (8), `org-suspension.e2e` (9),
  `manual-payments-console.e2e` (10, 13, 14, 17), `features.e2e` (18), `announcements.e2e` (19),
  `rbac-matrix.e2e` étendu (15, 16).
- **Moteur (vitest)** : `platform-revenue` (encaissements, revenu récurrent déclaré, propriétés à graine
  fixe).
- **Web (modèles purs)** : coquille de console, menu, onglets par action, libellés interdits.
- **Essai de la dirigeante** : elle ouvre la console sans changer d'organisation ; bloque un compte de
  test, constate qu'il ne peut plus se connecter, le débloque ; confirme un dépôt mobile money et
  retrouve l'événement « Équipe Lalanda » dans le journal de l'organisation cliente ; prépare une
  annonce aux Propriétaires en essai, la fait approuver (ou l'approuve seule, marquée) et la voit dans
  un compte de test ; lit les encaissements du mois.

## Questions pour le juriste (s'ajoutent à docs/28 § 1.3)

Rien de ce qui suit n'est tranché ; les valeurs par défaut sont techniques et prudentes, pas juridiques.

- **JA1 — Accès du personnel de Lalanda.** Base légale et information des utilisateurs pour la
  consultation par les opérateurs de Go freelance SARLU des métadonnées des comptes et organisations
  (adresse, nom, offre, usage) ; mention dans la politique de confidentialité ; engagement de
  confidentialité des opérateurs ; cas de Televerx LLC (rejoint le point 8 de docs/28 § 1.3).
- **JA2 — Blocage et suspension.** Obligation d'informer la personne bloquée ou l'organisation suspendue
  (motif, délai, forme), droit de contestation, préavis ; articulation avec les CGU et les CGV (délais
  de suspension non arbitrés, docs/28 § 3.2).
- **JA3 — Accès aux données pendant une suspension** : faut-il garantir la lecture ou l'export des
  données du client (portabilité) ? Conditionne la décision ouverte n° 4.
- **JA4 — Messages de masse.** Distinction entre message de service (incident, changement des
  conditions, sécurité) et prospection ; consentement, désinscription, mentions, en RDC et pour les
  utilisateurs établis dans l'Union européenne ; conditionne l'e-mail (décision ouverte n° 9).
- **JA5 — Conservation** du journal plateforme, des motifs de blocage et des notes internes, et des
  accusés de lecture des annonces.
- **JA6 — Statistiques agrégées** : le seuil de 5 suffit-il à les traiter comme anonymes, ou faut-il une
  autre méthode ?
- **JA7 — Demandes des autorités** : procédure et journalisation d'une demande légale d'accès aux données
  d'un client (catégorie de motif « demande légale »).

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, sous un commentaire `// ADR-0053 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Dépend de |
|---|---|---|---|---|
| **P0 — Socle RBAC plateforme et contrats** (petit, en premier) | `PLATFORM_ACTIONS`, matrice, `@RequirePlatformAction`, `PlatformAuthGuard`, fonctions de décision, schémas zod ; amendements docs/12, 15, 16, 17, 28 | `apps/api/src/authz/platform-actions.ts` (+ test, **nouveaux**), `authz/platform-auth.guard.ts` (nouveau), `authz/authz.decorators.ts` (**un bloc**), `authz/permissions.guard.ts` (**un bloc** : action plateforme), `authz/authz.module.ts` (une ligne) ; `packages/shared/src/platform/**` (nouveau), `packages/shared/package.json` (un export) ; docs | 1, 15, 16 (fonctions) | — |
| **P1 — Coquille de console** | déplacement `(app)/admin/**` → `(console)/admin/**`, layout propre, bandeau, onglets par action, entrée de menu « Console Lalanda » | `apps/web/src/app/(console)/**` (crée), suppression de `apps/web/src/app/(app)/admin/**`, `apps/web/src/app/(app)/_components/user-menu-model.ts` (+ test, entrée `admin` seulement), `apps/web/src/lib/api.ts` (`PlatformAccessView`, **un bloc**) | 22 | P0 |
| **P2 — Comptes, organisations, blocage et suspension effectifs, minimisation** | routes § 7 (organisations, comptes, rôles), motifs, lecture journalisée, recherche obligatoire, `disabledAt` lu à la connexion, suspension dans `PermissionsGuard`, ré-auth, miroir, `platformSelfDealingDecision` branché | `apps/api/src/admin/{admin.controller,admin.service,admin.dto,organization-suspension.schema,platform-access.controller}.ts`, `apps/api/src/admin/mirror.ts` (nouveau) ; `apps/api/src/auth/auth.guard.ts` (**un bloc**), `auth/auth.ts` (**un bloc** de crochet) ; `authz/permissions.guard.ts` (**un bloc** suspension) ; `admin.sources.test.ts` ; écrans console | 2 à 9, 13, 14, 16 | P0, P1 (écrans) |
| **P3 — Abonnements et paiements manuels** | `/admin/billing/**`, file manuelle, refus journalisé, rôle réel, octrois `platform_plan_grants`, événement `plan.granted`, alias N-1 | `apps/api/src/admin/billing/**` (nouveau) ; `apps/api/src/payments/payments.controller.ts` (ligne 275 et alias), `payments/payments.service.ts` (audit du refus, acteur pseudonyme) ; `billing/billing.service.ts` (**un bloc** : `plan.granted`) ; `billing/subscription-lifecycle.ts` (**un bloc**) ; écrans console | 10, 11, 13, 17 | P0, P2 (miroir) |
| **P4 — Fonctionnalités par offre** | `FEATURES`, `FeatureGuard`, `@RequireFeature` posé sur les contrôleurs **sans fermer aucune offre**, `GET /me/features`, dérogations, page console | `packages/shared/src/pricing/features.ts` (nouveau), `pricing/index.ts` (une ligne) ; `apps/api/src/billing/feature.guard.ts` (nouveau) ; `apps/api/src/admin/features/**` ; **une ligne de décorateur** par contrôleur concerné ; `apps/web/src/lib/api.ts` (**un bloc**) ; explication dans la barre de modules (**un bloc** de `nav-model.ts`) | 18 | P0 |
| **P5 — Journaux et sécurité** | filtres, export CSV journalisé, événements de sécurité agrégés | `apps/api/src/integrations/platform-audit.service.ts` (ajouts de méthodes), `apps/api/src/admin/audit/**` (nouveau) ; écrans console | 12 | P0, P2 |
| **P6 — Annonces** | collections, catégories, circuit à deux personnes, livraison in-app, bannière et cloche | `apps/api/src/admin/announcements/**` (nouveau), `apps/api/src/admin/announcements/me-announcements.controller.ts` (nouveau, routes `/me/announcements`) ; `packages/shared/src/notifications/index.ts` (**une ligne**) ; `apps/web/src/app/(app)/_components/app-shell.tsx` (**un bloc** bannière), `notifications-bell.tsx` (**un bloc**) ; écrans console | 19 | P0, P1 |
| **P7 — Statistiques et finances** | `packages/engine/src/platform-revenue/**`, `/admin/stats`, `/admin/finance`, exports, libellés interdits | `packages/engine/src/platform-revenue/**` (nouveau), `packages/engine/src/index.ts` (**une ligne**) ; `apps/api/src/admin/{stats,finance}/**` ; écrans console | 20, 21 | P0 ; P3 (octrois, pour les exclure des encaissements) |
| **P8 — Double authentification** (si décision n° 2 retenue) | greffon `twoFactor`, enrôlement, codes de secours, refus `PLATFORM_2FA_REQUIRED` | `apps/api/src/auth/auth.ts` (**un bloc**), `authz/platform-auth.guard.ts` (après P0), `apps/web/src/app/(app)/compte/securite/**` | (à écrire avec la décision) | P0, P2 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/auth.ts` | P2, P8 ; **zone sensible** (correctif récent du cookie d'organisation active) ; possible avec **ADR-0052** si la mise en route touche l'organisation active | un bloc chacun, revue de sécurité à part |
| `apps/api/src/authz/permissions.guard.ts` | P0 (action plateforme), P2 (suspension) | deux blocs distincts, P0 d'abord |
| `apps/api/src/authz/permissions.ts` | **aucun** lot de cet ADR | le catalogue plateforme vit dans `platform-actions.ts` pour **ne pas** entrer dans la zone de conflit des ADR qui ajoutent des actions d'organisation |
| `apps/api/src/authz/routes-coverage.test.ts`, `__tests__/rbac-matrix.e2e.test.ts` | P0 à P7 | un bloc par lot, **à la fin** |
| `apps/web/src/lib/api.ts` | P1, P4 ; **conflit avec tout ADR** qui ajoute des actions (`OrgAction`) | blocs distincts |
| `apps/web/src/app/(app)/_components/{user-menu-model,app-shell,notifications-bell,nav-model}.ts(x)` | P1, P4, P6 ; **possible avec ADR-0052** (entrée « Mise en route » du menu) | une entrée ou un bloc par lot ; aucun remaniement de la liste |
| `apps/web/src/app/(app)/organisation/_components/audit-panel.tsx` | P2 (rendu « Équipe Lalanda ») ; **possible avec ADR-0052** (`organisation/**`) | un bloc |
| `packages/shared/src/notifications/index.ts` | P6 ; zone partagée avec ADR-0050, ADR-0051 | une ligne |
| `apps/api/src/payments/**`, `apps/api/src/billing/**` | P3 (et P7 en lecture) ; **zone d'ADR-0047** si l'option A ou D est lancée | P3 n'écrit que les blocs listés ; ADR-0047 fusionne après |
| `apps/api/src/{projects,sales,treasury,hr,accounting,stock,documents,crm,work}/**` | **aucun**, sauf la ligne `@RequireFeature` de P4 | P4 n'ajoute qu'une ligne de décorateur par classe, revue à part |
| docs/12, 13, 15, 16, 17, 28, index des ADR | P0 (documentation) ; chaque lot passe sa ligne « proposé » à « implémenté » | une section par lot |

### Ordre de fusion conseillé

```
P0 ──┬── P1 ──┬── P2 ──┬── P3 ── P7
     │        │        ├── P5
     │        │        └── P8 (si décidé)
     ├── P4   └── P6
```

1. **P0**, puis **P1** (la séparation visible demandée par la dirigeante arrive dès le deuxième lot).
2. **P2** : ferme F2, F5, F6, F8, F9 et l'essentiel de F3.
3. **P3** (ferme F3 et F4), **P5**, **P6**, **P4** en parallèle.
4. **P7** après P3 ; **P8** dès la décision n° 2.

Chemin critique : P0 → P1 → P2 → P3 → P7.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, la plus prudente, appliquée si rien n'est tranché.

1. **Sous-domaine de la console.** *Défaut : même domaine, URL `/admin`, coquille séparée (O1-b) ; le
   sous-domaine sera un lot d'infrastructure ultérieur.*
2. **Double authentification des opérateurs.** *Défaut : pas de 2FA tant qu'elle n'est pas décidée ;
   ré-authentification de dix minutes avant toute écriture de la console et session de console de
   12 heures. Recommandation : TOTP obligatoire pour tout rôle plateforme (lot P8) avant toute
   ouverture de la console à une autre personne que la dirigeante.*
3. **Un opérateur peut-il être membre d'une organisation cliente ?** *Défaut : oui (la dirigeante
   utilise son compte), mais il n'agit jamais depuis la console sur une organisation dont il est
   membre, sauf seul détenteur, marqué (§ 2.6).*
4. **Effet de la suspension administrative.** *Défaut : lecture seule (`read_only`) ; le mode `full`
   reste proposé à l'opérateur pour les cas de fraude ; à revoir après JA3.*
5. **Information par e-mail lors d'un blocage ou d'une suspension.** *Défaut : aucun e-mail
   automatique ; message générique à la connexion et bannière dans l'organisation ; à revoir après
   JA2.*
6. **Transparence envers le client.** *Défaut : miroir pseudonyme « Équipe Lalanda » avec le motif
   destiné au client ; jamais l'identité de l'opérateur.*
7. **Rôles et matrice plateforme.** *Défaut : aucun rôle nouveau ; matrice du § 5.2, y compris le
   retrait de la confirmation des paiements à `platform_admin`.*
8. **Séparation des tâches plateforme.** *Défaut : deux personnes pour une annonce, pour un octroi de
   plus de 90 jours ou de l'offre Expert ; approbateur unique toléré et marqué.*
9. **Canal des annonces.** *Défaut : in-app seulement en v1 ; aucun e-mail de masse ; aucune
   prospection ; l'e-mail « de service » viendra après JA4.*
10. **Fonctionnalités par offre.** *Défaut : catalogue en code, grille entièrement ouverte, lecture seule
    dans la console ; dérogations par organisation permises avec motif et échéance de 90 jours au plus ;
    la répartition reste l'arbitrage de docs/13.*
11. **Journaux visibles dans la console.** *Défaut : journal plateforme et événements de sécurité
    agrégés ; ni journaux d'organisation, ni journaux techniques du serveur.*
12. **Accès délégué au contenu d'une organisation.** *Défaut : hors v1, refus (état actuel) ; un ADR
    dédié s'il devient nécessaire.*
13. **Seuil des statistiques.** *Défaut : aucune case de moins de 5 organisations ; à revoir après JA6.*
14. **Vocabulaire des finances.** *Défaut : « encaissements constatés » et « revenu récurrent
    déclaré », en USD, sans conversion ; aucun « chiffre d'affaires » tant qu'ADR-0047 n'est pas
    tranché.*
15. **Octroi manuel.** *Défaut : motif et message client obligatoires, échéance facultative, visible du
    client dans son journal et dans `/organisation/facturation`.*
16. **Conservation du journal plateforme.** *Défaut : aucune purge (ajout seul) jusqu'à la réponse
    JA5.*
17. **Accès à la console depuis l'espace organisation.** *Défaut : une entrée « Console Lalanda » dans
    un groupe séparé du menu, visible des seuls opérateurs ; elle ouvre la coquille de console.*
18. **Support : échéance des rôles.** *Défaut : `platform_support` attribué pour 90 jours au plus,
    renouvelable par un geste motivé.*

## Liens

- [ADR-0011](ADR-0011-contrats-integration-s18.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md)
  (précisé : § 4, § 5) ; [ADR-0013](ADR-0013-stockage-secrets-integration.md) (ré-authentification
  étendue) ; [ADR-0016](ADR-0016-navigation-applicative.md) et
  [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) (menu) ;
  [ADR-0017](ADR-0017-interrupteur-integrations.md) ; [ADR-0041](ADR-0041-autorisations-par-membre.md)
  (sans effet sur la plateforme) ; [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) ;
  [ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md) (finances, pièces) ; ADR-0052 (mise en route,
  parallèle).
- [docs/12](../12-ROLES-PERMISSIONS.md) ; [docs/13](../13-PRICING.md) ; [docs/15](../15-DATABASE.md) ;
  [docs/16](../16-API.md) ; [docs/17](../17-SECURITE.md) ; [docs/24](../24-INFRASTRUCTURE.md) ;
  [docs/28](../28-CONFORMITE-LEGALE.md).
- Code existant lu : `apps/api/src/admin/**`, `apps/api/src/authz/{permissions,permissions.guard,audit.controller,audit.service}.ts`,
  `apps/api/src/auth/auth.guard.ts`, `apps/api/src/integrations/{integrations.controller,platform-audit.service}.ts`,
  `apps/api/src/payments/{payments.controller,payments.service}.ts`,
  `apps/api/src/billing/{billing.controller,billing.service,entitlements}.ts`,
  `apps/api/src/organization-space/organization-space.controller.ts`,
  `apps/api/src/organizations/{organizations,members}.controller.ts`,
  `apps/api/src/accounting/chart/accounting-chart-packs.controller.ts`,
  `apps/web/src/app/(app)/{layout.tsx,admin/**,organisation/**,_components/user-menu-model.ts}`,
  `apps/web/src/lib/routes.ts`.
- Code à créer : `apps/web/src/app/(console)/`, `apps/api/src/authz/platform-actions.ts`,
  `apps/api/src/authz/platform-auth.guard.ts`, `apps/api/src/admin/{billing,features,audit,announcements,stats,finance}/`,
  `packages/shared/src/platform/`, `packages/shared/src/pricing/features.ts`,
  `packages/engine/src/platform-revenue/`.

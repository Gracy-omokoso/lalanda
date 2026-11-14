# ADR-0075 — Dépense directe reliée à la fiche fournisseur ; téléphones E.164 / E.123

Statut : **Accepted**
Date : 2026-11-13
Décideuse : Gracy Omokoso (décision de Gracy du 13 nov. 2026) ; CTO Lalanda (contrat technique).

> **Tranche** deux points laissés ouverts par
> [ADR-0074](ADR-0074-formulaires-modernes.md) : la décision ouverte n° 7 (fournisseur d'une
> dépense directe) et le « Reste » du point 1 de la section « Qualité » (téléphones dans les PDF).
> **Prolonge** [ADR-0044](ADR-0044-achats-et-fournisseurs.md) P2 (fiche fournisseur d'une écriture de
> la trésorerie, § 2.8, § 3.1) et [ADR-0071](ADR-0071-ecrans-achats-et-tresorerie.md). **Ne change
> aucun document déjà gelé** (ADR-0025 § 7, ADR-0028 § 6, ADR-0073), aucune règle DGI, comptable ou
> fiscale.

## Contexte

**A.** Le formulaire de dépense de la Trésorerie proposait un **nom libre** avec suggestions
(`<datalist>` sur `items` de `GET /treasury/suppliers`). ADR-0074 (décision ouverte n° 7) croyait
qu'il fallait « un changement d'API » ; en réalité l'API sait déjà relier une dépense à une fiche
depuis ADR-0044 P2 : `supplierId` facultatif sur `POST`/`PUT /treasury/expenses` (fiche de
l'organisation, sinon `404 EXPENSE_SUPPLIER_UNKNOWN` ; fusionnée `409 SUPPLIER_MERGED` ; archivée
`409 SUPPLIER_ARCHIVED`), copie du nom de la fiche dans `supplierName`, `null` pour un fournisseur
de passage, absent : rattachement par clé exacte (`legacyKeys`) ; `entries` de
`GET /treasury/suppliers` mêle fiches et noms libres ; la fiche fournisseur
(`GET /purchases/suppliers/:id/overview`, section `directExpenses`) liste déjà ses dépenses
directes. Seul l'écran ne s'en servait pas. Restaient deux défauts côté API : le nom affiché était
la **copie au moment de l'écriture** (une fiche renommée ou fusionnée laissait l'ancien nom), et
l'audit ne disait pas quelle fiche était rattachée.

**B.** Depuis v1.32.0 le web envoie les numéros en E.164 (`+243812345678`) et les affiche groupés
(`afficherTelephone`). L'API enregistrait le texte tel quel (`trim`), d'où deux formes pour un
même numéro, et les PDF imprimaient ce texte brut.

La dirigeante a décidé le 13 nov. 2026 : « Il faut relier la dépense à la fiche fournisseur » ;
téléphones : « fais le meilleur selon les standards ».

## Décision

### A. Dépense directe et fiche fournisseur

1. **Web** (`tresorerie/depenses`) : le fournisseur passe en `EntityPicker`
   (`ChoixFournisseurDepense`) sur `GET /treasury/suppliers?q=` (`entries`), droit
   `treasury.read`, celui de l'écran : fiches actives d'abord (« Fiche fournisseur »), puis noms
   libres déjà saisis (« Déjà saisi, sans fiche »), puis le texte tapé (« Fournisseur de passage
   (nom libre) »). Le **« + »** ouvre la fiche fournisseur complète (`NouveauFournisseur`, même
   fenêtre que l'écran Achats) **sous `purchase.manage`** seulement, droit de
   `POST /purchases/suppliers` ; la fiche créée est choisie d'office.
2. **Envoi** (`champsFournisseur`) : fiche → `supplierId` (l'API reprend le nom de la fiche) ;
   nom libre → `supplierName` **sans** `supplierId`, pour garder la règle d'ADR-0044 (rattachement
   par clé exacte d'une fiche fusionnée) ; champ vidé → `supplierName: null, supplierId: null`.
3. **Texte libre conservé** : un fournisseur occasionnel (achats informels, fréquents en RDC) reste
   un nom libre. Un nom identique à une fiche (casse et accents ignorés) n'est **pas** proposé en
   texte libre : c'est la fiche qui est proposée — **suggestion seulement**, rien n'est réécrit.
4. **API — nom affiché** : `GET /treasury/expenses` et `GET /treasury/expenses/:id` affichent, pour
   une dépense rattachée, le nom **courant** de la fiche (lu dans l'organisation ; fiche
   introuvable : copie stockée). La copie `supplierName` n'est **pas** réécrite : elle reste le nom
   au moment de l'écriture. Un client qui renvoie ce nom courant sans `supplierId` garde la fiche
   (`resolveSupplier`).
5. **API — audit** : `treasury.expense.recorded` et `treasury.expense.updated` portent
   `supplierId` (identifiant seulement, jamais de nom).
6. **Isolation et droits inchangés** : fiche d'une autre organisation → 404 (e2e existant et
   nouveau) ; aucune route ajoutée ni aucun droit modifié.
7. **Comptabilité inchangée.** Une dépense directe est payée comptant : son écriture (moteur,
   `entriesForExpense`) débite la charge et crédite le compte de trésorerie, **sans compte de
   tiers fournisseur** ; le tiers n'apparaît que comme libellé et `partyName`, lus de la copie
   stockée. La règle des achats (tiers fournisseur `401…`) vaut pour les **factures**
   fournisseurs, pas pour une dépense payée sur le champ : l'appliquer serait une règle comptable
   nouvelle. **Comportement actuel gardé**, noté ici ; une écriture déjà générée n'est pas touchée
   (le libellé suit la copie stockée, qui ne change pas à l'affichage).
8. **Anciennes dépenses** : valides et inchangées ; aucune migration.

### B. Téléphones

Standard : **stockage E.164 (UIT-T E.164), affichage et impression au format international UIT-T
E.123**. RDC : `+243 81 234 5678` (indicatif, puis groupes 2-3-4) ; autres pays : indicatif
découpé par la table des indicatifs à 1 et 2 chiffres de l'UIT (les autres en comptent 3), puis
groupes de trois, le dernier de quatre plutôt qu'un chiffre seul (`+1 555 010 0199`,
`+33 612 345 678`).

1. **Une seule fonction de chaque** dans `@lalanda/shared/phone` :
   - `normalizePhoneE164(valeur, { defaultCountryCode })` → E.164 ou `null` : séparateurs retirés,
     `00` = `+`, saisie nationale `0…` (et neuf chiffres pour la RDC) avec l'indicatif par défaut
     `+243`, `+243 0…` sans son `0`, contrôle E.164 (8 à 15 chiffres) et RDC exactement neuf
     chiffres ; d'accord avec `normalizeWhatsAppPhone` sur ce qu'elle accepte ;
   - `formatPhoneE123(valeur, options)` → E.123, ou la valeur telle quelle si elle n'est pas
     reconnaissable ;
   - `storedPhone(valeur)` : E.164 si reconnaissable, sinon la saisie (aide d'écriture).
2. **Web** : `afficherTelephone` (`@lalanda/ui`) délègue à `formatPhoneE123` avec
   `defaultCountryCode: null` (on ne devine pas le pays d'un ancien `0812…` à l'écran) ; ses tests
   passent inchangés. `@lalanda/ui` dépend désormais de `@lalanda/shared`. `PhoneInput`,
   `lireTelephone` et `ecrireTelephone` sont inchangés.
3. **API — écriture** : après la **même** règle d'acceptation qu'avant
   (`/^\+?[0-9][0-9 .-]{6,19}$/`), la valeur reconnaissable est enregistrée en E.164, sinon telle
   quelle. **Aucune validation durcie.** Routes : clients (`sales.dto.ts`), contacts du CRM
   (`crm.dto.ts`, import CSV compris), comptes du CRM (`@lalanda/shared/crm`), formulaire public
   (`lead-forms`), fiche collaborateur et import (`workPhone`), dossier sensible RH (contacts
   d'urgence…), fournisseurs (`@lalanda/shared/purchases`), fiche fiscale (`fiscal.dto.ts`),
   réglages des cartes (`phone`, texte libre : normalisé seulement s'il est reconnaissable).
   **Exclus à dessein** : numéros de **mobile money** (fournisseur et collaborateur) — ce sont des
   identifiants de compte chiffrés, dont l'empreinte de doublon (`supplier-payment-crypto`) compare
   les chiffres ; les changer ferait diverger un compte enregistré avant et après. WhatsApp
   garde sa propre normalisation (déjà E.164).
4. **API — impression** (E.123, valeur non reconnaissable imprimée telle quelle) :
   - **devis** et **bon de commande** : rendus de l'état courant (pas de contenu gelé) → toujours ;
   - **factures, avoirs, pro forma** : brouillon et aperçu de modèle → E.123 ; document **gelé** →
     E.123 **seulement s'il a figé `phoneFormat: 'e123'`**. Ce champ figé **facultatif** est posé
     par le gel à partir de ce jour et entre dans l'empreinte (`OPTIONAL_FROZEN_CONTENT_FIELDS`,
     même motif que `softwareVersion` et `presentation`) ; un document gelé avant ne l'a pas et
     **réimprime ses numéros tels qu'ils ont été figés** — re-télécharger une facture émise ou
     normalisée DGI rend le même contenu, même empreinte. Les données envoyées à la DGI
     (`client.contact`) restent la valeur stockée : seule l'impression est mise en forme. Le
     modèle pur (`buildInvoiceDocument`) ne met en forme **que** les documents qui portent ce
     champ ; pour un brouillon et un aperçu, le service le pose **en mémoire**
     (`withPrintedPhoneFormat`), rien n'est écrit. Les empreintes de rendu des modèles 1.0.0 et
     1.1.0 (`invoice-templates.test.ts`) restent donc identiques, octet pour octet ;
   - **attestations et certificats RH** : à la génération (une pièce produite est rangée et ne
     change plus ; « regénérer = nouvelle pièce », ADR-0072) ;
   - **cartes de service et de visite** : rendues de l'état courant → E.123 ; la vCard du QR porte
     l'E.164 (forme recommandée pour `TEL`).
5. **Pas de migration de masse** dans cette branche : les anciennes valeurs restent telles
   quelles ; elles s'affichent et s'impriment en E.123 dès qu'elles sont reconnaissables.

## Conséquences

- Un même numéro n'a plus qu'une forme en base pour toute nouvelle écriture ; les liens `tel:`,
  vCards et WhatsApp reçoivent l'E.164.
- Une saisie nationale est lue comme congolaise (`+243`), comme `PhoneInput` et WhatsApp : un
  numéro étranger doit être saisi avec son indicatif (`+33…`, `00 33…`).
- Une valeur renvoyée par l'API peut différer de la saisie (`+243 81 234 5678` →
  `+243812345678`) : les écrans l'affichent groupée.
- Les factures gelées à partir de ce jour portent `phoneFormat` ; leur empreinte l'inclut.

## Reste ouvert (suites à décider)

- **Normalisation des données existantes** : un script idempotent (par organisation, champ par
  champ, `normalizePhoneE164` ou valeur inchangée, journal du nombre modifié) est possible sur
  `customers.phone`, `crm_accounts.phone`, `crm_contacts.phone`, `suppliers.phone` et contacts,
  `fiscal_profiles.phone`, `hr_employees.workPhone`, réglages des cartes ; **jamais** sur le
  contenu gelé des factures (`sales_invoices.customer`, `seller`), ni sur les champs chiffrés
  (dossier RH, mobile money) sans passer par leurs services. Non écrit ni lancé : à décider.
- **Règles de dépenses récurrentes** : leur formulaire n'a pas de champ fournisseur (l'API accepte
  déjà `supplierId`) ; à ajouter avec le même sélecteur si souhaité.
- **Fiche fournisseur** : la section « Dépenses directes » montre les plus récentes (vue
  d'ensemble d'ADR-0044) ; un filtre `supplierId` sur la liste des dépenses permettrait « tout
  voir » depuis la fiche.
- Un indicatif par défaut propre à l'organisation (pays de la fiche fiscale) si Lalanda sert un
  jour d'autres pays.

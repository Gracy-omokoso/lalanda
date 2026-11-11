# ADR-0074 — Formulaires modernes : composants, largeurs, comportements

Statut : **Accepted**
Date : 2026-11-11
Décideuse : Gracy Omokoso (demande du 11 nov. 2026) ; CTO Lalanda (contrat technique).

> **Prolonge** [ADR-0030](ADR-0030-refonte-ui-ux.md) (design system, `packages/ui`) et
> [ADR-0055](ADR-0055-themes-et-design-professionnel.md) (densité, hauteurs de contrôle, mouvement). **Ne
> change** ni l'API, ni les contrats, ni les validations : seule l'interface change. **Respecte**
> [ADR-0025](ADR-0025-documents-pdf-factures.md) (l'UI formate, le moteur calcule) et
> [ADR-0053](ADR-0053-administration-plateforme.md) (double authentification de la console).

## Contexte

La dirigeante a demandé le 11 nov. 2026 :

> « améliorer les formulaires avec un comportement plus moderne ex 2FA tu n'étales pas deux champs
> mot de passe et A2F ; les boutons radios, cases à cocher, calendrier sont un peu archaïques ;
> certains champs sont trop longs inutilement […]. Si une donnée existe déjà, exemple client, il
> faut juste cliquer genre parcourir pour la sélectionner. […] taper dans le champ pour la
> sélectionner ; au cas où elle n'existe pas, un bouton plus (+) suffit pour ajouter un nouveau
> dans un formulaire popup modal. Fixer par exemple la position/padding du chevron des listes
> déroulantes […]. En plus de ce que je n'ai pas dit, propose le meilleur. »

État constaté : `packages/ui` n'avait **aucun** composant de formulaire. Environ 140 fichiers de
`apps/web/src` posaient des `<select>`, radios, cases et dates natifs, chacun avec ses classes
(`CHAMP` de `ventes/_components/form-ui.tsx`, copies locales ailleurs) ; presque tous les champs
prenaient toute la largeur de leur colonne (une quantité aussi large qu'une adresse) ; le chevron
du `<select>` natif était collé au texte ; la console demandait mot de passe et code côte à côte ;
le choix d'un client dans une facture passait par un champ « Rechercher » PLUS une liste
déroulante, sans moyen de créer le client sans quitter le document.

## Décision

### 1. Un système de formulaires dans `@lalanda/ui`, sans dépendance

Tout est écrit dans le dépôt (`packages/ui/src/forms/`), exporté par `@lalanda/ui`, testé
(`packages/ui/src/forms.test.ts`). **Aucune dépendance ajoutée** : Radix, cmdk, react-day-picker
ou date-fns auraient apporté du poids, des mises à jour de sécurité et un style à défaire ; le
besoin (une douzaine de composants WAI-ARIA connus) tient dans environ 2 000 lignes que l'équipe
maîtrise. Seules `lucide-react` (déjà présente) et React sont utilisées.

| Composant | Remplace | Modèle WAI-ARIA |
|---|---|---|
| `Field`, `FormGrid`, `FormSection` | `Champ`, grilles `sm:grid-cols-2` | libellé `for`, `aria-describedby`, `aria-invalid`, `aria-required` |
| `TextInput`, `TextArea`, `PasswordInput` | `<input>` + `CHAMP` | — ; mot de passe : bouton `aria-pressed` « Afficher » |
| `Select` | `<select>` | combobox « select-only » + `listbox` |
| `EntityPicker` | champ « Rechercher » + `<select>` | combobox éditable (`aria-autocomplete="list"`) + `dialog` de création |
| `OtpInput` | champ code libre | `group` de six champs |
| `DatePicker`, `DateRangePicker` | `type="date"` | `dialog` non modal + `grid` |
| `SegmentedControl` | radios de 2 à 5 options courtes | `radiogroup` |
| `ChoiceCards` | radios avec explication | `radiogroup` |
| `Switch` | case « activer… » | `switch` |
| `Checkbox` | case native nue | case native stylée (listes à cocher, accords) |
| `MoneyInput`, `PhoneInput` | `<input>` | — |
| `Form`, `SubmitButton`, `StickyActions`, `ErrorSummary`, `useBlurValidation`, `useUnsavedChangesWarning` | code répété par écran | `role="alert"`, `aria-busy`, `aria-live` |

### 2. Largeurs sémantiques et grille de 12 colonnes

Un champ prend **la largeur de la donnée**, jamais la place libre (`Field size`) :

| Taille | Données | Colonnes (≥ 32 rem / ≥ 48 rem de formulaire) |
|---|---|---|
| `xs` | code postal, quantité, pourcentage, nombre de jours | 3 / 2 |
| `sm` | date, montant, matricule, NIF, devise, mode de prix | 4 / 3 |
| `md` | nom, prénom, e-mail, téléphone, liste courte | 6 / 4 |
| `lg` | client, intitulé, raison sociale, point de vente | 8 / 6 |
| `full` | adresse, notes, description, choix en cartes | 12 / 12 |

La grille (`FormGrid`) se règle sur la **largeur du formulaire** (requête de conteneur
`@container`, Tailwind 4), pas sur celle de l'écran : un formulaire dans une fenêtre modale
étroite se replie comme sur un téléphone. Moins de 32 rem : **une colonne**. `newRow` force un
retour à la ligne pour garder les groupes lisibles.

### 3. Liste de choix (`Select`)

- Chevron dans **son propre espace** : 40 px réservés à droite, chevron de 16 px à **12 px du
  bord**, donc au moins 12 px entre le texte et le chevron ; il pivote à l'ouverture.
- Liste ouverte **6 px sous le champ** (`ECART_POPOVER`), en position `fixed` calculée : jamais
  rognée par une zone qui défile ; ouverte au-dessus quand la place manque en bas.
- **Recherche dès 8 options** (`SEUIL_RECHERCHE_SELECT`), sans accents ni casse, correspondance
  surlignée ; groupes (`role="group"`), options désactivées, description sous le libellé, états
  « Chargement… » et « Aucun résultat ».
- Clavier : flèches, Début/Fin, Page préc./suiv., saisie de lettres (liste sans recherche), Entrée,
  Échap (qui **ne ferme pas** la fenêtre modale autour), Tab.
- Téléphone (< 640 px) : **feuille basse** pleine largeur, voile, options de 44 px, texte 16 px.

### 4. Sélecteur d'entité (`EntityPicker`) et création rapide

Pour toute donnée **susceptible d'exister** (client, article, service, manager, fournisseur…) :

- on **tape** ; la recherche part après 250 ms (anti-rebond, la précédente est abandonnée) ;
  correspondance surlignée ; **sous-texte** (type DGI et NIF d'un client, service parent,
  matricule) ;
- **récents** : les choix de la session en tête de liste quand le champ est vide. Ils restent **en
  mémoire** — jamais dans `localStorage` : des noms et NIF de clients n'ont rien à faire sur le
  disque d'un poste partagé ;
- si rien ne convient : le bouton **+** à droite du champ, ou la dernière option **« Créer « texte
  tapé » »**, ouvre une **fenêtre modale de création rapide pré-remplie** avec le texte tapé ;
  l'élément enregistré est **choisi d'office**, la fenêtre se ferme, le formulaire principal garde
  toute sa saisie. La fenêtre est rendue hors du formulaire principal (portail, jamais de `<form>`
  imbriqué) ; ses événements ne remontent pas jusqu'à lui (soumission, Échap, détection de saisie) ;
- le **+** n'existe que si le rôle peut créer (`sales.manage` pour un client, `hr.manage` pour un
  service) ; l'API reste juge ;
- générique : `search(q, signal)`, `getKey`, `getLabel`, `getDescription`, `renderItem`,
  `createForm({ initialText, onCreated, onCancel })`.

Le formulaire de création est **le formulaire complet existant** (`CustomerForm` en mode fenêtre,
`FormulaireService`) : mêmes validations, mêmes champs, même route. Aucun « mini-formulaire » qui
créerait des fiches incomplètes.

### 5. Code à usage unique (`OtpInput`)

Six cases, avance automatique, **collage du code entier** (depuis n'importe quelle case),
remplissage automatique iOS/Android (`autocomplete="one-time-code"` sur la première case,
`inputmode="numeric"`), Retour arrière qui vide puis recule, flèches gauche/droite, séparation 3 +
3 ; **envoi automatique à la sixième case** (`onComplete`).

### 6. Dates (`DatePicker`, `DateRangePicker`)

- Saisie au clavier **JJ/MM/AAAA tolérante** : `11/11/2026`, `11-11-26`, `11.11.2026`,
  `11112026`, `111126`, `11/11` (année en cours), ISO. Lue à la **sortie du champ** ; une date qui
  n'existe pas (31/02) ou hors bornes est **signalée**, jamais corrigée en silence.
- Calendrier en français, **lundi premier**, aujourd'hui entouré, jours hors du mois atténués ;
  clavier WAI-ARIA (flèches, Début/Fin de semaine, Page préc./suiv. = mois, Maj+Page = année,
  Échap) ; **titre cliquable** : vue des douze mois et changement d'année rapide.
- **Raccourcis** choisis par l'écran : Aujourd'hui, Fin de mois, +7 j, +30 j, Fin d'année (devis :
  +30 j et fin de mois ; fins d'essai et de contrat : aujourd'hui, fin de mois, +30 j).
- Bornes `min`/`max` (fin de contrat ≥ date d'entrée).
- **Jours fériés** : le composant accepte des jours marqués (`marks`) mais **n'en invente aucun**.
  La seule source du dépôt est la liste **saisie par l'organisation** (`GET /hr/holidays`,
  ADR-0045 § 2.6) ; le moteur ne porte aucune règle légale de férié. Le branchement se fait en
  phase 2, écran par écran (absences, planning), sous la permission RH.
- Plage : deux saisies « Du / Au » et un seul calendrier (premier clic = début, second = fin, dans
  l'ordre que l'on veut).
- Valeur : chaîne ISO `AAAA-MM-JJ` — la même que celle des `type="date"` remplacés.

### 7. Choix : segments, cartes, interrupteur, case

- `SegmentedControl` pour 2 à 5 options **courtes** (TTC/HT, CDF/USD, client enregistré / vente
  de comptoir) ; le sens de l'option choisie est écrit dessous (aide).
- `ChoiceCards` quand chaque option demande une phrase (type de client DGI).
- `Switch` pour un réglage qui prend effet tel quel (« Inviter sur Lalanda », contre-valeur USD).
- `Checkbox` stylée, gardée pour les **listes à cocher** et les **accords** (« J'ai mis ces codes en
  lieu sûr », coordonnées imprimées à la demande du client).
- Radios : un seul arrêt de tabulation, les flèches déplacent **et** choisissent (natif).

### 8. Montants et téléphones

- `MoneyInput` : séparateurs français à la saisie (`1 234 567,50`, espace fine insécable), devise
  affichée dans le champ, curseur conservé ; la valeur transmise est une **chaîne décimale**
  (`1234567.50`). Le module `money.ts` ne fait **que du texte** : ni `Number`, ni `parseFloat`,
  ni `Math`, ni arrondi — un test de source le garantit, comme les gardes d'ADR-0025.
- `PhoneInput` : indicatif choisi à part (**+243 par défaut**), numéro national groupé
  (`81 234 5678`), `0812…` et `00243…` relus ; valeur envoyée lisible `+243 81 234 5678`
  (16 caractères), conforme aux motifs de l'API (`/^\+?[0-9][0-9 .-]{6,19}$/`, ventes, CRM, RH,
  achats). Aucune validation de plus côté écran : l'API juge.

### 9. Comportements de formulaire

- **Validation à la sortie du champ**, jamais à chaque frappe (`useBlurValidation`) ; l'erreur
  disparaît dès que la valeur est corrigée ; **mêmes règles** que celles appliquées à l'envoi (les
  fonctions de validation existantes, inchangées).
- À la soumission : **résumé d'erreurs** en tête (`ErrorSummary`, `role="alert"`, focalisé),
  chaque ligne est un lien qui amène au champ.
- **Cmd/Ctrl+Entrée** enregistre (`Form`, ou le gestionnaire de l'éditeur de facture).
- **Focus automatique du premier champ** d'un formulaire de création (pas en modification : on ne
  vole pas le focus d'une fiche qu'on consulte).
- **Avertissement de modifications non enregistrées** avant de quitter ou recharger la page
  (`beforeunload`) ; les fenêtres modales gardent leur propre confirmation (ADR-0030).
- **Bouton de soumission** avec état de chargement (`aria-busy`, indicateur, libellé
  « Enregistrement… »).
- **Barre d'actions collante** en bas des longs formulaires (facture, fiche collaborateur), avec
  l'état (« Modifications non enregistrées… ») ; boutons pleine largeur et 44 px sur téléphone.

### 10. Connexion à la console en deux temps

Écran 1 : **mot de passe**. Écran 2 : **code** à six chiffres (`OtpInput`, envoi à la sixième
case), ou **code de secours** sur demande (« Utiliser un code de secours »). Le code n'est plus
posé à côté du mot de passe. Concerne la vérification de session de la console, la fenêtre de
ré-authentification de dix minutes (`ReauthGate`) et l'enrôlement (QR, puis mot de passe, puis
code).

**Sécurité inchangée, API inchangée.** L'écran 1 n'appelle **rien** : il ne fait que passer à
l'écran 2. Mot de passe et second facteur partent **ensemble**, dans la **même requête qu'avant**
(`POST /admin/reauth` ; `POST /admin/two-factor/enrollment/confirm`). Un « pré-contrôle » du mot de
passe aurait demandé une nouvelle route et ouvert un oracle de mot de passe sans second facteur :
écarté. Après un refus, l'écran revient à l'étape fautive (`etapeApresErreur` : mot de passe faux
ou connexion Google à refaire → écran 1 ; code faux, verrou, panne → écran 2, code vidé). Les deux
valeurs sont vidées après succès. Verrou, compteur d'essais et durée de la fenêtre restent ceux de
l'API.

La **connexion des membres** (`/login`) n'a pas de second facteur côté API : elle reste en un
écran (e-mail, mot de passe avec bouton « Afficher », bouton d'envoi avec état). Rien n'est ajouté
ni retiré à `signIn.email`.

### 11. Accessibilité et thèmes

Libellés liés, `aria-describedby` vers l'aide et l'erreur, `aria-invalid`, `aria-required` et
« (obligatoire) » lu ; clavier complet pour chaque composant ; focus visible hérité de
`globals.css` ; couleur jamais seule (états écrits) ; cibles ≥ 44 px et texte 16 px sur
téléphone (pas de zoom iOS) ; `prefers-reduced-motion` respecté (règle globale). Couleurs par
**jetons** uniquement (`--surface`, `--border-strong`, `--accent`, `--accent-soft`, `--danger`…) :
clair et sombre sans code dédié, dans les trois thèmes.

## Phase 1 — livré

- Composants et tests : `packages/ui/src/forms/*`, `packages/ui/src/forms.test.ts`.
- Écrans migrés, **mêmes champs envoyés, mêmes validations, même comportement métier** :
  - connexion (`(auth)/login`) ;
  - console : vérification de session et enrôlement (`deux-facteurs.tsx`), fenêtre de
    ré-authentification (`reauth-gate.tsx`), via `confirmation-deux-temps.tsx` ;
  - facture / avoir (`invoice-editor.tsx`) et devis (`quote-editor.tsx`) : client en
    `EntityPicker` avec création rapide (`ventes/_components/client-picker.tsx`), type en
    `Select`, devise et mode de prix en segments, point de vente en `Select`, validité du devis en
    `DatePicker`, contre-valeur USD en interrupteur, barre d'actions collante ;
  - fiche client (`customer-form.tsx`) : type DGI en cartes, grille sémantique, téléphone,
    validation à la sortie, résumé d'erreurs ; sert aussi de fenêtre de création rapide ;
  - fiche collaborateur (`fiche-formulaire.tsx`) : service en `EntityPicker` avec **+**
    (`FormulaireService` exporté), manager en `EntityPicker`, poste du référentiel et type de
    contrat en `Select`, trois `DatePicker` bornés, téléphone, invitation en interrupteur.
- Les **lignes d'articles** de la facture (`invoice-lines.tsx`, 500 lignes, conversions de devise
  et taxes spécifiques) restent en phase 2 : leur choix d'article passera par `EntityPicker` sans
  création rapide d'abord (un article exige groupe DGI, type et prix — la fiche complète, pas une
  ligne).

## Phase 2 — écrans restants (relevé du 11 nov. 2026, `<select>`, radios, cases ou dates natifs)

- **Ventes** : lignes de facture (`invoice-lines`), paiements (`payments-editor`), avoir
  (`credit-note-dialog`), normalisation (`normalize-dialog`), listes (factures, devis, commandes,
  contrats, clients, catalogue), fiche article (`catalog-item-form`), commandes (`order-form`,
  `order-detail`), contrats (`contract-detail`, `contract-settings`, `amendments-section`,
  `clauses-fields`), engagement et signature (`engagement-document-fields`, `engagement-ui`,
  `signature-form`, `quote-engagement-box`), encaissements (`receipts-workspace`), pont vers le
  réalisé (`bridge-panel`), modèles (`invoice-template-gallery`, `custom-template-packages`).
- **RH** : absences (`demande-absence`, `calendrier-absences`), planning, présences, frais et
  avances (`note-frais`, `avance`), évaluations, objectifs, équipes, postes, services, dossier
  (`fiche-parcours`, `fiche-poste`, `fiche-documents`, `fiche-cartes`, `formulaire-sensible`),
  documents générés et leurs réglages, cartes, échéances, import, rapports, réglages
  (`reglages-rh`, `reglages-listes`, `lot1-reglages`), espace salarié (`mon-espace`), liste.
- **Projets** : tâches (`panneau-tache`, `barre-taches`, `tache-collab`, `mes-taches`, kanban,
  calendrier), feuilles de temps, membres, réglages, import, construction par l'IA, proposition de
  facture, canal Slack, liste.
- **Organisation** : fiche fiscale, point de vente, identité visuelle, membres, rôles et
  permissions, réglages, journal d'audit, export du journal, mise en route, brief du matin.
- **CRM** : compte, opportunité, activités, tableau, réglages, formulaire public, motif de perte,
  rapports.
- **Achats** : commande, facture, fournisseur, paiement, réception (fournisseur en
  `EntityPicker` avec création rapide).
- **Stocks** : article, bon, emplacements, inventaires, mouvements, réglages.
- **Équipements** : fiche, dialogues, suivi, registre, réglages.
- **Comptabilité** : activation, écritures, exports, livres, règles.
- **Trésorerie** : pages Dépenses, Comptes, sélection de projet.
- **Initiatives et croissance** : éditeur de business plan, réalisé, démarrage, indicateurs,
  parcours ; **idées** : fiche et validation.
- **Documents** : bibliothèque, dépôt, fiche, dossier.
- **Console** : abonnements, annonces, motif (`champs-motif`), fonctionnalités, organisations,
  journal, utilisateurs.
- **Compte et transverses** : préférences, profil, sécurité, notifications, choix d'organisation,
  acceptation des conditions, inscription (`register`), souscription, formulaire public
  (`/f/…`), et **`components/choix-entite.tsx`** (ADR-0046) à reconstruire sur `EntityPicker` en
  gardant ses chargeurs par permission.

Ordre proposé : Achats (fournisseur + création rapide), lignes de facture, RH absences (avec
fériés de l'organisation), Projets, puis le reste par module. Chaque lot : mêmes champs, mêmes
validations, captures clair/sombre/mobile.

## Avancement de la migration

### Phase 2a — livré (branche `feat/formulaires-phase2a`)

Mêmes champs envoyés, mêmes validations (fonctions `preparer*` et lecteurs de montants
inchangés), même comportement métier ; seule l'interface change. Aucun fichier de `apps/api`
modifié ; `form-ui.tsx` reste en place.

- **Transverse** : `components/choix-entite.tsx` (ADR-0046) reconstruit sur `EntityPicker`, API
  publique et chargeurs par permission inchangés (documents, équipements continuent de
  l'utiliser tels quels) ; `tresorerie/_components/work-project-select.tsx` sur `Field` +
  `Select`.
- **Achats** : fiche fournisseur (`fournisseur-formulaire.tsx`, sert aussi de création rapide :
  `nomInitial`, `enModal`) ; demande d'achat (`commande-formulaire.tsx`) et facture fournisseur
  (`facture-formulaire.tsx`) avec le **fournisseur en `EntityPicker` et « + »** (fiche complète en
  fenêtre, sous `purchase.manage`, le droit de la route de création) ; paiement
  (`paiement-formulaire.tsx`) ; réception (`reception-formulaire.tsx`). `ChoixFournisseur` garde
  son API : la fiche article de stock et la fiche équipement en profitent sans changement.
- **Ventes** : lignes de facture, devis et engagements (`invoice-lines.tsx`) avec l'**article en
  `EntityPicker`** sur le catalogue (même recherche) et **création rapide** par la fiche article
  complète (`CatalogItemForm` en fenêtre, sous `sales.manage`) — la décision ouverte n° 2 est
  donc prise dans le sens « fiche complète en fenêtre », à confirmer par la dirigeante ;
  paiements (`payments-editor.tsx`, **avertissement d'hydratation corrigé** : les identifiants
  venaient de `nouvelleCle`, compteur de module différent entre serveur et navigateur ; ils
  viennent maintenant de `useId` et de la position, de même pour les lignes et l'échéancier
  des contrats) ; avoir (`credit-note-dialog.tsx`) ; normalisation (`normalize-dialog.tsx`, taux
  en cartes, date du taux) ; fiche article (`catalog-item-form.tsx`) ; commandes (`order-form`,
  `order-detail`, `order-list`) ; contrats (`contract-detail`, `contract-settings`,
  `amendments-section`, `clauses-fields`, `signature-form`, `contract-list`) ; engagement
  (`engagement-document-fields`, `engagement-ui` — client en `EntityPicker` avec « + » —,
  `quote-engagement-box`) ; encaissements (`receipts-workspace`, `bridge-panel`) ; filtres des
  listes (factures, devis, commandes, contrats, clients, catalogue).
- **Trésorerie** : dépenses et règles récurrentes, comptes et mouvements, réalisé.

### Phase 2b — livré (branche `feat/formulaires-phase2b`)

Mêmes règles qu'en 2a : mêmes champs envoyés, fonctions `preparer*`/`valider*` et lecteurs de
montants inchangés, aucun fichier de `apps/api` modifié, `form-ui.tsx` en place. Quand un
`required` natif disparaît (liste, date, sélecteur d'entité), un contrôle équivalent est fait
avant l'envoi.

- **Ventes** : modèles de facture (`invoice-template-gallery`, `custom-template-packages` :
  palette en segments, police en `Select` ; nuancier et dépôt `.zip` restent natifs),
  `contract-form` (intitulé ; client, lignes et clauses déjà migrés en 2a),
  `declare-not-normalized-dialog` (motif relié à son aide, son compteur et son erreur).
- **Achats** : `fournisseurs-liste` (filtre en grille, « Archivés » en interrupteur),
  `commande-fiche` (décisions), `dialogue-motif`. Il ne reste dans les achats que les champs
  fichier, natifs par choix.
- **RH** (tout `rh/`) : absences (`demande-absence`, `calendrier-absences`), présences,
  planning, échéances, mon espace, frais et avances (`MoneyInput`, `lireMontantSaisi`
  inchangé), objectifs, évaluations, équipes, services, postes, liste des collaborateurs,
  rapports, documents générés et leurs réglages, cartes, dossier (`fiche-parcours`,
  `fiche-poste`, `fiche-documents`, `fiche-cartes`, `fiche-compte`, `formulaire-sensible`),
  réglages (`reglages-rh`, `reglages-listes`, `lot1-reglages`), import, briques communes
  (`rh-ui`). Personne d'un créneau ou d'une lecture de présences, responsable et service parent
  d'un service, responsable et membres d'une équipe, service d'un poste : `EntityPicker` sur la
  liste déjà chargée. **« + »** seulement pour le service d'un poste (fiche `FormulaireService`
  complète, sous `hr.manage`, droit de `POST /hr/departments`) ; aucun « + » collaborateur (la
  fiche complète n'a pas sa place dans un créneau) ni utilisateur (il s'invite depuis
  l'organisation). **Les fériés ne sont pas ajoutés aux calendriers** : décision ouverte n° 1
  toujours ouverte (le calendrier des absences affiche, comme avant, ceux que l'API renvoie).
- **Projets** (tout `projets/`) : tâche (`panneau-tache` : responsable et dépendance en
  `EntityPicker`, dates, statut, priorité, jalon), collaboration et saisie du temps, filtres,
  kanban, calendrier, liste, mes tâches, nouveau projet (client en `EntityPicker` avec « + »
  sous `sales.manage`, fiche client complète en fenêtre), réglages et paramètres, membres
  (visibilité en cartes), Slack, WhatsApp (`PhoneInput`, `OtpInput` sans envoi automatique),
  feuille de temps, import, construction par l'IA, proposition de facture. Aucune logique
  d'appel externe touchée.
- Restés natifs à dessein : champs fichier, couleur, heures (`type="time"`), mois (décision
  ouverte n° 6), éditions sur place très compactes (titre de tâche dans sa cellule, ajout en
  ligne).

Points à surveiller : un téléphone **modifié** part au format `+243 81 234 5678` (dossier
sensible, WhatsApp) — conforme aux motifs de l'API, déjà le cas de la fiche collaborateur ; le
nouveau projet cherche les clients à la frappe (50 au plus) au lieu de les lire d'avance.

### Phase 2c — livré (branche `feat/formulaires-phase2c`)

Mêmes règles qu'en 2a et 2b : mêmes champs envoyés, aucun `*-model.ts`, aucune fonction
`preparer*`/`valider*` ni aucun lecteur de montant modifiés, aucun fichier de `apps/api` touché,
`form-ui.tsx` en place. Un commit par lot.

- **Organisation** : fiche fiscale en sections (forme juridique en `Select`, TVA en `Switch`,
  téléphone en `PhoneInput`), réglages, point de vente (environnement en segments, jeton
  toujours masqué), identité visuelle, export du journal (Du / Au bornés l'un par l'autre),
  journal d'audit, membres (rôle en `Select`, droit de clôture en `Switch`, nouveau
  propriétaire en `EntityPicker` sans « + » — un membre s'invite —, grille des permissions en
  `Checkbox`), brief du matin, mise en route, fenêtre de ré-authentification (même requête).
- **CRM** : `ChoixCompte` et `ChoixMembre` (`crm-ui`) sur `EntityPicker`, même API ; **« + »
  « Créer un prospect »** sur le choix du compte (contact, nouvelle opportunité, fiche
  opportunité) par la fiche complète `NouveauProspect`, sous `crm.manage`, droit de
  `POST /crm/accounts` ; opportunité (montant en `MoneyInput`, devise et source en segments,
  clôture en `DatePicker`, lignes à identifiants stables), compte (conversion : type DGI en
  cartes, fiche client en `EntityPicker` ; fusion ; modification), contacts, réglages, réglages
  du formulaire public, motif de perte, activités, rapports.
- **Stocks** : `ChoixArticle` en `EntityPicker` avec **« + »** par la fiche article complète
  (`ArticleFormulaire`, `nomInitial`), sous `stock.manage`, droit de `POST /stock/items`, là
  seulement où l'appelant le demande (lignes de bon, « À traiter ») ; `ChoixEmplacement` en
  `Select` ; fiche article, bon, emplacements, inventaires (portée en cartes, compteurs jamais
  cochés d'office), mouvements, réglages, niveaux, motif.
- **Équipements** : fiche (sections Acquisition et Amortissement indicatif), affectation,
  retour, cession (confirmation jamais cochée d'office), réintégration, maintenance et
  couverture (document en `EntityPicker` sans « + »), registre, réglages.
- **Comptabilité** : activation (plan en cartes, monnaie en segments, date de bascule),
  écritures, exports, livres, états, règles (relecture jamais cochée d'office), clôtures.
- **Initiatives et croissance, Idées** : nouvelle initiative, assistant, démarrage
  personnalisé, réalisé, éditeur de business plan, objectifs, indicateurs, parcours ; fiche
  d'idée (initiative en `EntityPicker` sur la liste chargée) et validation (note en segments).
  Aucune logique d'appel à l'IA touchée.
- **Documents** : dossier (parent en `EntityPicker`, accès en cartes), dépôt et fiche
  (`ChoixEntite` repris tel quel, « Document sensible » jamais coché d'office), bibliothèque.
- **Console** : motif d'un geste (`champs-motif`), abonnements, factures des abonnements,
  dérogations, annonces, organisations (effet de suspension en segments), comptes, journal
  plateforme, intégrations (secrets toujours masqués). Mêmes requêtes ; ré-authentification
  et deux facteurs de la phase 1 inchangés.
- **Compte et transverses** : inscription (case des conditions **jamais cochée d'office**,
  `required` et contrôle de `handleSubmit` gardés, validation native conservée par
  `noValidate={false}`, même `termsVersion`), mot de passe oublié, nouveau mot de passe,
  préférences (thème et mode en cartes, devise en `Select`), profil, sécurité, souscription
  (offre en cartes, périodicité en segments, fiche de facturation), préférences de
  notifications, acceptation des conditions, nouvelle organisation, **formulaire public**
  `/f/…` (champ piège, ticket, limites et consentement non coché inchangés ; téléphone saisi
  tel quel).

Contrôles à l'envoi ajoutés : CRM, « Choisissez la fiche client à rattacher. » (l'envoi
s'arrêtait sans rien dire) ; Équipements, « La date de retour est obligatoire. ».

Restés natifs à dessein : champs fichier, nuancier, curseur d'intensité du motif, champs
« mois » (finances de la console, comptabilité), cellules du réalisé et cartes du Canvas
(éditions sur place), recherche de l'aide publique, recherche compacte du tableau de bord,
zone de saisie de Lala (messagerie).

Points à surveiller : un téléphone **modifié** part au format `+243 81 234 5678` (fiche
fiscale, comptes et contacts du CRM), conforme aux motifs de l'API ; le choix d'un compte du
CRM cherche à la frappe au lieu de lire la liste d'avance ; `stocks-ui` et
`article-formulaire` s'importent l'un l'autre (rendu seulement) ; un interrupteur (droit de
clôture, brief du matin) agit au clic, comme la case d'avant.

### Reste à faire

- **Écrans encore sur `Champ`/`CHAMP`** : envoi d'un document par e-mail
  (`ventes/_components/apercu-document.tsx`, hors relevé de la phase 2), titre de tâche
  (`panneau-tache.tsx`, `aria`), réexport de `projets/_components/elements.tsx` ; `CHAMP` ne
  sert plus ailleurs qu'aux champs fichier (documents) et au mois de la comptabilité.
- **`form-ui.tsx` reste importé** par environ 130 fichiers, presque tous pour `Alerte`,
  `BOUTON*` et `Pastille` (pas des champs) : son retrait (décision ouverte n° 5) suppose de
  déplacer ces briques (vers `@lalanda/ui` ou un module commun), hors du périmètre des
  formulaires.
- **Champs « mois »** (`type="month"`) : six usages restent natifs (dépenses, réalisé, pont des
  encaissements, comptabilité, finances de la console), faute de sélecteur de mois dans
  `@lalanda/ui` (décision ouverte n° 6).
- Fériés de l'organisation dans les calendriers des absences et du planning, une fois la
  décision ouverte n° 1 prise.
- La connexion des membres (`/login`, phase 1) passe par `Form`, donc `noValidate` : les
  contrôles natifs d'adresse y sont tombés (l'API juge) ; l'inscription les garde.

## Conséquences

- Un écran ne relie plus à la main `aria-describedby`/`aria-invalid` : `Field` le fait.
- `form-ui.tsx` (`CHAMP`, `Champ`, `aria`) reste en place pour les écrans de phase 2 ; il sera
  retiré quand plus rien ne l'importe.
- Le `<select>` natif garde un intérêt sur téléphone (roue du système) ; `Select` le remplace
  quand même par une feuille basse, pour un rendu et une recherche identiques partout.

## Décisions ouvertes

1. **Fériés dans le calendrier** : afficher les fériés de l'organisation dans tous les
   `DatePicker` de l'outil, ou seulement dans les écrans RH (la lecture exige `hr.read`) ?
2. **Article en création rapide** depuis une ligne de facture : fiche complète en fenêtre (comme
   le client) ou pas de **+** du tout (catalogue géré à part) ?
3. **Avertissement de navigation interne** : `beforeunload` couvre rechargement et fermeture
   d'onglet ; une navigation par lien de l'application n'est pas interceptée (le routeur de
   Next 15 n'offre pas d'API pour cela). Faut-il un garde maison sur les liens du menu ?
4. **Second facteur pour les membres** : la connexion des organisations n'en a pas ; le jour où il
   existera, l'écran en deux temps est prêt (même composant).
5. **Retrait de `form-ui.tsx`** à la fin de la phase 2 (après migration de tous ses usages).
6. **Sélecteur de mois** : ajouter un `MonthPicker` à `@lalanda/ui` (filtres et exercices), ou
   garder le champ natif `type="month"` stylé ?
7. **Fournisseur d'une dépense directe** (Trésorerie) : l'API reçoit un **nom libre**
   (`supplierName`), pas un identifiant ; le champ reste un texte avec suggestions. Faut-il lier
   la dépense à la fiche fournisseur (changement d'API) ?

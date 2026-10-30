# ADR-0042 — Envoi des documents de vente par e-mail, depuis l'aperçu

Statut : Proposed
Date : 2026-10-30
Décideurs : Gracy Omokoso (dirigeante) — **demande du 30 oct. 2026** (§ Contexte) ; CTO Lalanda
(contrat technique). Les choix marqués « proposition » sont soumis à la dirigeante (§ Décisions
ouvertes).

> **Amende [ADR-0035](ADR-0035-crm-et-devis.md) § 1** (« Lalanda n'envoie pas d'e-mail (le PDF
> est remis par l'utilisateur) ») et **[ADR-0040](ADR-0040-crm-complet.md) § Hors périmètre**
> (« Envoi d'e-mails depuis Lalanda (relance, devis, séquence) ») **sur un seul point** : un
> utilisateur peut envoyer **un document de vente** (facture, avoir, pro forma, devis) à **son
> client**, PDF joint, d'un geste explicite. Les relances, séquences et envois automatiques
> restent hors périmètre. **S'appuie sans les modifier** sur [ADR-0014](ADR-0014-envoi-emails-et-connexion-google.md)
> (`MailService`, transport ZeptoMail/SMTP, repli journal), [ADR-0025](ADR-0025-documents-pdf-factures.md)
> et [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (rendu des PDF). Aucune action
> nouvelle : la matrice de docs/12 est inchangée.

## Contexte

> « Nous devons être en mesure de voir l'aperçu d'une facture, pas seulement la télécharger.
> Dans l'aperçu, des boutons pour envoyer par mail, télécharger et imprimer. On garde aussi le
> téléchargement tel qu'il se fait actuellement. L'aperçu s'ouvre en modal. »

La dirigeante confirme que **l'envoi fonctionne en production** (ZeptoMail, domaine vérifié) :
le motif d'ADR-0040 (« la signature DKIM du domaine d'envoi n'est pas réglée, les e-mails
partent en spam ») est levé.

Faits du dépôt :

- les PDF existent : `GET /sales/invoices/:id/pdf` (original, ou pro forma pour tout document
  non final) et `GET /sales/quotes/:id/pdf`, tous deux en `sales.read`, audit **strict**
  (`sales_invoice.pdf_exported`, `sales_quote.pdf_exported`) ;
- le **quota d'exports PDF** (`PdfExportQuotaService`, docs/13) ne garde que le rapport de plan
  (`GET /projects/:id/report/pdf`) ; aucun PDF de vente n'y est soumis ;
- `MailService` n'envoie que des intentions métier ; `MailMessage` ne connaît ni copie, ni
  adresse de réponse, ni pièce jointe autre que les images en ligne ;
- les e2e remplacent `MailTransport.send` par un espion : aucun envoi réseau en test.

## Décision

### 1. Qui envoie, avec quel droit

| Document | Droit exigé | Pourquoi |
|---|---|---|
| Facture, avoir, pro forma (`sales_invoices`) | `sales.invoice` | Envoyer une facture au client est un geste de facturation qui engage l'entreprise, au même titre que l'émettre ; c'est la population qui émet (PRO, DIR, CPT). `sales.invoice` suppose `sales.manage` et `sales.read` (prérequis d'ADR-0041). L'Administrateur et le Commercial, qui n'émettent pas, n'envoient pas. |
| Devis (`sales_quotes`) | `sales.quote` | C'est le droit qui fait passer un devis à « envoyé » (ADR-0040 § 4.1) ; le Commercial l'a. |

Un pro forma relève du même droit que la facture, par simplicité : une seule route, un seul
droit (décision ouverte n° 1).

### 2. Documents envoyables

| Statut | Envoyable | Motif |
|---|---|---|
| Facture `issued` ou `normalized` (avec éléments de sécurité) | oui | Document final. Un `normalized` sans éléments se lit pro forma (verrou ADR-0024) : refusé. |
| Avoir (`FA`, `EA`) émis ou normalisé | oui | Idem. |
| Brouillon (`draft`) | **oui, comme pro forma** | Le PDF porte déjà « PRO FORMA — non valable comme facture » ; le message e-mail porte en plus, **hors du texte modifiable**, la mention « Pro forma — ce document n'est pas une facture ». Un client ne peut pas le recevoir sans la mention. |
| `pending_normalization`, `normalization_failed` | **non** (409 `DOCUMENT_NOT_SENDABLE`) | Le document est entre deux états : le client recevrait un pro forma d'une facture qui va recevoir un numéro et des éléments de sécurité. On attend l'issue. |
| Devis `sent` (non échu) ou `accepted` | oui | Engagement commercial proposé ou accepté. Mention fixe « Devis — non valable comme facture ». |
| Devis `draft`, `refused`, échu | **non** (409 `DOCUMENT_NOT_SENDABLE`) | Brouillon : on le marque d'abord « envoyé » (décision ouverte n° 2). Refusé ou échu : envoyer un prix périmé. |

### 3. Destinataire, objet, message

- **À** : une adresse ; préremplie avec l'e-mail **de l'instantané client du document**
  (`customer.email`), modifiable. **Copie** : 0 à 5 adresses, facultatives, distinctes de « À ».
  Format vérifié par l'API (400 `INVALID_REQUEST`), 254 caractères au plus.
- **Objet** : prérempli (« Facture FV2610-000123 — Exemple SARL »), modifiable, 1 à 200
  caractères, **sans retour à la ligne** (injection d'en-tête).
- **Message** : prérempli (salutation, document joint, montant, signature de l'expéditeur),
  modifiable, 5 000 caractères au plus, **texte brut** : échappé, jamais interprété en HTML, sans
  lien cliquable fabriqué.
- **Expéditeur** : l'adresse `MAIL_FROM` (domaine vérifié) ; nom affiché « {organisation} via
  Lalanda ». **Répondre à** : l'adresse de l'utilisateur qui envoie, pour que le client réponde
  à une personne et non à `no-reply`.
- `GET …/email` renvoie ces valeurs préremplies et dit si le document est envoyable ;
  `POST …/email` envoie.

### 4. Pièce jointe

Le PDF est **le même rendu que le téléchargement** (même service, même modèle de présentation,
même vérification des mentions), joint sous le même nom de fichier. Il est produit à chaque
envoi, jamais stocké. Le quota d'exports PDF ne s'applique pas : il n'existe pas pour les
documents de vente (le téléchargement n'y est pas soumis non plus). S'il est un jour étendu aux
ventes, l'envoi passera par la même garde que le téléchargement.

`MailMessage` gagne `cc`, `replyTo`, `fromName`, `attachments` et `redactInLogs` ; ZeptoMail
(`cc`, `reply_to`, `attachments`) et SMTP (`cc`, `replyTo`, `attachments`) les transmettent.

### 5. Audit strict

Deux événements par envoi, dans le journal de l'organisation :

1. **`sales_invoice.email_requested`** / **`sales_quote.email_requested`** — écrit en
   `recordStrict` **avant** l'envoi : si la trace ne s'écrit pas, rien ne part. Contient : qui
   (utilisateur, rôle), quand (horodatage du journal), le document (identifiant, référence,
   nature, statut), à qui (`to`, `cc`), longueur de l'objet et du message, taille du PDF.
2. **`sales_invoice.emailed`** / **`sales_quote.emailed`** — le résultat : `delivered`, motif
   (`MAIL_NOT_CONFIGURED`, `ZEPTOMAIL_ERROR`, `SMTP_ERROR`). Écrit en `record` : l'e-mail est
   déjà parti, faire échouer la requête pousserait l'utilisateur à renvoyer (doublon). Une
   demande sans résultat au journal se lit « issue inconnue ».

Le PDF de l'envoi n'écrit pas `pdf_exported` : l'envoi est sa propre trace.

### 6. Limite de débit

Seau commun aux deux routes `POST …/email`, posé après l'authentification : **20 envois par
heure et par utilisateur**, **100 par heure et par organisation**. Au-delà, `429
DOCUMENT_EMAIL_RATE_LIMITED` en français, avec l'attente. Stockage en mémoire, comme la
normalisation (une seule instance d'API). Ces plafonds bornent l'usage du domaine d'envoi pour
du pourriel ; ils ne gênent pas une facturation normale.

### 7. Journaux d'exploitation

Aucune donnée sensible : pour ces envois, le transport ne journalise ni l'objet, ni le corps,
ni la pièce jointe, et masque l'adresse (`j***@exemple.cd`). Les adresses complètes ne vivent
que dans le journal d'audit de l'organisation.

### 8. Isolation

Chaque route lit le document **dans l'organisation active** (`organizationId` sur la requête) ;
un document d'une autre organisation répond 404, avant tout rendu ou envoi. Le seau de débit
« organisation » est indexé par l'organisation active.

### 9. Interface

Bouton « Aperçu » sur la fiche et dans les listes des factures et des devis ; il ouvre une
fenêtre modale (dialogue, focus piégé, Échap) qui affiche le PDF (`<iframe>` sur un `blob:` de
la route PDF existante) avec **Envoyer par e-mail**, **Télécharger**, **Imprimer**. Un bouton
dont le droit manque est désactivé avec sa raison. Plein écran sur téléphone, avec « Ouvrir le
PDF » si l'iframe n'affiche rien. Le bouton de téléchargement actuel reste à sa place. Ouvrir
l'aperçu passe par `GET …/pdf` et écrit donc `pdf_exported` (c'est un affichage du document).

## Décisions ouvertes (valeur par défaut appliquée)

1. **Pro forma sous `sales.manage`** plutôt que `sales.invoice` ? Défaut : `sales.invoice` pour
   tous les documents de `sales_invoices`.
2. **Envoyer un devis brouillon le marque « envoyé »** ? Défaut : non ; on marque d'abord
   envoyé, puis on envoie.
3. **Copie cachée à l'expéditeur** ? Défaut : non (l'adresse de réponse suffit ; l'audit garde
   la preuve).
4. **Historique des envois sur la fiche** ? Défaut : non ; l'audit de l'organisation le porte.
5. **Plafonds** : 20/h par utilisateur, 100/h par organisation. Défaut appliqué.
6. **Pièces jointes supplémentaires** (conditions générales) ? Défaut : non.

## Conséquences

- Aucun champ ajouté aux documents de vente ; aucun événement au journal électronique fiscal.
- Un déploiement sans `ZEPTOMAIL_TOKEN` ni `SMTP_HOST` répond `delivered: false,
  reason: MAIL_NOT_CONFIGURED`, et l'interface le dit.
- Les tests n'appellent jamais ZeptoMail : `MailTransport.send` est un espion.

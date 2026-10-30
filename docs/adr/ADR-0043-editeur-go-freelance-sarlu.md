# ADR-0043 — Éditeur du service : Go freelance SARLU, avec Televerx LLC comme partenaire

Statut : Accepted
Date : 2026-10-30
Décideurs : Gracy Omokoso (dirigeante)

## Contexte

Le corpus légal `2026-08-09` (S22c) désignait **Televerx LLC** comme éditeur, sans
autre information d'identification. La forme « LLC » faisait supposer une
immatriculation aux États-Unis, et `docs/28-CONFORMITE-LEGALE.md` en tirait trois
questions (droit applicable, juridiction, transferts).

Décision de la dirigeante, 30 oct. 2026 : « L'application doit être complètement
portée par Go freelance SARLU, société de droit congolais (RDC), avec Televerx LLC
comme partenaire de développement et d'intégration. »

## Décision

1. **Éditeur** : Go freelance SARLU, société à responsabilité limitée
   unipersonnelle de droit congolais (RDC). Constantes dans
   `packages/shared/src/legal/index.ts` (`PUBLISHER_NAME`, `PUBLISHER_LEGAL_FORM`,
   `PUBLISHER_GOVERNING_LAW`), seul endroit où l'identité est déclarée.
2. **Partenaire** : Televerx LLC, « partenaire de développement et d'intégration de
   Go freelance SARLU » (`DEVELOPMENT_PARTNER_NAME`, `DEVELOPMENT_PARTNER_ROLE`).
   Il apparaît **uniquement dans les mentions légales** : ni pied de page, ni
   politique de confidentialité, ni CGU/CGV.
3. **Mentions non publiées** : RCCM, Id. Nat., NIF, siège, capital, gérant,
   directeur de la publication (nommé), téléphone ne sont pas fournis et ne sont
   pas publiés, ni sous forme de marqueur (`PUBLISHER_UNPUBLISHED_MENTIONS`,
   registre interne). Le directeur de la publication est « le représentant légal
   de Go freelance SARLU ».
4. **Nouvelle acceptation** : `LEGAL_VERSION` passe à `2026-10-30` ; les
   utilisateurs existants doivent accepter à nouveau CGU et CGV à leur prochaine
   connexion.
5. **Hébergeur** : DigitalOcean (ADR-0009) est nommé dans les mentions légales et
   la politique de confidentialité.

## Conséquences

- Toute acceptation `2026-08-09` devient périmée (`isCurrent: false`).
- **L'écran de ré-acceptation à la connexion n'existe pas** (docs/28 § 2.3 bis) :
  tant qu'il n'est pas construit, la décision 4 n'est pas appliquée aux comptes
  existants.
- L'analyse fondée sur « LLC = États-Unis » est caduque ; les questions de droit
  applicable, juridiction, protection des données et transferts sont reformulées
  pour un éditeur congolais et restent à faire trancher par un juriste
  (docs/28 § 1.3). Aucune règle de droit congolais n'est posée par cet ADR.
- La non-publication de mentions habituellement attendues (RCCM, Id. Nat., NIF,
  siège) est à faire valider par un juriste.
- Si Go freelance SARLU vend les abonnements, ses factures relèvent a priori de la
  facture normalisée DGI : écart non résolu, décrit en docs/28 § 6.

## Liens

- `docs/28-CONFORMITE-LEGALE.md`
- ADR-0009 (infrastructure DigitalOcean), ADR-0019 et ADR-0024 (facture normalisée DGI)

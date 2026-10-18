# Sources — facture normalisée DGI (République démocratique du Congo)

Règle du projet : les règles pays sont **sourcées, datées et versionnées**. Ce
dossier conserve les pièces sur lesquelles repose l'intégration de la facture
normalisée ([ADR-0019](../../adr/ADR-0019-facture-normalisee-dgi-rdc.md)). Une pièce
n'est jamais modifiée : une nouvelle version s'ajoute à côté, datée.

## Spécification de l'API e-DEF

| Champ | Valeur |
|---|---|
| Fichier | `edef-api-v2.0-2026-10-18.json` (OpenAPI 3, `info.version` = `2.0`) |
| Émetteur | Direction Générale des Impôts (DGI), RDC |
| Provenance | `https://developper.dgirdc.cd/edef/swagger/v1/swagger.json` (page publique `…/edef/swagger/index.html`) |
| Relevé le | 18 oct. 2026 |
| Empreinte SHA-256 | `4ab41373ed953bbfec56eff5ba246135cf1260e94e5388d22a50bcbed9eaa767` |
| Validé par | à faire — Gracy Omokoso (décideur), au moment de l'homologation |

Ce que la spécification **ne contient pas** et qu'il faut obtenir de la DGI
(portail développeur, accès authentifié) : la signification de chaque groupe de
taxation `A`…`Z` et des types de facture `FV FT FA EV ET EA`, la table des codes
d'erreur, le délai maximal entre `POST /api/invoice` et sa confirmation, le format
d'impression du QR code et des mentions obligatoires, les URL des environnements
de test et de production. Les groupes et taux se lisent aussi **en direct** par
`GET /api/info/taxGroups` — l'intégration ne doit jamais les coder en dur (ils ont
été modifiés en février 2026).

## Cadre légal (relevé le 18 oct. 2026)

| Texte | Objet | Source consultée |
|---|---|---|
| Ordonnance-loi n° 10/001 du 20 août 2010 | Institution de la TVA | Bulletin ValidWave, 3 févr. 2026 |
| Décret n° 23/10 du 3 mars 2023 | Cadre de la facture normalisée et des dispositifs électroniques fiscaux (DEF) | idem ; communiqués DGI |
| Arrêté ministériel n° 034 du 23 oct. 2023 | Homologation des systèmes de facturation d'entreprise (SFE) | idem |
| Circulaires n° 004 et 005 du 30 déc. 2024 | Modalités | idem |

**Calendrier.** Entrée en vigueur annoncée au 1ᵉʳ déc. 2025, puis fin du moratoire
au **1ᵉʳ avril 2026** : facture normalisée obligatoire pour les assujettis à la
TVA ; déclarations de TVA établies exclusivement sur factures normalisées à partir
de l'échéance du 15 mai 2026. Février 2026 : nouveaux groupes de taxation et
ré-homologation ciblée des SFE déjà homologués.

**À confirmer auprès de la DGI avant mise en production** : les textes ci-dessus
viennent de sources secondaires (presse économique, cabinet de conseil). Les
originaux doivent être joints ici avant l'homologation.

Sources secondaires :
[Radio Okapi, 3 avr. 2026](https://www.radiookapi.net/2026/04/03/actualite/economie/facture-normalisee-fin-du-moratoire-accorde-aux-entreprises-en-rdc) ·
[Deskeco, 14 oct. 2025](https://deskeco.com/2025/10/14/rdc-la-dgi-fixe-au-1er-decembre-2025-lentree-en-vigueur-de-la-facture-normalisee) ·
[ValidWave, bulletin EFD 2026](https://www.validwaveconsulting.com/bulletin-drc-efd-2026.html) ·
[FEC, procédure d'homologation](https://fec-rdc.com/mise-en-oeuvre-de-la-reforme-relative-a-la-facture-normalisee-le-cabinet-du-ministre-des-finances-et-la-dgi-rencontrent-les-preoccupations-des-entreprises-et-clarifient-la-procedure-dhomologation/)

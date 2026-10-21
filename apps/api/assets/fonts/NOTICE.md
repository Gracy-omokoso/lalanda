# Polices intégrées aux PDF de facture — notices (ADR-0028)

Ces fichiers sont **embarqués dans le PDF** des factures (données `data:` dans le HTML rendu
par Chromium) : aucune police n'est chargée depuis Internet au moment du rendu (confinement
réseau S22e, `pdf-rendering.service.ts`).

Toutes sont distribuées sous la **SIL Open Font License 1.1** (OFL-1.1). Le texte de la
licence accompagne chaque famille (`<famille>/OFL.txt`). L'OFL permet l'usage, l'intégration
dans des documents et la redistribution avec le logiciel ; elle interdit la vente des polices
seules et l'usage des « noms de police réservés » pour une version modifiée.

| Famille        | Dossier           | Fichiers                    | Auteurs (amont)                                                         | Nom réservé (amont) |
| -------------- | ----------------- | --------------------------- | ----------------------------------------------------------------------- | ------------------- |
| Inter          | `inter/`          | latin 300–800, 400 italique | The Inter Project Authors (github.com/rsms/inter)                       | —                   |
| IBM Plex Sans  | `ibm-plex-sans/`  | latin 300–700, 400 italique | IBM Corp.                                                               | « Plex »            |
| Manrope        | `manrope/`        | latin 300–800               | The Manrope Project Authors (github.com/sharanda/manrope)               | —                   |
| Source Serif 4 | `source-serif-4/` | latin 300–800, 400 italique | Adobe (github.com/adobe-fonts/source-serif)                             | « Source »          |
| Fraunces       | `fraunces/`       | latin 300–700, 400 italique | The Fraunces Project Authors (github.com/undercasetype/Fraunces)        | —                   |
| JetBrains Mono | `jetbrains-mono/` | latin 500, 700              | The JetBrains Mono Project Authors (github.com/JetBrains/JetBrainsMono) | —                   |

## Provenance

Fichiers `woff2` du sous-ensemble **latin** tels que distribués par le projet Fontsource
(paquets npm `@fontsource/inter@5.3.0`, `@fontsource/ibm-plex-sans@5.3.0`,
`@fontsource/manrope@5.3.0`, `@fontsource/source-serif-4@5.3.1`, `@fontsource/fraunces@5.3.0`,
`@fontsource/jetbrains-mono@5.3.0`, licence déclarée `OFL-1.1`), copiés **sans modification**
(ni renommage interne, ni nouveau sous-ensemble). Le sous-ensemble latin couvre le français
(accents, « », ’, espaces insécables) ; un glyphe absent retombe sur Arial / Liberation Sans,
installée dans l'image de l'API.

Le texte `OFL.txt` est celui du paquet Fontsource. Pour Source Serif 4, la mention de copyright
amont complète est : « Copyright 2014–2021 Adobe (http://www.adobe.com/), with Reserved Font
Name ‘Source’ ». Pour IBM Plex : « Copyright © 2017 IBM Corp. with Reserved Font Name “Plex” ».

## Règle de réimpression à l'identique

Un fichier de ce dossier n'est **jamais remplacé en place** : une facture gelée se réimprime
avec les mêmes octets de police. Une nouvelle version d'une police entre sous un nouveau nom de
fichier, avec une nouvelle version de modèle (ADR-0028 § 4). Le test
`invoice-fonts.test.ts` fige l'empreinte SHA-256 de chaque fichier.

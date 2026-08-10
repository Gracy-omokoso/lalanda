#!/usr/bin/env node
// Régénère `brand.ts` (data URI base64) à partir des PNG de ce répertoire.
//
// POURQUOI un module TypeScript et pas une lecture de fichier au rendu :
//   1. `apps/api` est compilé par `tsc` seul (voir apps/api/package.json). tsc ne
//      copie AUCUN actif non-TS vers `dist/` : un `readFileSync('./assets/x.png')`
//      marcherait en dev (tsx sur les sources) et échouerait en production, au
//      pire moment — pendant la génération d'un dossier bancaire.
//   2. Le rendu PDF tourne derrière une interception réseau qui avorte toute
//      requête sortante (reports.service.ts). Le logo DOIT donc être un data URI
//      embarqué dans le HTML : ni `http://`, ni `file://`. Une constante compilée
//      est la forme la plus directe de cette contrainte.
//
// Usage : node apps/api/src/reports/assets/generate-brand.mjs
// La sortie est écrite déjà conforme à Prettier (retour à la ligne avant les
// littéraux longs) : `pnpm format:check` doit rester vert sans passe manuelle.
//
// ── Dimensions des PNG d'entrée, et pourquoi elles diffèrent ────────────────
// Règle générale : encoder à la taille d'affichage, pas à la taille de la source.
// Un lockup de 1024 px en base64 est réécrit dans le HTML à CHAQUE rendu, puis
// ré-embarqué dans chaque PDF produit.
//
// Le filigrane suit la règle : affiché sur 22 mm, il est ramené à 260 px (≈300 ppp).
// Gain mesuré contre la source 1024 px : −6,6 Kio de HTML et −6,1 Kio de PDF.
//
// L'en-tête ne la suit PAS, et c'est un choix appuyé sur des mesures. Le seul
// redimensionneur disponible ici (`sips`, macOS) ré-encode en RGBA plein sans
// réoptimiser les filtres PNG, alors que la source livrée est déjà finement
// compressée. Résultat : réduire GONFLE le fichier. Poids du PDF complet
// (filigrane fixé à 260 px, gabarit de démonstration) :
//
//   en-tête  420 px (16,4 Ko) → PDF 144,4 Kio, HTML 39,9 Kio — 172 ppp
//   en-tête  600 px (24,3 Ko) → PDF 151,6 Kio, HTML 50,3 Kio — 246 ppp
//   en-tête  732 px (34,5 Ko) → PDF 160,5 Kio, HTML 63,6 Kio — 300 ppp
//   en-tête 1024 px (15,3 Ko) → PDF 151,4 Kio, HTML 38,4 Kio — 420 ppp  ← retenu
//
// La source native bat 600 px et 732 px sur TOUS les axes à la fois (PDF, HTML,
// résolution). Seul 420 px fait un PDF plus léger, de 7 Kio, en divisant la
// résolution d'impression par 2,4 : sur un dossier déposé en banque et imprimé,
// 7 Kio ne valent pas des contours mous. Le jour où un vrai optimiseur PNG
// (pngquant, oxipng) entre dans la chaîne de construction, refaire la mesure.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Lit les dimensions d'un PNG dans son chunk IHDR (octets 16..23). */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const sources = [
  {
    file: 'logo-lalanda-clair.png',
    constant: 'LOGO_LIGHT_DATA_URI',
    dims: 'LOGO_LIGHT_SIZE',
    doc: "Lockup couleur sur badge sombre — destiné aux FONDS CLAIRS (en-tête du rapport,\n * qui est sur fond blanc). Source : `logo-lalanda-for-ligth.png` (coquille d'origine).",
  },
  {
    file: 'logo-lalanda-filigrane.png',
    constant: 'LOGO_WATERMARK_DATA_URI',
    dims: 'LOGO_WATERMARK_SIZE',
    doc: 'Déclinaison gris ~25 % — filigrane uniquement. Assez pâle pour ne jamais\n * concurrencer un chiffre du tableau au-dessus.',
  },
];

let out = `// FICHIER GÉNÉRÉ — ne pas éditer à la main.
// Régénérer : \`node apps/api/src/reports/assets/generate-brand.mjs\`
//
// Actifs de marque encodés en data URI, embarqués dans le HTML du rapport.
// Le rendu PDF coupe JavaScript et avorte toute requête réseau sortante
// (apps/api/src/reports/reports.service.ts) : un \`<img src="http://…">\` ou
// \`src="file://…">\` serait AVORTÉ et laisserait un blanc dans le dossier bancaire.
// Le data URI n'est pas une requête réseau — c'est la seule voie possible, et la
// CSP du document (\`img-src data:\`) l'autorise déjà explicitement.
`;

for (const s of sources) {
  const buf = readFileSync(resolve(here, s.file));
  const { width, height } = pngSize(buf);
  const b64 = buf.toString('base64');
  out += `
/**
 * ${s.doc}
 *
 * ${width}×${height} px — ${(buf.length / 1024).toFixed(1)} Kio bruts, ${(b64.length / 1024).toFixed(1)} Kio une fois en base64.
 */
export const ${s.constant} =
  'data:image/png;base64,${b64}';

/** Dimensions natives — servent aux attributs \`width\`/\`height\` de l'\`<img>\`. */
export const ${s.dims} = { width: ${width}, height: ${height} } as const;
`;
}

const target = resolve(here, 'brand.ts');
writeFileSync(target, out);
console.log(`brand.ts régénéré (${(out.length / 1024).toFixed(1)} Kio)`);

// Modèle d'import téléchargeable — ADR-0062 § 2.
//
// Un classeur .xlsx à deux onglets : « Guide » (chaque colonne expliquée,
// valeurs permises, formats, exemples) et « Tâches » (en-têtes du modèle et un
// exemple réaliste : ouverture d'une boutique à Kinshasa). La version .csv
// porte les mêmes colonnes et le même exemple, séparateur « ; », UTF-8 avec BOM
// (Excel l'ouvre avec les accents). Aucune formule, aucune macro.

import ExcelJS from 'exceljs';

import { IMPORT_COLUMNS, type ImportField } from './work-import.parser.js';

/** Explication de chaque colonne (onglet « Guide »). */
export const IMPORT_GUIDE: Record<ImportField, { rule: string; values: string; example: string }> =
  {
    section: {
      rule: 'Facultatif. Section du projet = colonne du Tableau. Une section inconnue devient une nouvelle colonne « à faire » (12 colonnes au plus par projet). Vide : première colonne « À faire ».',
      values: 'Texte, 40 caractères au plus',
      example: 'Préparation',
    },
    title: {
      rule: 'OBLIGATOIRE. Le nom de la tâche. Une ligne sans nom est signalée et n’est pas importée.',
      values: 'Texte, 300 caractères au plus',
      example: 'Signer le bail',
    },
    description: {
      rule: 'Facultatif. Détails de la tâche (texte simple).',
      values: 'Texte, 10 000 caractères au plus',
      example: 'Comparer trois emplacements avant de signer',
    },
    assignee: {
      rule: 'Facultatif. L’adresse e-mail d’un membre de l’organisation qui peut travailler sur les projets. Inconnu : la tâche est importée sans responsable (signalé à l’aperçu).',
      values: 'Adresse e-mail d’un membre',
      example: 'prenom.nom@votre-societe.cd',
    },
    startDate: {
      rule: 'Facultatif. Date de début.',
      values: 'JJ/MM/AAAA (une date Excel convient aussi)',
      example: '02/11/2026',
    },
    dueDate: {
      rule: 'Facultatif (OBLIGATOIRE pour un jalon). Date d’échéance, jamais avant le début.',
      values: 'JJ/MM/AAAA',
      example: '13/11/2026',
    },
    priority: {
      rule: 'Facultatif. Vide : aucune priorité.',
      values: 'Basse, Moyenne, Haute ou Urgente',
      example: 'Haute',
    },
    milestone: {
      rule: 'Facultatif. Oui pour un jalon (une étape clé : une échéance, pas de début, pas de sous-tâche).',
      values: 'Oui ou Non',
      example: 'Non',
    },
    dependsOn: {
      rule: 'Facultatif. Tâches à terminer AVANT celle-ci : numéro de ligne du fichier (la ligne d’en-tête est la ligne 1) ou nom exact de la tâche. Une boucle (A attend B qui attend A) est signalée et cassée.',
      values: 'Numéros de ligne ou noms, séparés par des virgules',
      example: '2, 3',
    },
    labels: {
      rule: 'Facultatif. Étiquettes de la tâche ; une étiquette inconnue est créée (50 au plus par organisation).',
      values: 'Textes séparés par des virgules, 10 au plus',
      example: 'Juridique, Urgent client',
    },
    parent: {
      rule: 'Facultatif. Fait de cette ligne une sous-tâche : numéro de ligne ou nom exact de la tâche parente. Un seul niveau de sous-tâches.',
      values: 'Numéro de ligne ou nom',
      example: '5',
    },
    estimate: {
      rule: 'Facultatif. Temps estimé, en heures (information, jamais utilisée dans un calcul de coût).',
      values: 'Nombre d’heures : 1,5 ou 1h30',
      example: '8',
    },
  };

/** Exemple : ouverture d'une boutique à Kinshasa (une ligne = une tâche). */
export const IMPORT_EXAMPLE: readonly string[][] = [
  [
    'Préparation',
    'Étudier les emplacements (Gombe, Limete, Ngaliema)',
    'Repérer 3 emplacements, comparer loyers et passage',
    '',
    '02/11/2026',
    '13/11/2026',
    'Haute',
    'Non',
    '',
    'Étude',
    '',
    '16',
  ],
  [
    'Préparation',
    'Établir le budget d’ouverture',
    'Loyer, travaux, stock initial, caution',
    '',
    '09/11/2026',
    '20/11/2026',
    'Haute',
    'Non',
    '2',
    'Finances',
    '',
    '8',
  ],
  [
    'Préparation',
    'Bail signé',
    '',
    '',
    '',
    '27/11/2026',
    'Urgente',
    'Oui',
    '2, 3',
    'Juridique',
    '',
    '',
  ],
  [
    'Aménagement',
    'Aménager la boutique',
    'Peinture, électricité, rayonnages, enseigne',
    '',
    '30/11/2026',
    '18/12/2026',
    'Moyenne',
    'Non',
    '4',
    'Travaux',
    '',
    '40',
  ],
  [
    'Aménagement',
    'Installer l’électricité et le groupe électrogène',
    '',
    '',
    '30/11/2026',
    '05/12/2026',
    'Haute',
    'Non',
    '',
    'Travaux',
    '5',
    '12',
  ],
  [
    'Aménagement',
    'Poser les rayonnages et la caisse',
    '',
    '',
    '07/12/2026',
    '12/12/2026',
    'Moyenne',
    'Non',
    '',
    'Travaux',
    '5',
    '10',
  ],
  [
    'Approvisionnement',
    'Commander le stock initial',
    'Fournisseurs de Kinshasa ; délais de livraison à confirmer',
    '',
    '23/11/2026',
    '11/12/2026',
    'Haute',
    'Non',
    '3',
    'Achats',
    '',
    '12',
  ],
  [
    'Approvisionnement',
    'Réceptionner et étiqueter le stock',
    '',
    '',
    '14/12/2026',
    '19/12/2026',
    'Moyenne',
    'Non',
    '8',
    'Achats',
    '',
    '16',
  ],
  [
    'Lancement',
    'Ouvrir les paiements Mobile Money (M-Pesa, Orange Money)',
    '',
    '',
    '23/11/2026',
    '04/12/2026',
    'Moyenne',
    'Non',
    '',
    'Finances',
    '',
    '3',
  ],
  [
    'Lancement',
    'Préparer la campagne d’ouverture (WhatsApp, Facebook)',
    '',
    '',
    '07/12/2026',
    '19/12/2026',
    'Moyenne',
    'Non',
    '',
    'Marketing',
    '',
    '12',
  ],
  [
    'Lancement',
    'Ouverture de la boutique',
    '',
    '',
    '',
    '21/12/2026',
    'Haute',
    'Oui',
    '5, 9, 11',
    '',
    '',
    '',
  ],
];

const HEADERS = IMPORT_COLUMNS.map((c) => c.header);

/** Modèle .xlsx (onglets « Guide » puis « Tâches »). */
export async function buildImportTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lalanda';
  wb.created = new Date(Date.UTC(2026, 10, 5));

  const guide = wb.addWorksheet('Guide');
  guide.columns = [{ width: 22 }, { width: 90 }, { width: 42 }, { width: 32 }];
  guide.addRow(['Importer des tâches dans Lalanda']);
  guide.addRow([
    'Mode d’emploi',
    'Remplissez l’onglet « Tâches » : une ligne par tâche, sans changer la ligne d’en-tête. Enregistrez en .xlsx (ou en CSV UTF-8), puis Projets › Nouveau projet › Importer un fichier, ou « Importer des tâches » dans un projet. Lalanda affiche un aperçu avec les erreurs ligne par ligne AVANT de créer quoi que ce soit.',
  ]);
  guide.addRow([
    'Limites',
    '2 Mo et 2 000 lignes au plus. Pas de formule ni de macro : seules les valeurs sont lues.',
  ]);
  guide.addRow([]);
  const head = guide.addRow(['Colonne', 'Règle', 'Valeurs permises', 'Exemple']);
  head.font = { bold: true };
  for (const c of IMPORT_COLUMNS) {
    const g = IMPORT_GUIDE[c.field];
    guide.addRow([c.header, g.rule, g.values, g.example]);
  }
  guide.getRow(1).font = { bold: true, size: 14 };
  guide.eachRow((r) => {
    r.alignment = { wrapText: true, vertical: 'top' };
  });

  const sheet = wb.addWorksheet('Tâches');
  sheet.columns = HEADERS.map((h, i) => ({
    header: h,
    width: i === 1 ? 48 : i === 2 ? 40 : i === 3 ? 30 : 16,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of IMPORT_EXAMPLE) sheet.addRow(r);
  // Les dates restent du TEXTE JJ/MM/AAAA : aucune conversion régionale d'Excel.
  for (const col of [5, 6]) sheet.getColumn(col).numFmt = '@';

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvField(v: string): string {
  return /[;"\n\r,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Modèle .csv : « ; », UTF-8 avec BOM, fins de ligne CRLF. */
export function buildImportTemplateCsv(): Buffer {
  const lines = [HEADERS, ...IMPORT_EXAMPLE].map((r) => r.map(csvField).join(';'));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

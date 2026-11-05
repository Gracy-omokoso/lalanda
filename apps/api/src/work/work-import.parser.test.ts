// Lecture d'un fichier de tâches et passage au plan — ADR-0062. Sans base.

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  ImportFileError,
  fieldOfHeader,
  guessDelimiter,
  inspectZip,
  parseCsv,
  parseDay,
  parseEstimateMinutes,
  readTable,
  tableToPlan,
  type ImportMember,
  type ImportTable,
} from './work-import.parser.js';
import {
  buildImportTemplateCsv,
  buildImportTemplateXlsx,
  IMPORT_EXAMPLE,
} from './work-import.template.js';

const MEMBERS: ImportMember[] = [
  { userId: 'a'.repeat(24), name: 'Bea Kanku', email: 'bea@exemple.cd', canUpdate: true },
  { userId: 'b'.repeat(24), name: 'Lecteur Seul', email: 'lecteur@exemple.cd', canUpdate: false },
];
const KNOWN = { sections: ['À faire', 'En cours', 'Terminé'], labels: ['Juridique'] };

const csv = (text: string) => Buffer.from(text, 'utf8');
const plan = async (text: string) => tableToPlan(await readTable(csv(text)), MEMBERS, KNOWN);
const issues = (r: Awaited<ReturnType<typeof plan>>, row: number) =>
  r.preview.issues.filter((i) => i.row === row).map((i) => `${i.severity}:${i.code}`);

describe('lecture CSV', () => {
  it('devine le séparateur « ; », « , » ou tabulation, hors guillemets', () => {
    expect(guessDelimiter('Tâche;Début;Échéance')).toBe(';');
    expect(guessDelimiter('Tâche,Début,"a;b;c"')).toBe(',');
    expect(guessDelimiter('Tâche\tDébut')).toBe('\t');
  });

  it('respecte les guillemets doublés et les retours à la ligne dans un champ', () => {
    expect(parseCsv('a;"b ""c""";"d\ne"\r\nf;g;h', ';')).toEqual([
      ['a', 'b "c"', 'd\ne'],
      ['f', 'g', 'h'],
    ]);
  });

  it('retire le BOM UTF-8 et lit les accents ; lit aussi du Windows-1252', async () => {
    const t = await readTable(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv('Tâche;Échéance\nÉtude;01/12/2026\n')]),
    );
    expect(t.headers).toEqual(['Tâche', 'Échéance']);
    expect(t.rows[0]!.cells).toEqual(['Étude', '01/12/2026']);
    const latin = Buffer.from('T\xe2che;D\xe9but\n\xc9tude;\n', 'latin1');
    const t2 = await readTable(latin);
    expect(t2.headers[0]).toBe('Tâche');
    expect(t2.rows[0]!.cells[0]).toBe('Étude');
  });

  it('accepte « , » comme séparateur', async () => {
    const r = await plan('Tâche,Priorité\nA,Haute\nB,Basse\n');
    expect(r.tasks.map((t) => [t.title, t.priority])).toEqual([
      ['A', 'high'],
      ['B', 'low'],
    ]);
  });

  it('ignore les lignes vides sans décaler les numéros de ligne', async () => {
    const r = await plan('Tâche;Dépend de\nA;\n;\n\nB;2\n');
    expect(r.preview.rows.map((x) => x.row)).toEqual([2, 5]);
    expect(r.tasks[1]!.dependsOn).toEqual(['L2']);
  });

  it('refuse un fichier vide ou trop gros', async () => {
    await expect(readTable(Buffer.alloc(0))).rejects.toBeInstanceOf(ImportFileError);
    await expect(readTable(Buffer.alloc(2 * 1024 * 1024 + 1, 0x41))).rejects.toMatchObject({
      code: 'IMPORT_FILE_TOO_LARGE',
    });
  });
});

describe('en-têtes', () => {
  it('reconnaît les colonnes renommées (accents, casse, astérisque, parenthèses)', () => {
    expect(fieldOfHeader('TÂCHE *')).toBe('title');
    expect(fieldOfHeader('Nom de la tâche')).toBe('title');
    expect(fieldOfHeader('Responsable (e-mail)')).toBe('assignee');
    expect(fieldOfHeader('Date d’échéance')).toBe('dueDate');
    expect(fieldOfHeader('Sous-tâche de')).toBe('parent');
    expect(fieldOfHeader('Tags')).toBe('labels');
    expect(fieldOfHeader('Couleur')).toBeNull();
  });

  it('signale une colonne « Tâche » manquante, et les colonnes ignorées', async () => {
    const r = await plan('Titre du truc;Couleur\nA;rouge\n');
    expect(r.tasks).toEqual([]);
    expect(r.preview.issues[0]!.code).toBe('IMPORT_TITLE_COLUMN_MISSING');
    const r2 = await plan('Tâche;Couleur\nA;rouge\n');
    expect(r2.preview.ignoredColumns).toEqual(['Couleur']);
    expect(r2.tasks).toHaveLength(1);
  });

  it('fonctionne avec seulement la colonne « Tâche » (colonnes manquantes)', async () => {
    const r = await plan('Tâche\nA\nB\n');
    expect(r.preview.counts).toMatchObject({ rows: 2, valid: 2, invalid: 0 });
  });
});

describe('dates', () => {
  it('JJ/MM/AAAA, AAAA-MM-JJ, numéro de série Excel', () => {
    expect(parseDay('05/01/2027')).toBe('2027-01-05');
    expect(parseDay('5-1-2027')).toBe('2027-01-05');
    expect(parseDay('2027-01-05')).toBe('2027-01-05');
    expect(parseDay('46392')).toBe('2027-01-05');
    expect(parseDay('')).toBeNull();
    expect(parseDay('31/02/2027')).toBeUndefined();
    expect(parseDay('demain')).toBeUndefined();
  });

  it('une date invalide écarte la ligne ; une échéance avant le début aussi', async () => {
    const r = await plan(
      'Tâche;Début;Échéance\nA;32/01/2027;\nB;10/01/2027;05/01/2027\nC;01/01/2027;02/01/2027\n',
    );
    expect(issues(r, 2)).toEqual(['error:IMPORT_DATE_INVALID']);
    expect(issues(r, 3)).toEqual(['error:WORK_DATES_INVERTED']);
    expect(r.tasks.map((t) => t.title)).toEqual(['C']);
    expect(r.preview.counts).toMatchObject({ valid: 1, invalid: 2 });
  });
});

describe('responsable, priorité, jalon, estimation', () => {
  it('responsable : e-mail d’un membre ; inconnu ou sans droit → sans responsable (avertissement)', async () => {
    const r = await plan(
      'Tâche;Responsable\nA;BEA@exemple.cd\nB;inconnu@x.cd\nC;lecteur@exemple.cd\n',
    );
    expect(r.tasks.map((t) => t.assigneeUserId)).toEqual(['a'.repeat(24), null, null]);
    expect(issues(r, 3)).toEqual(['warning:IMPORT_ASSIGNEE_UNKNOWN']);
    expect(issues(r, 4)).toEqual(['warning:IMPORT_ASSIGNEE_NOT_ELIGIBLE']);
    expect(r.preview.counts.valid).toBe(3);
  });

  it('priorités du modèle (Basse, Moyenne, Haute, Urgente), inconnue → aucune', async () => {
    const r = await plan('Tâche;Priorité\nA;Urgente\nB;moyenne\nC;Critique\n');
    expect(r.tasks.map((t) => t.priority)).toEqual(['urgent', 'medium', 'none']);
    expect(issues(r, 4)).toEqual(['warning:IMPORT_PRIORITY_UNKNOWN']);
  });

  it('jalon : échéance obligatoire, début retiré ou reporté en échéance', async () => {
    const r = await plan(
      'Tâche;Début;Échéance;Jalon\nA;;10/01/2027;Oui\nB;;;Oui\nC;05/01/2027;;oui\nD;05/01/2027;10/01/2027;Oui\n',
    );
    expect(issues(r, 3)).toEqual(['error:WORK_MILESTONE_NEEDS_DATE']);
    const byTitle = Object.fromEntries(r.tasks.map((t) => [t.title, t]));
    expect(byTitle['C']).toMatchObject({
      startDate: null,
      dueDate: '2027-01-05',
      isMilestone: true,
    });
    expect(byTitle['D']).toMatchObject({ startDate: null, dueDate: '2027-01-10' });
  });

  it('estimation en heures → minutes', () => {
    expect(parseEstimateMinutes('1,5')).toBe(90);
    expect(parseEstimateMinutes('2')).toBe(120);
    expect(parseEstimateMinutes('1h30')).toBe(90);
    expect(parseEstimateMinutes('45 min')).toBe(45);
    expect(parseEstimateMinutes('')).toBeNull();
    expect(parseEstimateMinutes('beaucoup')).toBeUndefined();
  });
});

describe('dépendances, sous-tâches, cycles', () => {
  it('dépendance par numéro de ligne ou par titre ; introuvable → ignorée', async () => {
    const r = await plan('Tâche;Dépend de\nA;\nB;2\nC;A, B\nD;99, Inconnue\n');
    expect(r.tasks.map((t) => t.dependsOn)).toEqual([[], ['L2'], ['L2', 'L3'], []]);
    expect(issues(r, 5)).toEqual([
      'warning:IMPORT_DEPENDENCY_UNKNOWN',
      'warning:IMPORT_DEPENDENCY_UNKNOWN',
    ]);
  });

  it('dépendance vers une ligne en erreur → ignorée', async () => {
    const r = await plan('Tâche;Échéance;Dépend de\nA;zz;\nB;;2\n');
    expect(issues(r, 3)).toEqual(['warning:IMPORT_DEPENDENCY_INVALID']);
  });

  it('casse un cycle de dépendances et le signale', async () => {
    const r = await plan('Tâche;Dépend de\nA;4\nB;2\nC;3\n');
    const cycle = r.preview.issues.filter((i) => i.code === 'WORK_DEPENDENCY_CYCLE');
    expect(cycle).toHaveLength(1);
    expect(cycle[0]!.message).toContain('ligne');
    const deps = r.tasks.reduce((n, t) => n + (t.dependsOn?.length ?? 0), 0);
    expect(deps).toBe(2);
    expect(r.tasks).toHaveLength(3);
  });

  it('auto-dépendance ignorée', async () => {
    const r = await plan('Tâche;Dépend de\nA;2\n');
    expect(issues(r, 2)).toEqual(['warning:IMPORT_DEPENDENCY_SELF']);
  });

  it('sous-tâche : un seul niveau ; parent jalon refusé', async () => {
    const r = await plan(
      'Tâche;Sous-tâche de;Jalon;Échéance\nP;;;\nE;2;;\nPetite;3;;\nJ;;Oui;01/02/2027\nS;5;;\n',
    );
    const by = Object.fromEntries(r.tasks.map((t) => [t.title, t.parentRef]));
    expect(by).toEqual({ P: null, E: 'L2', Petite: null, J: null, S: null });
    expect(issues(r, 4)).toEqual(['warning:IMPORT_PARENT_DEPTH']);
    expect(issues(r, 6)).toEqual(['warning:IMPORT_PARENT_DEPTH']);
  });

  it('annonce les sections et étiquettes nouvelles', async () => {
    const r = await plan(
      'Section;Tâche;Étiquettes\nPréparation;A;Juridique, Achats\nEn cours;B;achats\n',
    );
    expect(r.preview.newSections).toEqual(['Préparation']);
    expect(r.preview.newLabels).toEqual(['Achats']);
  });

  it('limite à 2 000 lignes', async () => {
    const lines = ['Tâche', ...Array.from({ length: 2001 }, (_, i) => `T${i}`)].join('\n');
    const r = await plan(lines);
    expect(r.preview.issues[0]!.code).toBe('IMPORT_TOO_MANY_ROWS');
    expect(r.tasks).toEqual([]);
  });
});

describe('xlsx', () => {
  it('le modèle .xlsx a un onglet Guide et un onglet Tâches, relu sans erreur', async () => {
    const buf = await buildImportTemplateXlsx();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Guide', 'Tâches']);
    const r = tableToPlan(await readTable(buf), MEMBERS, KNOWN);
    expect(r.preview.counts).toMatchObject({
      rows: IMPORT_EXAMPLE.length,
      valid: IMPORT_EXAMPLE.length,
      invalid: 0,
    });
    expect(r.preview.issues).toEqual([]);
    expect(r.preview.counts.milestones).toBe(2);
    expect(r.preview.counts.subtasks).toBe(2);
  });

  it('le modèle .csv porte un BOM, « ; » et se relit à l’identique', async () => {
    const buf = buildImportTemplateCsv();
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const r = tableToPlan(await readTable(buf), MEMBERS, KNOWN);
    expect(r.preview.counts).toMatchObject({ valid: IMPORT_EXAMPLE.length, invalid: 0 });
  });

  it('dates Excel (cellules date et numéros de série), formule : valeur en cache seulement', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tâches');
    ws.addRow(['Tâche', 'Début', 'Échéance', 'Description']);
    ws.addRow(['A', new Date(Date.UTC(2027, 0, 5)), 46393, { formula: 'B2+1', result: 'calculé' }]);
    ws.addRow(['B', null, null, { formula: 'NOW()' }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = tableToPlan(await readTable(buf), MEMBERS, KNOWN);
    expect(r.tasks[0]).toMatchObject({
      startDate: '2027-01-05',
      dueDate: '2027-01-06',
      description: 'calculé',
    });
    expect(r.tasks[1]!.description).toBeNull();
  });

  it('refuse un classeur à macros et un zip qui n’est pas un classeur', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Tâches').addRow(['Tâche']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(inspectZip(buf).entries).toContain('xl/workbook.xml');
    // Un zip minimal avec une seule entrée « xl/vbaProject.bin ».
    const name = Buffer.from('xl/vbaProject.bin');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(local.length + name.length, 16);
    const zip = Buffer.concat([local, name, central, name, eocd]);
    await expect(readTable(zip)).rejects.toMatchObject({ code: 'IMPORT_FILE_MACRO' });
  });
});

describe('tableau arbitraire', () => {
  it('une ligne sans nom de tâche est une erreur', () => {
    const t: ImportTable = {
      format: 'csv',
      headers: ['Tâche', 'Description'],
      rows: [{ row: 2, cells: ['', 'détail'] }],
    };
    const r = tableToPlan(t, MEMBERS, KNOWN);
    expect(r.preview.issues.map((i) => i.code)).toContain('IMPORT_TITLE_MISSING');
    expect(r.tasks).toEqual([]);
  });
});

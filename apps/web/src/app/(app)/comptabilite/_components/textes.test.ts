// Textes de l'application Comptabilité — ADR-0049 § 10, critère 14, critère 17, lot K8.
//
// Lalanda n'affirme jamais une conformité : aucun fichier de l'application (écrans,
// modèles, client d'API) ne porte « conforme », « certifié », « définitif » ni
// « liasse », sous aucune forme fléchie (le bandeau officiel, qui les cite à la
// négative, est retiré d'abord par `findForbiddenAccountingWords`). « déclaration »
// n'apparaît que dans « déclaration de relecture » (§ 2.4, décision ouverte n° 6).
// Aucun numéro de compte n'est écrit en dur : les comptes viennent du pack et des
// règles validées (§ 2.1 « aucun numéro n'est créé par le code »).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  ACCOUNTING_DISCLAIMER,
  ACCOUNTING_MODE_BANNERS,
  findForbiddenAccountingWords,
} from '@lalanda/shared/accounting';
import { describe, expect, it } from 'vitest';

const RACINE_APP = join(__dirname, '..');
const CLIENT = join(__dirname, '..', '..', '..', '..', 'lib', 'api-accounting.ts');

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin));
    else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.ts$/.test(nom)) out.push(chemin);
  }
  return out;
}

const SOURCES = [...fichiers(RACINE_APP), CLIENT];

describe('textes de la comptabilité (ADR-0049 § 10)', () => {
  it('couvre bien les écrans, les modèles et le client d’API', () => {
    const noms = SOURCES.map((f) => relative(RACINE_APP, f));
    expect(noms).toContain('page.tsx');
    expect(noms).toContain('layout.tsx');
    expect(noms).toContain(join('etats', 'page.tsx'));
    expect(noms).toContain(join('_components', 'etats.tsx'));
    expect(noms.some((n) => n.endsWith('api-accounting.ts'))).toBe(true);
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  it('aucun mot interdit : conforme, certifié, définitif, liasse', () => {
    const fautes = SOURCES.flatMap((f) =>
      findForbiddenAccountingWords(readFileSync(f, 'utf8')).map(
        (m) => `${relative(RACINE_APP, f)} : ${m}`,
      ),
    );
    expect(fautes).toEqual([]);
  });

  it('le détecteur trouve bien les formes fléchies (garde-fou du test)', () => {
    expect(
      findForbiddenAccountingWords('Bilan Définitif, comptes CERTIFIÉS, conformité, liasses'),
    ).toEqual(['conforme', 'certifié', 'définitif', 'liasse']);
    expect(findForbiddenAccountingWords(ACCOUNTING_DISCLAIMER)).toEqual([]);
  });

  it('« déclaration » seulement dans « déclaration de relecture »', () => {
    const fautes: string[] = [];
    for (const f of SOURCES) {
      const texte = readFileSync(f, 'utf8').replace(/\s+/g, ' ');
      for (const m of texte.matchAll(/[dD][ée]claration(?! de relecture)/g)) {
        fautes.push(`${relative(RACINE_APP, f)} : ${texte.slice(m.index, m.index + 40)}`);
      }
    }
    expect(fautes).toEqual([]);
  });

  it('aucun numéro de compte candidat écrit en dur', () => {
    // Candidats du § 2.1.1 (à confirmer par l'expert) : ils ne viennent QUE du pack.
    const candidats = ['411', '401', '4431', '4452', '521', '571', '585', '601', '701', '706'];
    const fautes: string[] = [];
    for (const f of SOURCES) {
      const texte = readFileSync(f, 'utf8');
      for (const n of candidats) {
        if (new RegExp(`(?<![\\d.,#-])${n}(?![\\d])`).test(texte)) {
          fautes.push(`${relative(RACINE_APP, f)} : ${n}`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  it('les bandeaux viennent de shared, jamais recopiés dans l’application', () => {
    for (const f of SOURCES) {
      const texte = readFileSync(f, 'utf8');
      expect(texte.includes(ACCOUNTING_DISCLAIMER)).toBe(false);
      expect(texte.includes(ACCOUNTING_MODE_BANNERS.simulation)).toBe(false);
    }
  });
});

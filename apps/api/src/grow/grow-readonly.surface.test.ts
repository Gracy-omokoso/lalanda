// « GROW lit, il n'écrit jamais dans BUILD ni dans RUN » (ADR-0032 § 1).
//
// Un test de comportement ne prouverait cette règle que pour les routes qu'il
// monte. Celui-ci vérifie la SURFACE : il lit les sources du module et échoue si
// une méthode d'écriture Mongoose vise autre chose que le modèle de la fiche GROW
// (`profileModel`), ou si le module ouvre une collection brute.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('.', import.meta.url));

/** Méthodes Mongoose qui écrivent. */
const WRITES = [
  'create',
  'insertMany',
  'insertOne',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'findByIdAndUpdate',
  'findByIdAndDelete',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
  'save',
];

/** Le seul modèle que GROW a le droit d'écrire. */
const WRITABLE = 'profileModel';

const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), 'utf8') }));

describe('GROW est en lecture seule sur BUILD et RUN', () => {
  it('lit bien des sources (le test ne tourne pas à vide)', () => {
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining(['grow-reader.service.ts', 'grow-profile.service.ts']),
    );
  });

  it('toute écriture Mongoose vise `profileModel`, et rien d’autre', () => {
    const pattern = new RegExp(`this\\.(\\w+)\\s*\\.\\s*(${WRITES.join('|')})\\s*\\(`, 'g');
    const offenders: string[] = [];
    let writes = 0;
    for (const { file, text } of sources) {
      for (const m of text.matchAll(pattern)) {
        writes += 1;
        if (m[1] !== WRITABLE) offenders.push(`${file} : this.${m[1]}.${m[2]}()`);
      }
    }
    expect(offenders).toEqual([]);
    // Les écritures de la fiche existent : le motif reconnaît bien les appels.
    expect(writes).toBeGreaterThan(0);
  });

  it('les modèles de BUILD et de RUN ne servent qu’à lire', () => {
    const readOnly = ['projects', 'plans', 'actuals', 'invoices', 'catalog'];
    const allowed = ['find', 'findOne', 'countDocuments', 'exists', 'findById'];
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/this\.(\w+)\s*\.\s*(\w+)\s*\(/g)) {
        if (readOnly.includes(m[1]!) && !allowed.includes(m[2]!)) {
          offenders.push(`${file} : this.${m[1]}.${m[2]}()`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('aucune collection brute, aucune session d’écriture', () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/\.collection\s*\(/);
      expect(text, file).not.toMatch(/\.save\s*\(/);
      expect(text, file).not.toMatch(/InjectConnection/);
    }
  });
});

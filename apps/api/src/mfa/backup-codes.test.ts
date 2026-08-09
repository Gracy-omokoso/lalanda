import { describe, expect, it } from 'vitest';

import {
  BACKUP_CODE_COUNT,
  BACKUP_CODE_LENGTH,
  findBackupCodeIndex,
  formatBackupCode,
  generateBackupCode,
  generateBackupCodeSet,
  hashBackupCode,
  normalizeBackupCode,
} from './backup-codes.js';

describe('génération des codes de secours', () => {
  it('produit le nombre attendu de codes, tous distincts', () => {
    const jeu = generateBackupCodeSet();
    expect(jeu.plain).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(jeu.plain).size).toBe(BACKUP_CODE_COUNT);
    expect(jeu.hashes).toHaveLength(BACKUP_CODE_COUNT);
  });

  it('n’utilise aucun caractère ambigu (I, L, O, U, 0, 1)', () => {
    // Un code recopié à la main depuis un papier : `O` lu `0` rend le code
    // inutilisable au moment précis où il est le dernier recours.
    for (let i = 0; i < 500; i += 1) {
      expect(generateBackupCode()).toMatch(new RegExp(`^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{${BACKUP_CODE_LENGTH}}$`));
    }
  });

  it('deux jeux consécutifs ne partagent ni sel ni code', () => {
    const a = generateBackupCodeSet();
    const b = generateBackupCodeSet();
    expect(a.salt).not.toBe(b.salt);
    expect(a.plain.filter((c) => b.plain.includes(c))).toEqual([]);
  });

  it('aucun code en clair ne survit dans les empreintes', () => {
    // Vérification grossière mais utile : une régression qui rangerait le code
    // à la place de son empreinte passerait tous les autres tests.
    const jeu = generateBackupCodeSet();
    const serialise = JSON.stringify({ salt: jeu.salt, hashes: jeu.hashes });
    for (const code of jeu.plain) {
      expect(serialise).not.toContain(code);
    }
  });
});

describe('vérification d’un code de secours', () => {
  it('retrouve chaque code à sa position', () => {
    const jeu = generateBackupCodeSet();
    jeu.plain.forEach((code, index) => {
      expect(findBackupCodeIndex(code, jeu.salt, jeu.hashes)).toBe(index);
    });
  });

  it('tolère la casse, les espaces et le tiret d’affichage', () => {
    const jeu = generateBackupCodeSet();
    const code = jeu.plain[3]!;
    expect(findBackupCodeIndex(code.toLowerCase(), jeu.salt, jeu.hashes)).toBe(3);
    expect(findBackupCodeIndex(formatBackupCode(code), jeu.salt, jeu.hashes)).toBe(3);
    expect(findBackupCodeIndex(` ${code} `, jeu.salt, jeu.hashes)).toBe(3);
  });

  it('refuse un code inconnu, vide ou de mauvaise longueur', () => {
    const jeu = generateBackupCodeSet();
    for (const saisie of ['', 'ABC', 'ABCDEFGHJK', 'X'.repeat(30), '../../etc/passwd']) {
      // `ABCDEFGHJK` a la bonne longueur mais n'est pas dans le jeu : la
      // probabilité qu'il y soit est de 10 / 2^50.
      expect(findBackupCodeIndex(saisie, jeu.salt, jeu.hashes), saisie).toBe(-1);
    }
  });

  it('refuse un code d’un AUTRE jeu — le sel isole les jeux', () => {
    const a = generateBackupCodeSet();
    const b = generateBackupCodeSet();
    expect(findBackupCodeIndex(a.plain[0]!, b.salt, b.hashes)).toBe(-1);
  });

  it('un code retiré du jeu n’est plus reconnu — socle de la consommation', () => {
    // La consommation réelle est atomique en base (voir `mfa.service.ts`). Ce
    // test verrouille la moitié pure : retirer l'empreinte suffit à invalider.
    const jeu = generateBackupCodeSet();
    const code = jeu.plain[0]!;
    const restants = jeu.hashes.slice(1);
    expect(findBackupCodeIndex(code, jeu.salt, jeu.hashes)).toBe(0);
    expect(findBackupCodeIndex(code, jeu.salt, restants)).toBe(-1);
  });

  it('l’empreinte est déterministe pour un sel donné, et change avec le sel', () => {
    const jeu = generateBackupCodeSet();
    const code = jeu.plain[0]!;
    expect(hashBackupCode(code, jeu.salt)).toBe(hashBackupCode(code, jeu.salt));
    const autre = generateBackupCodeSet();
    expect(hashBackupCode(code, jeu.salt)).not.toBe(hashBackupCode(code, autre.salt));
  });

  it('la normalisation est celle utilisée au hachage', () => {
    const jeu = generateBackupCodeSet();
    const code = jeu.plain[0]!;
    expect(hashBackupCode(code.toLowerCase(), jeu.salt)).toBe(hashBackupCode(code, jeu.salt));
    expect(normalizeBackupCode(' ab-cd ')).toBe('ABCD');
  });
});

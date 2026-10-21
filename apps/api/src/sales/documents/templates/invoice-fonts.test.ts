// Polices des modèles : présentes, sous licence, jamais remplacées en place (ADR-0028 § 5).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FONTS, FONTS_DIR, FONT_IDS, fontFaceCss, fontFilePath } from './invoice-fonts.js';

/**
 * Empreintes FIGÉES. Une facture gelée se réimprime avec ces octets : remplacer
 * un fichier ferait changer un PDF déjà émis. Une police mise à jour entre sous
 * un NOUVEAU nom de fichier, avec une nouvelle version de modèle.
 */
const SHA256: Record<string, string> = {
  'fraunces/fraunces-latin-300-normal.woff2':
    'eb7978600911337e093a9b339e355a5493c4a2a6609af2839e8298c0b5444174',
  'fraunces/fraunces-latin-400-italic.woff2':
    '475b154af19c6b4ef371db22078b5044a078ce2467e11ef22a7b87f77837caf3',
  'fraunces/fraunces-latin-400-normal.woff2':
    'e558f39453a9c611908be04294b50dea5f21ae6c49b41c6e47f4115e91f90209',
  'fraunces/fraunces-latin-600-normal.woff2':
    '3a1de7711d147bad4422825045f87597fd77cca72e7c96d3b0a81735d00dda82',
  'fraunces/fraunces-latin-700-normal.woff2':
    'c38570d224b830056e69484bb9e768e1d3fa7ba4755c8891a3c6d366194d2ff3',
  'ibm-plex-sans/ibm-plex-sans-latin-300-normal.woff2':
    'c4557c8a3ca4284da9445c144dd302689b723a6b95e5e4e140211a6132d8e0be',
  'ibm-plex-sans/ibm-plex-sans-latin-400-italic.woff2':
    '6de912e531b6c98084f1b2d5e5a91bad77be4e68bc4e396e43c46fc435e5f3d9',
  'ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2':
    '3b646991d30055a93a4ecc499713d4347953a74a947ecab435ab72070cbdab0e',
  'ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2':
    '0717336fb31fcdcde4b8deb3675bb4a0f7f6d484864afcd6751ac29975962203',
  'ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2':
    '8960851d691c054ed38e259bdcf1a6190d157b4203ed5bb32c632a863fb8ec2f',
  'ibm-plex-sans/ibm-plex-sans-latin-700-normal.woff2':
    '42e7b0c143c19df9d99fd896e76b48f846edf0902d200bc29796b34d12c33aa7',
  'inter/inter-latin-300-normal.woff2':
    'be0276550393a72b94d673505567dceba801511d5e1ca5a87793190dc5d5a6ca',
  'inter/inter-latin-400-italic.woff2':
    '7ea9d2f1274cebee837f0c6eebb426c18fbb2333a6b6da4d02ec5cf47db7fb8e',
  'inter/inter-latin-400-normal.woff2':
    '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc',
  'inter/inter-latin-500-normal.woff2':
    'f3779f1efccc4bdcdf9c0a02ab95bf6bd092ed09c48c08cedc725889edd1d19f',
  'inter/inter-latin-600-normal.woff2':
    'f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a',
  'inter/inter-latin-700-normal.woff2':
    '6f56409fd3d64bb85f7d070bce20749db2d66b6d63cec586cc22d1c761be2491',
  'inter/inter-latin-800-normal.woff2':
    'a7d0a50f15d389cad679238466bdb5fc9787aa0715719064ce25abaff042820d',
  'jetbrains-mono/jetbrains-mono-latin-500-normal.woff2':
    'cb182feeed4d798ff6961d3c79f7026279448fca0676438aaecb21f3fc39553a',
  'jetbrains-mono/jetbrains-mono-latin-700-normal.woff2':
    'd0d4e818808f2a0ba39b2b09d1989366f63494e295f003c7ef436697378507e8',
  'manrope/manrope-latin-300-normal.woff2':
    'd4a8e9c72113653a7360ca4d1eba83420c4e1b0ca1ad3945c93592b533f48a8f',
  'manrope/manrope-latin-400-normal.woff2':
    '849290ef12a2eeb9af5c11924120d11aa4ae8b435ed3347d7fc8bc240c293ca3',
  'manrope/manrope-latin-500-normal.woff2':
    '19874318747181a650eda439c37955220b849d9c4797c9e0718ee67d4bf929bc',
  'manrope/manrope-latin-600-normal.woff2':
    'f7ac6258da20ab7541939b59851155753d1d24f1b30cbcb949077a3faa3d1593',
  'manrope/manrope-latin-700-normal.woff2':
    'd2a12c85a831e4b5db341767d0347fa3d1361d22a1fcb3e361a16b6c90080f71',
  'manrope/manrope-latin-800-normal.woff2':
    '74c161dbcbce7c3590803cc72dc1f63313c360e13367aba5075a7b7b3818ea49',
  'source-serif-4/source-serif-4-latin-300-normal.woff2':
    '4643b116b3cff93fe315f7f8b849e36ef7e68e050ee4c52d6d60f183fc92c870',
  'source-serif-4/source-serif-4-latin-400-italic.woff2':
    '882b7c150c29f29d4f8daae6b8dcae8662aac7f28ca34b34615305154136ecfd',
  'source-serif-4/source-serif-4-latin-400-normal.woff2':
    '02194deb92d3975dd30e11a3824a1f1db32b48c93654e60560cb81ce8e7b5f95',
  'source-serif-4/source-serif-4-latin-600-normal.woff2':
    'f2b7e1cf1d277b7608231868135648f8ad8e2b58d8e97ca088bee15dc357bee7',
  'source-serif-4/source-serif-4-latin-700-normal.woff2':
    '7691c51bc286a9014db0048277d2c3f2ad0a90b533dc8adfb16cb22a95390d39',
  'source-serif-4/source-serif-4-latin-800-normal.woff2':
    '96c9b28d61407078182d1d11ce2838ae99e035c44e9c29471ecf1148914ba16b',
};

describe('polices intégrées (OFL-1.1)', () => {
  it('chaque fichier déclaré existe et garde son empreinte figée', () => {
    const declared: string[] = [];
    for (const id of FONT_IDS) {
      for (const f of FONTS[id].files) {
        const rel = `${FONTS[id].dir}/${f.file}`;
        declared.push(rel);
        const path = fontFilePath(id, f.file);
        expect(existsSync(path), rel).toBe(true);
        const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
        expect(sha, rel).toBe(SHA256[rel]);
      }
    }
    expect(declared.sort()).toEqual(Object.keys(SHA256).sort());
  });

  it('chaque famille porte sa licence OFL, et le dossier sa notice', () => {
    for (const id of FONT_IDS) {
      const ofl = readFileSync(resolve(FONTS_DIR, FONTS[id].dir, 'OFL.txt'), 'utf8');
      expect(ofl, id).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
    const notice = readFileSync(resolve(FONTS_DIR, 'NOTICE.md'), 'utf8');
    for (const id of FONT_IDS) expect(notice).toContain(FONTS[id].label);
    // Aucun fichier de police non déclaré (donc non vérifié) dans le dossier.
    for (const id of FONT_IDS) {
      const files = readdirSync(resolve(FONTS_DIR, FONTS[id].dir)).filter((f) =>
        f.endsWith('.woff2'),
      );
      expect(files.sort()).toEqual(FONTS[id].files.map((f) => f.file).sort());
    }
  });

  it('@font-face intégré en data: — aucune URL distante', () => {
    const css = fontFaceCss('inter');
    expect(css).toContain('src:url(data:font/woff2;base64,');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toContain("font-family:'Lalanda Inter'");
  });
});

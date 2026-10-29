// Tests unitaires du module « work » (ADR-0039, lot L1) : fonctions pures, sans
// base ni application.

import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { boundedData } from './work-activity.service.js';
import {
  classifyAttachment,
  contentDisposition,
  sanitizeFileName,
} from './work-attachments.service.js';
import { workAttachmentObjectKey } from './work-attachments.storage.js';
import { boundedTitle } from './work-notifier.js';
import { kinshasaHour } from './work-reminders.job.js';
import { isoWeekStart } from './work-time.service.js';
import {
  WorkIdPipe,
  afterAscCursor,
  decodeAscCursor,
  encodeAscCursor,
  taskHref,
} from './work.common.js';

function statusOf(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), code: (err.getResponse() as { code: string }).code };
    }
    throw err;
  }
  throw new Error('aucune exception levée');
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
function png(extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('pièces jointes — type déduit du contenu (ADR-0039 § 2.5)', () => {
  it('une image PNG est reconstruite : les métadonnées (tEXt) disparaissent', () => {
    const secret = chunk('tEXt', Buffer.from('Author\0Secret GPS', 'latin1'));
    const out = classifyAttachment(png([secret]));
    expect(out.contentType).toBe('image/png');
    expect(out.bytes.includes(Buffer.from('Secret GPS'))).toBe(false);
  });

  it('un PDF est reconnu par sa signature et gardé tel quel', () => {
    const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
    const out = classifyAttachment(pdf);
    expect(out.contentType).toBe('application/pdf');
    expect(out.bytes.equals(pdf)).toBe(true);
  });

  it('du HTML (même nommé .pdf) est refusé 415 WORK_ATTACHMENT_TYPE', () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
    expect(statusOf(() => classifyAttachment(html))).toEqual({
      status: 415,
      code: 'WORK_ATTACHMENT_TYPE',
    });
  });

  it('un fichier vide est refusé 400 ; une image de plus de 2 Mio, 413', () => {
    expect(statusOf(() => classifyAttachment(Buffer.alloc(0))).status).toBe(400);
    const big = Buffer.concat([png(), Buffer.alloc(2 * 1024 * 1024)]);
    expect(statusOf(() => classifyAttachment(big))).toEqual({
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
  });

  it('un PDF de plus de 10 Mio est refusé 413', () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]);
    expect(statusOf(() => classifyAttachment(big)).status).toBe(413);
  });

  it('le nom est assaini : chemins, contrôles, longueur ; vide → nom par défaut', () => {
    expect(sanitizeFileName(encodeURIComponent('../../etc/passwd'), 'application/pdf')).toBe(
      '_.._etc_passwd',
    );
    expect(sanitizeFileName('a%00b%0Ac.pdf', 'application/pdf')).toBe('abc.pdf');
    expect(sanitizeFileName(encodeURIComponent('Devis été.pdf'), 'application/pdf')).toBe(
      'Devis été.pdf',
    );
    expect(sanitizeFileName(undefined, 'image/png')).toBe('piece-jointe.png');
    expect(sanitizeFileName('%E0%A4%A', 'image/png')).toBe('%E0%A4%A');
    expect(sanitizeFileName('x'.repeat(500), 'image/png')).toHaveLength(200);
  });

  it('Content-Disposition : forme ASCII sûre et forme UTF-8', () => {
    expect(contentDisposition('attachment', 'Devis "été".pdf')).toBe(
      `attachment; filename="Devis __t__.pdf"; filename*=UTF-8''Devis%20%22%C3%A9t%C3%A9%22.pdf`,
    );
  });

  it('la clé d’objet ne dérive que de l’identifiant tiré au hasard', () => {
    expect(workAttachmentObjectKey('ab'.repeat(16))).toBe(`work-attachments/${'ab'.repeat(16)}`);
  });
});

describe('outils du module', () => {
  it('semaine ISO : le lundi de la semaine', () => {
    expect(isoWeekStart('2026-10-29')).toBe('2026-10-26'); // jeudi
    expect(isoWeekStart('2026-10-26')).toBe('2026-10-26'); // lundi
    expect(isoWeekStart('2026-11-01')).toBe('2026-10-26'); // dimanche
  });

  it('heure de Kinshasa : UTC+1', () => {
    expect(kinshasaHour(new Date('2026-10-29T05:59:00Z'))).toBe(6);
    expect(kinshasaHour(new Date('2026-10-29T06:00:00Z'))).toBe(7);
    expect(kinshasaHour(new Date('2026-10-29T23:30:00Z'))).toBe(0);
  });

  it('historique : différentiel borné à 2 Kio', () => {
    expect(boundedData({ from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b' });
    expect(boundedData({ big: 'x'.repeat(3000) })).toEqual({ truncated: true });
  });

  it('titre de notification borné à 200 caractères', () => {
    expect(boundedTitle('court')).toBe('court');
    const long = boundedTitle('x'.repeat(250));
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('lien de tâche relatif', () => {
    expect(taskHref('p1', 't1')).toBe('/projets/p1?tache=t1');
  });

  it('identifiant de chemin ramené en minuscules', () => {
    const pipe = new WorkIdPipe();
    expect(pipe.transform('ABCDEF0123456789ABCDEF01')).toBe('abcdef0123456789abcdef01');
    expect(pipe.transform('pas-un-id')).toBe('pas-un-id');
  });

  it('curseur croissant : aller-retour, altération refusée', () => {
    const at = new Date('2026-10-29T10:00:00.000Z');
    const id = '0123456789abcdef01234567';
    const raw = encodeAscCursor(at, id);
    const back = decodeAscCursor(raw);
    expect(back?.at.toISOString()).toBe(at.toISOString());
    expect(String(back?.id)).toBe(id);
    expect(decodeAscCursor(`${raw}x`)).toBeNull();
    expect(decodeAscCursor('!!')).toBeNull();
    expect(afterAscCursor('createdAt', back!)).toHaveProperty('$or');
  });
});

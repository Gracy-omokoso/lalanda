// Recadrage exact d'une capture PNG et densité 300 dpi déclarée — ADR-0069 § 1.
//
// Chromium arrondit la zone de capture au pixel CSS : une carte de 85,60 mm
// (323,5 px CSS) sort en 1 013 px au lieu de 1 011 à 300 dpi. On décode la
// capture (PNG 8 bits RGB/RGBA non entrelacé, ce que produit Chromium), on la
// recadre aux pixels exacts et on la réencode avec un bloc `pHYs` (11 811 px/m =
// 300 dpi), que les logiciels d'impression lisent. Aucune dépendance : `node:zlib`.
// Entrée de CONFIANCE (notre propre capture) ; une entrée inattendue lève.

import { deflateSync, inflateSync } from 'node:zlib';

import { crc32 } from '../../security/zip-reader.js';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function cropPng(png: Buffer, width: number, height: number, dpi = 300): Buffer {
  if (!png.subarray(0, 8).equals(SIG)) throw new Error('PNG attendu.');
  let off = 8;
  let w = 0;
  let h = 0;
  let bpp = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
        throw new Error('Capture PNG d’un format inattendu.');
      }
      bpp = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[src + x]!;
      const a = x >= bpp ? out[dst + x - bpp]! : 0;
      const b = y > 0 ? out[dst - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp]! : 0;
      let r: number;
      switch (f) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4:
          r = v + paeth(a, b, c);
          break;
        default:
          throw new Error('Filtre PNG inconnu.');
      }
      out[dst + x] = r & 255;
    }
  }
  const cw = Math.min(width, w);
  const ch = Math.min(height, h);
  const cstride = cw * bpp;
  const rows = Buffer.alloc(ch * (cstride + 1));
  for (let y = 0; y < ch; y += 1) {
    rows[y * (cstride + 1)] = 0;
    out.copy(rows, y * (cstride + 1) + 1, y * stride, y * stride + cstride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cw, 0);
  ihdr.writeUInt32BE(ch, 4);
  ihdr[8] = 8;
  ihdr[9] = bpp === 4 ? 6 : 2;
  const phys = Buffer.alloc(9);
  const ppm = Math.round(dpi / 0.0254);
  phys.writeUInt32BE(ppm, 0);
  phys.writeUInt32BE(ppm, 4);
  phys[8] = 1;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('pHYs', phys),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

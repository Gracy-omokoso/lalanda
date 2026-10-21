// Données de test des modèles de facture (ADR-0028) : documents de chaque
// sorte, logos PNG réels (décodables par Chromium), identité fictive.

import { deflateSync } from 'node:zlib';

import type { InvoiceLean } from '../../invoices/invoice.types.js';
import {
  buildInvoiceDocument,
  type InvoiceDocumentContext,
  type InvoiceDocumentModel,
} from '../invoice-document.model.js';
import {
  LOGO_VARIANTS,
  type FrozenIdentity,
  type InvoiceTemplate,
  type LogoVariant,
  type RenderLogo,
} from '../templates/template.contract.js';
import {
  draftUsd,
  issuedStandard,
  normalizedProduction,
  normalizedTest,
} from './invoice-fixtures.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG RVB VALIDE (décodable) : un carré de couleur avec un cadre. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // RVB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const edge = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const [r, g, b] = edge ? [255, 255, 255] : rgb;
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const COLORS: Record<LogoVariant, [number, number, number]> = {
  primary: [15, 81, 50],
  horizontal: [29, 78, 216],
  symbol: [154, 52, 18],
  light: [240, 240, 240],
};
const SIZES: Record<LogoVariant, [number, number]> = {
  primary: [96, 96],
  horizontal: [240, 64],
  symbol: [64, 64],
  light: [96, 96],
};

export function testLogoBytes(v: LogoVariant): Buffer {
  const [w, h] = SIZES[v];
  return solidPng(w, h, COLORS[v]);
}

export function renderLogos(withLogos: boolean): Record<LogoVariant, RenderLogo | null> {
  const out = {} as Record<LogoVariant, RenderLogo | null>;
  for (const v of LOGO_VARIANTS) {
    const [w, h] = SIZES[v];
    out[v] = withLogos
      ? {
          dataUri: `data:image/png;base64,${testLogoBytes(v).toString('base64')}`,
          width: w,
          height: h,
        }
      : null;
  }
  return out;
}

export const IDENTITY: FrozenIdentity = {
  primaryColor: '#0f5132',
  secondaryColor: '#9a3412',
  font: 'inter',
  logos: { primary: null, horizontal: null, symbol: null, light: null },
};

const CTX: InvoiceDocumentContext = {
  duplicateNumber: null,
  draftSeller: null,
  organizationName: 'Exemple SARL',
  draftInTestEnvironment: false,
};

/** Modèle d'un document, imprimé par `template` (nommé en pied de page). */
export function modelFor(
  doc: InvoiceLean,
  template: InvoiceTemplate | null,
  ctx: Partial<InvoiceDocumentContext> = {},
): InvoiceDocumentModel {
  return buildInvoiceDocument(doc, {
    ...CTX,
    ...(template ? { layout: { label: template.label, version: template.version } } : {}),
    ...ctx,
  });
}

/** Tous les documents qu'un modèle doit savoir imprimer, nommés. */
export function documentCases(
  template: InvoiceTemplate | null,
): Array<[string, InvoiceDocumentModel]> {
  const credit = normalizedTest({
    type: 'FA',
    creditNote: {
      nature: 'RAN',
      originInvoiceId: 'x',
      originNumber: 'TEST-2026-000001',
      reference: 'ABCD-1234-EFGH-5678-IJKL-9012',
    },
  });
  const rich = richModel(template);
  return [
    [
      'facture normalisée de test',
      modelFor(normalizedTest({ softwareVersion: '0.9.3' }), template),
    ],
    ['facture normalisée de production', modelFor(normalizedProduction(), template)],
    ['duplicata n° 2', modelFor(normalizedTest(), template, { duplicateNumber: 2 })],
    ['pro forma (brouillon USD)', modelFor(draftUsd(), template)],
    [
      'pro forma en test (normalisation en cours)',
      modelFor({ ...normalizedTest(), status: 'pending_normalization' } as InvoiceLean, template),
    ],
    ['facture ordinaire', modelFor(issuedStandard(), template)],
    ['facture d’avoir normalisée', modelFor(credit, template)],
    ['acompte à l’exportation', modelFor(normalizedTest({ type: 'ET' }), template)],
    ['aperçu EXEMPLE', modelFor(normalizedProduction(), template, { sample: true })],
    ['document riche (30 lignes, taxes, commentaires)', rich],
  ];
}

/**
 * Document au contenu maximal : 30 lignes (plusieurs pages), modifications de
 * prix, taxe spécifique, deux paiements, commentaires, coordonnées du client,
 * caractères à échapper.
 */
export function richModel(template: InvoiceTemplate | null): InvoiceDocumentModel {
  const base = modelFor(normalizedTest(), template);
  const lines = Array.from({ length: 30 }, (_, i) => ({
    ...base.lines[0]!,
    name: `Article n° ${i + 1} — « spécial » <b>&</b>`,
    code: `ART-${String(i + 1).padStart(3, '0')}`,
    modification: i % 3 === 0 ? 'Prix d’origine 100 000,00 — remise 10 %' : null,
    specificTax: i % 5 === 0 ? 'T.S. 1 250,00' : null,
  }));
  return {
    ...base,
    lines,
    customer: {
      ...base.customer,
      lines: [...base.customer.lines, '2, avenue Cliente, Kinshasa', '+243 800 000 001'],
    },
    specificTaxTotal: '7 500,00',
    payments: [
      { label: 'Virement', amount: '150 000,00' },
      { label: 'Espèces', amount: '59 943,30' },
    ],
    comments: ['Réf. Exo. : EXO-1', 'Livraison le 22/10/2026'],
    operator: 'Comptable <Exemple>',
  };
}

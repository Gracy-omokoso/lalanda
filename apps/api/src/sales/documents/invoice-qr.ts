// QR code d'une facture normalisée — ADR-0025 § 5.
//
// La chaîne `normalization.qrCode` renvoyée par l'e-MCF est encodée TELLE
// QUELLE : aucune reconstruction, aucune transformation (ni majuscules, ni
// espaces retirés). Niveau de correction M (15 %), annoncé par la DGI. Rendu SVG
// vectoriel inline : aucune image distante (le rendu Chromium n'en charge
// aucune, S22e), net à toutes les tailles d'impression.

import QRCode from 'qrcode';

/** Niveau de correction d'erreur imposé par la DGI. */
export const QR_ERROR_CORRECTION = 'M' as const;

/** Zone de silence, en modules (valeur recommandée par la norme QR). */
export const QR_MARGIN_MODULES = 4;

/** SVG du QR code de `content`, encodé tel quel. Déterministe. */
export async function qrCodeSvg(content: string): Promise<string> {
  if (content === '') throw new Error('Contenu du QR code vide.');
  return QRCode.toString(content, {
    type: 'svg',
    errorCorrectionLevel: QR_ERROR_CORRECTION,
    margin: QR_MARGIN_MODULES,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/**
 * Contenu effectivement encodé (segments du symbole, recollés) : sert aux tests
 * à prouver que le QR porte exactement `qrCode`.
 */
export function qrCodeEncodedContent(content: string): string {
  const symbol = QRCode.create(content, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  return symbol.segments
    .map((s) => {
      const data: unknown = (s as { data: unknown }).data;
      return typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8');
    })
    .join('');
}

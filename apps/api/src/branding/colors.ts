// Couleurs de l'identité visuelle — ADR-0028 § 3.
//
// Mélanges et contrastes (WCAG 2.x) des couleurs de marque, utilisés par les
// modèles de facture. Fonctions PURES : mêmes entrées ⇒ mêmes couleurs, donc
// même PDF. Rien ici ne touche à un montant.

export type HexColor = string;

const WHITE = '#ffffff';
const INK = '#111111';

function rgb(hex: HexColor): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function toHex(ch: number[]): HexColor {
  return `#${ch.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mélange vers le blanc : `t = 0` → la couleur, `t = 1` → blanc. */
export function tint(hex: HexColor, t: number): HexColor {
  return toHex(rgb(hex).map((v) => v + (255 - v) * t));
}

/** Luminance relative WCAG 2.x. */
function luminance(hex: HexColor): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: HexColor, b: HexColor): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Texte lisible sur un fond de couleur : blanc si le contraste atteint 4,5:1
 * (WCAG AA), sinon encre. Une couleur de marque très claire (jaune) ne rend
 * donc jamais un bandeau illisible.
 */
export function readableOn(background: HexColor): HexColor {
  return contrastRatio(background, WHITE) >= 4.5 ? WHITE : INK;
}

/** Couleur d'accent utilisable comme TEXTE sur fond blanc (assombrie si trop claire). */
export function inkSafe(hex: HexColor): HexColor {
  let c = hex;
  for (let i = 0; i < 10 && contrastRatio(c, WHITE) < 4.5; i += 1) {
    c = toHex(rgb(c).map((v) => v * 0.8));
  }
  return c;
}

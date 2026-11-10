// Logique pure de l'identité visuelle (ADR-0028 § 7) — testée sans DOM.
//
// Rien ici n'autorise ni ne valide pour de bon : l'API reste seule juge (type
// d'image déduit du contenu, SVG refusé, couleurs `#RRGGBB`, police en liste
// fermée). Ce module évite seulement d'envoyer ce qui serait refusé.

import { markVariantFor, patternDataUri, type LogoChoice } from '@lalanda/shared/branding';

import type { LogoVariant } from '@/lib/api';

/** Usage de chaque déclinaison, dit à l'utilisateur. */
export const LOGO_VARIANT_HINTS: Record<LogoVariant, string> = {
  primary: 'Le logo carré complet : c’est lui qu’impriment les documents en « Logo carré ».',
  horizontal: 'Logo et nom sur une ligne : imprimé partout en « Logo horizontal ».',
  symbol: 'Le symbole seul : remplace le logo carré s’il manque.',
  light: 'Version claire, posée sur un fond de couleur (bandeaux, colonnes, cartes sombres).',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `#RRGGBB` (casse libre) → minuscules ; `''` → `null` ; autre → `undefined` (invalide). */
export function couleurSaisie(v: string): string | null | undefined {
  const t = v.trim();
  if (t === '') return null;
  return HEX.test(t) ? t.toLowerCase() : undefined;
}

export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Kio`;
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mio`;
}

/** Attribut `accept` d'un champ fichier : les types servis par l'API, jamais le SVG. */
export function accepte(types: readonly string[]): string {
  return types.filter((t) => t !== 'image/svg+xml').join(',');
}

/**
 * Pré-contrôle d'un fichier choisi, AVANT l'envoi : taille et type annoncé. Le
 * serveur refait tout sur le contenu ; ceci épargne seulement un aller-retour.
 */
export function preControleFichier(
  f: { size: number; type: string; name: string },
  limites: { maxBytes: number; acceptedTypes: readonly string[] },
): string | null {
  if (f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg')) {
    return 'Le SVG n’est pas accepté (c’est un document exécutable). Exportez votre logo en PNG.';
  }
  if (f.size > limites.maxBytes) {
    return `Fichier trop lourd (${tailleLisible(f.size)}) : ${tailleLisible(limites.maxBytes)} au plus.`;
  }
  if (f.type !== '' && !limites.acceptedTypes.includes(f.type)) {
    return 'Format non accepté : PNG, JPEG ou WebP.';
  }
  return null;
}

// ── Identité visuelle v2 (ADR-0073) ─────────────────────────────────────────

/** Déclinaison réellement imprimée pour un choix, d'après les logos présents. */
export function varianteImprimee(
  choix: LogoChoice,
  logos: Record<LogoVariant, unknown>,
): 'primary' | 'horizontal' | 'symbol' | null {
  return markVariantFor(choix, {
    primary: Boolean(logos.primary),
    horizontal: Boolean(logos.horizontal),
    symbol: Boolean(logos.symbol),
  });
}

/** Pré-contrôle d'un favicon ou d'un motif : PNG seulement, taille bornée. */
export function preControlePng(
  f: { size: number; type: string; name: string },
  maxBytes: number,
): string | null {
  if (f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg')) {
    return 'Le SVG n’est pas accepté : exportez l’image en PNG.';
  }
  if (f.type !== '' && f.type !== 'image/png') return 'Format attendu : PNG.';
  if (f.size > maxBytes) {
    return `Fichier trop lourd (${tailleLisible(f.size)}) : ${tailleLisible(maxBytes)} au plus.`;
  }
  return null;
}

/** Motif de la bibliothèque en `data:` pour une vignette (même SVG que les PDF). */
export function vignetteMotif(id: string, couleur: string | null): string {
  const c = couleur && /^#[0-9a-f]{6}$/.test(couleur) ? couleur : '#1f4e79';
  return patternDataUri(id, c);
}

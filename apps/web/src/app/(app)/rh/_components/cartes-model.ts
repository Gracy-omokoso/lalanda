// Logique d'écran des cartes de service et de visite — ADR-0069. Pure, testée.

import type {
  CardKind,
  CardProfileView,
  CardTemplateSummary,
  CardVariant,
} from '@/lib/api-hr-cards';

export const LIBELLE_TYPE: Record<CardKind, string> = {
  badge: 'Carte de service',
  business: 'Carte de visite',
};

export const LIBELLE_VARIANTE: Record<CardVariant, string> = {
  brand: 'Couleurs de la marque',
  mono: 'Noir et blanc',
  inverse: 'Fond sombre',
};

export const LIBELLE_ORIENTATION = { horizontal: 'Horizontale', vertical: 'Verticale' } as const;

/** Modèles d'un type, Lalanda d'abord, horizontaux puis verticaux. */
export function modelesDe(
  templates: readonly CardTemplateSummary[],
  kind: CardKind,
): CardTemplateSummary[] {
  const rang = (t: CardTemplateSummary) =>
    (t.source === 'lalanda' ? 0 : 2) + (t.orientation === 'horizontal' ? 0 : 1);
  return templates
    .filter((t) => t.kind === kind)
    .slice()
    .sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, 'fr'));
}

/** Ce que dirait la page publique, en clair, pour les RH. */
export function statutPublic(p: CardProfileView): {
  texte: string;
  ton: 'success' | 'warning' | 'neutral';
} {
  switch (p.publicStatus) {
    case 'active':
      return { texte: 'Vérification : « En fonction »', ton: 'success' };
    case 'inactive':
      return { texte: 'Vérification : « N’est plus en fonction »', ton: 'warning' };
    default:
      return { texte: 'Aucune carte valide', ton: 'neutral' };
  }
}

/** Phrase d'état du consentement à la photo. */
export function phraseConsentement(p: CardProfileView): string {
  if (!p.consent.photo)
    return 'Aucun consentement enregistré : la carte s’imprime sans photo (initiales).';
  const date = p.consent.at ? new Date(p.consent.at).toLocaleDateString('fr-FR') : '';
  return p.consent.photoPublic
    ? `Consentement enregistré le ${date}, photo visible aussi sur la page de vérification.`
    : `Consentement enregistré le ${date}, photo sur la carte seulement (pas sur la page de vérification).`;
}

/** Le jeton (dernier segment de l'URL) n'est jamais affiché en entier. */
export function urlMasquee(url: string | null): string | null {
  if (!url) return null;
  const i = url.lastIndexOf('/');
  const token = url.slice(i + 1);
  return `${url.slice(0, i + 1)}${token.slice(0, 4)}…${token.slice(-2)}`;
}

/** Sélection d'un lot : bornée à 100, sans doublon. */
export function basculerSelection(sel: readonly string[], id: string, max = 100): string[] {
  if (sel.includes(id)) return sel.filter((x) => x !== id);
  return sel.length >= max ? [...sel] : [...sel, id];
}

/** Message lisible d'un refus d'export (badge non émis…). */
export function messageExport(err: unknown): string {
  const d = (err as { detail?: { code?: string; message?: string } } | null)?.detail;
  if (d?.code === 'CARD_NOT_ISSUED') {
    return `${d.message ?? 'Carte non émise.'} Émettez la carte depuis l’onglet « Cartes » de la fiche.`;
  }
  if ((err as { status?: number } | null)?.status === 503) {
    return 'Le service de génération est saturé ou indisponible : réessayez dans un instant.';
  }
  return d?.message ?? (err as Error | null)?.message ?? 'Export impossible.';
}

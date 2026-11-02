// Annonces de la plateforme côté destinataire (ADR-0053 § 6.6 — lot P6).
//
// Logique pure, testée sans DOM : ce que montre la bannière, ce que compte la cloche,
// les mises à jour locales après lecture ou fermeture. La bannière
// (`annonces-banniere.tsx`) et la cloche (`notifications-bell.tsx`) assemblent.
//
// Texte BRUT : aucun rendu HTML, aucun lien rendu cliquable (§ 6.6).

import type { MyAnnouncementView } from '@/lib/announcements-api';

/** Événement de fenêtre : la bannière et la cloche se relisent mutuellement. */
export const EVENEMENT_ANNONCES = 'lalanda:annonces';

/** Annonces que la bannière montre : non fermées, en cours, la plus récente d'abord. */
export function annoncesBanniere(
  liste: readonly MyAnnouncementView[],
  maintenant: Date = new Date(),
): MyAnnouncementView[] {
  return liste
    .filter((a) => a.dismissedAt === null && new Date(a.expiresAt) > maintenant)
    .sort((x, y) => y.startsAt.localeCompare(x.startsAt));
}

/** Annonces en cours pour la cloche (fermées comprises), la plus récente d'abord. */
export function annoncesCloche(
  liste: readonly MyAnnouncementView[],
  maintenant: Date = new Date(),
): MyAnnouncementView[] {
  return liste
    .filter((a) => new Date(a.expiresAt) > maintenant)
    .sort((x, y) => y.startsAt.localeCompare(x.startsAt));
}

/** Non lues, comptées une fois chacune (identifiants dédoublonnés). */
export function annoncesNonLues(liste: readonly MyAnnouncementView[]): number {
  return new Set(liste.filter((a) => a.readAt === null).map((a) => a.id)).size;
}

export function marquerAnnonceLue(
  liste: readonly MyAnnouncementView[],
  id: string,
  quand: string,
): MyAnnouncementView[] {
  return liste.map((a) => (a.id === id && a.readAt === null ? { ...a, readAt: quand } : a));
}

export function fermerAnnonce(
  liste: readonly MyAnnouncementView[],
  id: string,
  quand: string,
): MyAnnouncementView[] {
  return liste.map((a) =>
    a.id === id ? { ...a, readAt: a.readAt ?? quand, dismissedAt: a.dismissedAt ?? quand } : a,
  );
}

/** « Autre(s) annonce(s) » sous la bannière, quand il y en a plusieurs. */
export function libelleAutresAnnonces(restantes: number): string | null {
  if (restantes <= 0) return null;
  return restantes === 1
    ? '1 autre annonce dans la cloche.'
    : `${restantes} autres annonces dans la cloche.`;
}

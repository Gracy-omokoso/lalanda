'use client';

// Bannière des annonces de la plateforme (ADR-0053 § 3, § 6.6 — lot P6).
//
// Montre la plus récente annonce non fermée, quelle que soit l'organisation active ;
// « Fermer » la retire de la bannière (la cloche la garde jusqu'à l'échéance). Texte
// BRUT : rendu tel quel, sans HTML ni lien. Un échec de lecture ne montre rien.

import { useCallback, useEffect, useState } from 'react';

import { announcementsApi, type MyAnnouncementView } from '@/lib/announcements-api';

import {
  annoncesBanniere,
  EVENEMENT_ANNONCES,
  fermerAnnonce,
  libelleAutresAnnonces,
} from './annonces-model';

export function AnnoncesBanniere(): React.ReactElement | null {
  const [liste, setListe] = useState<MyAnnouncementView[]>([]);

  const relire = useCallback(async (): Promise<void> => {
    try {
      const { announcements } = await announcementsApi.mine();
      setListe(announcements);
    } catch {
      setListe([]);
    }
  }, []);

  useEffect(() => {
    void relire();
    const surChangement = (): void => void relire();
    window.addEventListener(EVENEMENT_ANNONCES, surChangement);
    return () => window.removeEventListener(EVENEMENT_ANNONCES, surChangement);
  }, [relire]);

  const visibles = annoncesBanniere(liste);
  const annonce = visibles[0];
  if (!annonce) return null;
  const autres = libelleAutresAnnonces(visibles.length - 1);

  async function fermer(id: string): Promise<void> {
    setListe((l) => fermerAnnonce(l, id, new Date().toISOString()));
    try {
      await announcementsApi.dismiss(id);
    } finally {
      window.dispatchEvent(new Event(EVENEMENT_ANNONCES));
    }
  }

  return (
    <section
      aria-label="Annonce de Lalanda"
      className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
          Annonce de l’équipe Lalanda
        </span>
        <p className="font-semibold">{annonce.title}</p>
        <p className="whitespace-pre-line break-words text-[var(--foreground)]">{annonce.body}</p>
        {autres ? <p className="text-xs text-[var(--foreground-muted)]">{autres}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => void fermer(annonce.id)}
        className="shrink-0 self-start rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium transition hover:border-[var(--accent)]"
      >
        Fermer
      </button>
    </section>
  );
}

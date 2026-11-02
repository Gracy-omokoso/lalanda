'use client';

// Annonces de la plateforme dans la cloche (ADR-0053 § 6.6 — lot P6).
//
// Un crochet (lecture, compteur des non lues) et une section du panneau. Les annonces
// ne vivent PAS dans la boîte de l'organisation : elles se lisent quelle que soit
// l'organisation active (`/me/announcements`), une ligne par annonce, sans doublon.

import { useCallback, useEffect, useState } from 'react';

import { announcementsApi, type MyAnnouncementView } from '@/lib/announcements-api';

import {
  annoncesCloche,
  annoncesNonLues,
  EVENEMENT_ANNONCES,
  marquerAnnonceLue,
} from './annonces-model';

export function useAnnoncesCloche(): {
  annonces: MyAnnouncementView[];
  nonLues: number;
  relire: () => Promise<void>;
  lire: (id: string) => void;
} {
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

  const lire = useCallback((id: string): void => {
    setListe((l) => marquerAnnonceLue(l, id, new Date().toISOString()));
    void announcementsApi
      .markRead(id)
      .catch(() => undefined)
      .finally(() => window.dispatchEvent(new Event(EVENEMENT_ANNONCES)));
  }, []);

  const annonces = annoncesCloche(liste);
  return { annonces, nonLues: annoncesNonLues(annonces), relire, lire };
}

export function SectionAnnoncesCloche({
  annonces,
  onLire,
}: {
  annonces: readonly MyAnnouncementView[];
  onLire: (id: string) => void;
}): React.ReactElement | null {
  if (annonces.length === 0) return null;
  return (
    <section aria-label="Annonces de Lalanda" className="border-b border-[var(--border)]">
      <p className="px-3 pt-2 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
        Annonces de Lalanda
      </p>
      <ul>
        {annonces.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onLire(a.id)}
              className={`flex w-full gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                a.readAt === null ? 'bg-[var(--accent-soft)]' : ''
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  a.readAt === null ? 'bg-[var(--accent)]' : 'bg-transparent'
                }`}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={a.readAt === null ? 'font-medium' : ''}>
                  {a.readAt === null ? <span className="sr-only">Non lue : </span> : null}
                  {a.title}
                </span>
                <span className="whitespace-pre-line break-words text-xs text-[var(--foreground-muted)]">
                  {a.body}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

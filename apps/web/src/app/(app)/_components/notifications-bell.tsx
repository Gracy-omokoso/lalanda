'use client';

// Cloche de notifications de la barre du haut (ADR-0039 § 8, lot L2).
//
// Compteur des non lues (interrogé toutes les 60 s quand l'onglet est visible,
// relu au retour sur l'onglet et au changement d'organisation), panneau des
// 20 dernières, « Tout marquer comme lu », lien vers `/notifications`. Ce qui
// décide vit dans `notifications/notifications-model.ts` ; ce fichier assemble.
//
// CLAVIER : Entrée / Espace ouvrent (bouton natif) ; Échap ferme et rend le
// focus au déclencheur ; Tab circule dans le panneau ; un clic hors du panneau
// le ferme. Le compteur est DIT dans le nom accessible, pas seulement montré.
//
// Un échec de lecture du compteur ne montre rien (pas de pastille) : la cloche
// n'invente pas d'état. Rien ici n'autorise quoi que ce soit — l'API ne sert
// que les notifications de l'appelant dans l'organisation active.

import type { NotificationView } from '@lalanda/shared/notifications';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { notificationsApi } from '@/lib/notifications-api';

import {
  EVENEMENT_NOTIFICATIONS,
  INTERVALLE_COMPTEUR_MS,
  NOTIFICATIONS_HREF,
  TAILLE_PANNEAU,
  compteurApresLecture,
  dateRelative,
  doitInterroger,
  lienSur,
  marquerLue,
  nomAccessibleCloche,
  pastilleCompteur,
  toutMarquerLu,
} from '../notifications/notifications-model';
import { useShell } from './shell-context';

type EtatPanneau = 'ferme' | 'chargement' | 'pret' | 'erreur';

export function NotificationsBell(): React.ReactElement {
  const { organizationId } = useShell();
  const [nonLues, setNonLues] = useState(0);
  const [etat, setEtat] = useState<EtatPanneau>('ferme');
  const [items, setItems] = useState<NotificationView[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ouvert = etat !== 'ferme';

  const relireCompteur = useCallback(async (): Promise<void> => {
    try {
      const { unread } = await notificationsApi.unreadCount();
      setNonLues(unread);
    } catch {
      // Pas de session, pas d'organisation, panne : aucune pastille.
      setNonLues(0);
    }
  }, []);

  // Interrogation du compteur : au montage, à chaque organisation, toutes les
  // 60 s si l'onglet est visible, et au retour sur l'onglet.
  useEffect(() => {
    void relireCompteur();
    const minuterie = window.setInterval(() => {
      if (doitInterroger(document.visibilityState)) void relireCompteur();
    }, INTERVALLE_COMPTEUR_MS);
    function surVisibilite(): void {
      if (doitInterroger(document.visibilityState)) void relireCompteur();
    }
    function surChangement(): void {
      void relireCompteur();
    }
    document.addEventListener('visibilitychange', surVisibilite);
    window.addEventListener(EVENEMENT_NOTIFICATIONS, surChangement);
    return () => {
      window.clearInterval(minuterie);
      document.removeEventListener('visibilitychange', surVisibilite);
      window.removeEventListener(EVENEMENT_NOTIFICATIONS, surChangement);
    };
  }, [relireCompteur, organizationId]);

  const fermer = useCallback((rendreFocus: boolean): void => {
    setEtat('ferme');
    if (rendreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!ouvert) return;
    function surPointeur(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setEtat('ferme');
    }
    function surTouche(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fermer(true);
      }
    }
    document.addEventListener('mousedown', surPointeur);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('mousedown', surPointeur);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert, fermer]);

  async function ouvrir(): Promise<void> {
    setEtat('chargement');
    try {
      const [page, compteur] = await Promise.all([
        notificationsApi.list({ limit: TAILLE_PANNEAU }),
        notificationsApi.unreadCount(),
      ]);
      setItems(page.items);
      setNonLues(compteur.unread);
      setEtat('pret');
    } catch {
      setEtat('erreur');
    }
  }

  function basculer(): void {
    if (ouvert) fermer(false);
    else void ouvrir();
  }

  function surClicNotification(n: NotificationView): void {
    setEtat('ferme');
    if (n.readAt !== null) return;
    setNonLues((c) => compteurApresLecture(c, items, n.id));
    setItems((liste) => marquerLue(liste, n.id, new Date().toISOString()));
    void notificationsApi.markRead(n.id).catch(() => void relireCompteur());
  }

  async function toutLire(): Promise<void> {
    const avant = items;
    setItems((liste) => toutMarquerLu(liste, new Date().toISOString()));
    setNonLues(0);
    try {
      await notificationsApi.markAllRead();
    } catch {
      setItems(avant);
      void relireCompteur();
    }
  }

  const pastille = pastilleCompteur(nonLues);
  const maintenant = new Date();

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={basculer}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label={nomAccessibleCloche(nonLues)}
        title="Notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--nav-muted)] transition hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {pastille ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 inline-flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full bg-[var(--nav-accent)] px-1 text-[0.65rem] font-bold leading-none text-[var(--nav-bg)]"
          >
            {pastille}
          </span>
        ) : null}
      </button>

      {ouvert ? (
        <div
          role="dialog"
          aria-label="Notifications"
          // Bornée par la fenêtre : tient dans 360 px sans défilement horizontal.
          className="absolute right-0 z-20 mt-2 flex max-h-[min(32rem,calc(100vh-6rem))] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-lg"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              onClick={() => void toutLire()}
              disabled={etat !== 'pret' || nonLues === 0}
              className="rounded px-2 py-1 text-xs text-[var(--accent)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Tout marquer comme lu
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto"
            aria-live="polite"
            aria-busy={etat === 'chargement'}
          >
            {etat === 'chargement' ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--foreground-muted)]">
                Chargement…
              </p>
            ) : etat === 'erreur' ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--foreground-muted)]">
                Notifications indisponibles pour le moment.
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--foreground-muted)]">
                Aucune notification.
              </p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id} className="border-b border-[var(--border)] last:border-b-0">
                    <Link
                      href={lienSur(n.href)}
                      onClick={() => surClicNotification(n)}
                      className={`flex gap-2 px-3 py-2.5 text-sm transition hover:bg-[var(--surface-muted)] ${
                        n.readAt === null ? 'bg-[var(--accent-soft)]' : ''
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.readAt === null ? 'bg-[var(--accent)]' : 'bg-transparent'
                        }`}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className={n.readAt === null ? 'font-medium' : ''}>
                          {n.readAt === null ? <span className="sr-only">Non lue : </span> : null}
                          {n.title}
                        </span>
                        <span className="text-xs text-[var(--foreground-muted)]">
                          {dateRelative(n.createdAt, maintenant)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href={NOTIFICATIONS_HREF}
            onClick={() => setEtat('ferme')}
            className="shrink-0 border-t border-[var(--border)] px-3 py-2 text-center text-sm text-[var(--accent)] transition hover:bg-[var(--surface-muted)]"
          >
            Voir toutes les notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}

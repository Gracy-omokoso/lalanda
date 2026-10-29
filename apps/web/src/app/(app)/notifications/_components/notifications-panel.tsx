'use client';

// Page `/notifications` (ADR-0039 § 8) : toutes les notifications de l'appelant
// dans l'organisation active, par pages (curseur), filtre « non lues »,
// « Tout marquer comme lu », et préférences (types reçus ou coupés).
// Ce qui décide vit dans `../notifications-model.ts`.

import type { NotificationKind, NotificationView } from '@lalanda/shared/notifications';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { notificationsApi } from '@/lib/notifications-api';

import { useShell } from '../../_components/shell-context';
import {
  EVENEMENT_NOTIFICATIONS,
  LIBELLES_TYPES,
  TYPES_AFFICHES,
  ajouterPage,
  basculerTypeCoupe,
  dateRelative,
  lienSur,
  marquerLue,
  toutMarquerLu,
} from '../notifications-model';

const TAILLE_PAGE = 30;

function signalerChangement(): void {
  window.dispatchEvent(new Event(EVENEMENT_NOTIFICATIONS));
}

export function NotificationsPanel(): React.ReactElement {
  const { organizationId } = useShell();
  const [nonLuesSeulement, setNonLuesSeulement] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement');
  const [plusEnCours, setPlusEnCours] = useState(false);

  const charger = useCallback(async (): Promise<void> => {
    setEtat('chargement');
    try {
      const page = await notificationsApi.list({
        unreadOnly: nonLuesSeulement,
        limit: TAILLE_PAGE,
      });
      setItems(page.items);
      setCurseur(page.nextCursor);
      setEtat('pret');
    } catch {
      setEtat('erreur');
    }
  }, [nonLuesSeulement]);

  useEffect(() => {
    void charger();
  }, [charger, organizationId]);

  async function chargerPlus(): Promise<void> {
    if (!curseur) return;
    setPlusEnCours(true);
    try {
      const page = await notificationsApi.list({
        unreadOnly: nonLuesSeulement,
        limit: TAILLE_PAGE,
        cursor: curseur,
      });
      setItems((liste) => ajouterPage(liste, page.items));
      setCurseur(page.nextCursor);
    } catch {
      setEtat('erreur');
    } finally {
      setPlusEnCours(false);
    }
  }

  function lire(n: NotificationView): void {
    if (n.readAt !== null) return;
    setItems((liste) => marquerLue(liste, n.id, new Date().toISOString()));
    void notificationsApi
      .markRead(n.id)
      .then(signalerChangement)
      .catch(() => undefined);
  }

  async function toutLire(): Promise<void> {
    try {
      await notificationsApi.markAllRead();
      setItems((liste) => (nonLuesSeulement ? [] : toutMarquerLu(liste, new Date().toISOString())));
      setCurseur(nonLuesSeulement ? null : curseur);
      signalerChangement();
    } catch {
      setEtat('erreur');
    }
  }

  const maintenant = new Date();
  const aDesNonLues = items.some((n) => n.readAt === null);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Ce qui vous concerne dans l’organisation active : tâches assignées, mentions, échéances.
          Les notifications sont conservées 180 jours.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filtre"
          className="inline-flex rounded-md border border-[var(--border)]"
        >
          {[
            { v: false, label: 'Toutes' },
            { v: true, label: 'Non lues' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={nonLuesSeulement === o.v}
              onClick={() => setNonLuesSeulement(o.v)}
              className={`px-3 py-1.5 text-sm transition first:rounded-l-md last:rounded-r-md ${
                nonLuesSeulement === o.v
                  ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                  : 'hover:bg-[var(--surface-muted)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void toutLire()}
          disabled={etat !== 'pret' || !aDesNonLues}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Tout marquer comme lu
        </button>
      </div>

      <div aria-live="polite" aria-busy={etat === 'chargement'}>
        {etat === 'chargement' ? (
          <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
        ) : etat === 'erreur' ? (
          <div className="flex items-center gap-3 text-sm">
            <span>Notifications indisponibles pour le moment.</span>
            <button
              type="button"
              onClick={() => void charger()}
              className="text-[var(--accent)] underline"
            >
              Réessayer
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            {nonLuesSeulement ? 'Aucune notification non lue.' : 'Aucune notification.'}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {items.map((n) => (
              <li key={n.id} className="border-b border-[var(--border)] last:border-b-0">
                <Link
                  href={lienSur(n.href)}
                  onClick={() => lire(n)}
                  className={`flex gap-3 px-4 py-3 text-sm transition hover:bg-[var(--surface-muted)] ${
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
                      {LIBELLES_TYPES[n.kind]?.label ?? 'Notification'} ·{' '}
                      {dateRelative(n.createdAt, maintenant)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {etat === 'pret' && curseur ? (
          <button
            type="button"
            onClick={() => void chargerPlus()}
            disabled={plusEnCours}
            className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
          >
            {plusEnCours ? 'Chargement…' : 'Afficher plus'}
          </button>
        ) : null}
      </div>

      <Preferences organizationId={organizationId} />
    </section>
  );
}

function Preferences({ organizationId }: { organizationId: string | null }): React.ReactElement {
  const [coupes, setCoupes] = useState<NotificationKind[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    notificationsApi
      .preferences()
      .then((p) => {
        if (!annule) setCoupes(p.mutedKinds);
      })
      .catch(() => {
        if (!annule) setErreur('Préférences indisponibles pour le moment.');
      });
    return () => {
      annule = true;
    };
  }, [organizationId]);

  async function basculer(kind: NotificationKind): Promise<void> {
    if (!coupes) return;
    const suivant = basculerTypeCoupe(coupes, kind);
    setEnCours(true);
    setErreur(null);
    try {
      const p = await notificationsApi.setPreferences(suivant);
      setCoupes(p.mutedKinds);
    } catch {
      setErreur('Enregistrement impossible. Réessayez.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <legend className="px-1 text-sm font-semibold">Préférences</legend>
      <p className="text-xs text-[var(--foreground-muted)]">
        Décochez un type pour ne plus le recevoir dans cette organisation. Pas d’e-mail : les
        notifications restent dans l’application.
      </p>
      {coupes === null && !erreur ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : null}
      {coupes !== null ? (
        <ul className="flex flex-col gap-2">
          {TYPES_AFFICHES.map((kind) => {
            const id = `notif-pref-${kind.replace(/\W/g, '-')}`;
            return (
              <li key={kind} className="flex items-start gap-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={!coupes.includes(kind)}
                  disabled={enCours}
                  onChange={() => void basculer(kind)}
                  className="mt-0.5 h-4 w-4"
                />
                <label htmlFor={id} className="flex flex-col text-sm">
                  <span>{LIBELLES_TYPES[kind].label}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {LIBELLES_TYPES[kind].aide}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </fieldset>
  );
}

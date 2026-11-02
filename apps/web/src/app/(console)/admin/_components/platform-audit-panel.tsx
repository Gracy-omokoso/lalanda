'use client';

// Journal d'audit de la PLATEFORME (S21b).
//
// ── Deux journaux, jamais mélangés ───────────────────────────────────────────
//
// Celui-ci trace les actes d'ADMINISTRATION : rôles attribués, plans changés,
// organisations suspendues, secrets remplacés. Le journal d'une organisation
// (`/organisation/journal`) trace ce que ses membres y font. Les fusionner
// donnerait à un opérateur plateforme une vue sur l'activité interne des
// clients — exactement l'accès qu'ADR-0012 §4 refuse.
//
// ── Ce qu'on y lit d'un secret ───────────────────────────────────────────────
//
// L'auteur, la date, le fournisseur, le nom du champ, et les quatre derniers
// caractères AVANT et APRÈS. Jamais la valeur : le journal est justement l'un
// des endroits où un secret en clair survivrait le plus longtemps, recopié dans
// des sauvegardes et des exports. Les deux suffixes répondent à la seule
// question qui compte en investigation — « quelle clé a été remplacée par
// quelle autre ? ».

import { useCallback, useEffect, useState } from 'react';

import { api, type PlatformAuditEventView } from '@/lib/api';

import { Bandeau, Vide } from './admin-chrome';
import {
  ACTIONS_FILTRABLES,
  formaterDateHeure,
  libelleAction,
  messageErreur,
  metadonneesLisibles,
} from './admin-model';

export function PlatformAuditPanel(): React.ReactElement {
  const [action, setAction] = useState('');
  const [events, setEvents] = useState<PlatformAuditEventView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (filtre: string): Promise<void> => {
    setChargement(true);
    try {
      const { events: liste } = await api.listPlatformAuditEvents({
        action: filtre || undefined,
        limit: 100,
      });
      setEvents(liste);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger le journal.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger(action);
  }, [charger, action]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
            Filtrer par action
          </span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-80 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">Toutes les actions</option>
            {ACTIONS_FILTRABLES.map((a) => (
              <option key={a} value={a}>
                {libelleAction(a)}
              </option>
            ))}
          </select>
        </label>
        <p className="max-w-md text-xs text-[var(--foreground-muted)]">
          Les cent événements les plus récents. Le journal est en lecture seule et ne peut être ni
          modifié ni purgé depuis l’interface.
        </p>
      </div>

      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}

      {chargement ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : !events || events.length === 0 ? (
        <Vide>
          {action
            ? 'Aucun événement pour cette action.'
            : 'Aucun acte d’administration enregistré.'}
        </Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{libelleAction(event.action)}</span>
                <span className="font-mono text-xs text-[var(--foreground-muted)]">
                  {formaterDateHeure(event.createdAt)}
                </span>
              </div>
              <p className="font-mono text-xs text-[var(--foreground-muted)]">
                {event.actorUserId} · {event.actorRole} → {event.targetType} {event.targetId}
              </p>
              {metadonneesLisibles(event).length > 0 ? (
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {metadonneesLisibles(event).map(({ cle, valeur }) => (
                    <div key={cle} className="flex gap-1.5">
                      <dt className="text-[var(--foreground-muted)]">{cle}</dt>
                      <dd className="font-mono break-all">{valeur}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

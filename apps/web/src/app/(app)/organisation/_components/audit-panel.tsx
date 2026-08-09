'use client';

// Journal d'audit de l'organisation (S21a) — `audit.read`, en LECTURE SEULE.
//
// La collection `audit_events` est append-only (S20a) : rien dans cette page ne
// modifie, ne masque ni ne supprime un événement. Le seul contrôle offert est un
// filtre par action, appliqué EN BASE — filtrer les cent derniers événements
// côté client ferait disparaître une action rare dès que le journal grossit, ce
// qui est le contraire d'un journal d'audit.
//
// Les rôles de saisie n'ont pas accès au journal qui les surveille (docs/12) :
// un Comptable ou un Analyste reçoit un 403, et la page le dit sans alarmer.

import { useCallback, useEffect, useState } from 'react';

import { api, type AuditEventView } from '@/lib/api';

import { estRefus, formatDateHeure, messageErreur } from './organization-model';

/** Nombre d'événements demandés — le serveur plafonne de toute façon à 500. */
const LIMITE = 100;

export function AuditPanel(): React.ReactElement {
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [filtre, setFiltre] = useState('');
  const [refuse, setRefuse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (action: string): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await api.listAuditEvents({
        action: action === '' ? undefined : action,
        limit: LIMITE,
      });
      setEvents(res.events);
      // Le vocabulaire vient du serveur : il grandit à chaque lot livré, une
      // liste figée ici proposerait des filtres sans résultat ou en oublierait.
      setActions(res.actions);
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) {
        setRefuse(true);
        setEvents([]);
      } else {
        setErreur(messageErreur(err, 'Impossible de charger le journal.'));
      }
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger(filtre);
  }, [charger, filtre]);

  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-sm font-medium">Journal réservé à la gouvernance</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          Le journal d’audit est consultable par le Propriétaire, l’Administrateur et le Directeur
          financier. Les rôles de saisie n’ont pas accès au journal qui les surveille.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-[var(--foreground-muted)]">
          Qui a fait quoi, sur quoi, et quand. Le journal ne se modifie pas : chaque ligne y reste.
        </p>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="filtre-action"
            className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[var(--foreground-muted)]"
          >
            Filtrer par action
          </label>
          <select
            id="filtre-action"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
          >
            <option value="">Toutes les actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}

      {chargement ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm font-medium">
            {filtre === '' ? 'Aucun événement pour l’instant' : 'Aucun événement pour ce filtre'}
          </p>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
            Les validations de plan, les exports de rapport et les modifications de paramètres
            apparaîtront ici.
          </p>
        </div>
      ) : (
        // `overflow-x-auto` : le tableau garde ses colonnes lisibles sur mobile
        // sans faire défiler la page entière horizontalement.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              Journal d’audit de l’organisation, du plus récent au plus ancien
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <Th>Date</Th>
                <Th>Acteur</Th>
                <Th>Action</Th>
                <Th>Cible</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] align-top">
                  <td className="fig whitespace-nowrap px-2 py-2 text-xs text-[var(--foreground-muted)]">
                    {formatDateHeure(e.createdAt)}
                  </td>
                  <td className="px-2 py-2">
                    {/* L'identité réelle n'est jamais réécrite (ADR-0012 §5) :
                        on affiche le rôle détenu AU MOMENT de l'action, qui a pu
                        changer depuis. */}
                    <span className="fig text-xs">{e.actorUserId.slice(-8)}</span>
                    <span className="block text-xs text-[var(--foreground-muted)]">
                      {e.actorRole}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-2 py-2">
                    <span className="text-xs">{e.targetType}</span>
                    <span className="fig block text-xs text-[var(--foreground-muted)]">
                      {e.targetId.slice(-8)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <th
      scope="col"
      className="px-2 py-2 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-muted)]"
    >
      {children}
    </th>
  );
}

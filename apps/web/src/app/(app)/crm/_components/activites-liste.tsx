'use client';

// Activités et relances — ADR-0040 § 3.5 et § 8.1 : liste avec assigné,
// échéance (jour de Kinshasa), filtres (les miennes, à faire, en retard, à
// venir, faites) et cases « fait » / « rouvrir » (`…/complete`, `…/reopen`).
// « Mes tâches » (`/projets/mes-taches`, lot C4) mène ici par
// `?activite=<id>` : l'activité visée est mise en évidence.

import { Badge } from '@lalanda/ui';
import { CalendarCheck2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type ActivityView } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  FILTRES_ACTIVITES,
  FILTRES_ACTIVITES_INITIAUX,
  appliquerBascule,
  jourKinshasa,
  libelleEcheance,
  requeteActivites,
  tonActivite,
  type FiltresActivites,
} from './activites-model';
import { useAccesCrm } from './crm-access';
import { lienCompte, lienOpportunite, messageCrm, peutGererCrm } from './crm-model';
import { Bandeau } from './crm-ui';
import { nomMembre } from './pipeline-model';

const TONS = {
  retard: 'border-l-[var(--danger)]',
  aujourdhui: 'border-l-[var(--warn)]',
  neutre: 'border-l-[var(--module-run)]',
  faite: 'border-l-[var(--border)]',
} as const;

export function ActivitesListe(): React.ReactElement {
  const { actions, membres } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [filtres, setFiltres] = useState<FiltresActivites>(FILTRES_ACTIVITES_INITIAUX);
  const [items, setItems] = useState<ActivityView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [visee, setVisee] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState('');
  const aujourdhui = jourKinshasa(new Date());

  // `?activite=<id>` (lien de « Mes tâches ») : toutes les activités, l'élément visé en évidence.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('activite');
    if (id) {
      setVisee(id);
      setFiltres({ statut: 'toutes', miennes: false });
    }
  }, []);

  const charger = useCallback(
    (f: FiltresActivites, cursor: string | null) => {
      crmApi
        .listActivities(requeteActivites(f, aujourdhui, cursor))
        .then((p) => {
          setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
          setSuivante(p.nextCursor);
          setErreur(null);
        })
        .catch((err) => setErreur(messageCrm(err, 'Impossible de charger les activités.')));
    },
    [aujourdhui],
  );

  useEffect(() => charger(filtres, null), [filtres, charger]);

  useEffect(() => {
    if (!visee || !items) return;
    document.getElementById(`activite-${visee}`)?.scrollIntoView({ block: 'center' });
  }, [visee, items]);

  async function basculer(a: ActivityView): Promise<void> {
    try {
      const maj = a.done
        ? await crmApi.reopenActivity(a.id, a.revision)
        : await crmApi.completeActivity(a.id, a.revision);
      setItems((l) => (l ? appliquerBascule(l, maj, filtres.statut) : l));
      setAnnonce(maj.done ? `« ${a.subject} » marquée faite.` : `« ${a.subject} » rouverte.`);
    } catch (err) {
      setErreur(messageCrm(err, 'Action impossible.'));
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarCheck2}
        titre="Activités"
        sousTitre="Appels, réunions et relances. Les relances à échéance figurent aussi dans « Mes tâches »."
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtres">
          <button
            type="button"
            className={BOUTON_PETIT}
            aria-pressed={filtres.miennes}
            onClick={() => setFiltres({ ...filtres, miennes: !filtres.miennes })}
          >
            Les miennes
          </button>
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-[var(--border)]" />
          {FILTRES_ACTIVITES.map((f) => (
            <button
              key={f.valeur}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={filtres.statut === f.valeur}
              onClick={() => setFiltres({ ...filtres, statut: f.valeur })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Bandeau>
      <p className="sr-only" role="status" aria-live="polite">
        {annonce}
      </p>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des activités…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucune activité ne correspond à ces filtres.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => {
            const ton = tonActivite(a, aujourdhui);
            const coche = gerer && a.kind !== 'note';
            return (
              <li
                key={a.id}
                id={`activite-${a.id}`}
                className={`flex min-w-0 flex-wrap items-start gap-3 rounded-[var(--radius-md)] border border-l-4 border-[var(--border)] bg-[var(--surface)] p-3 text-sm ${TONS[ton]} ${visee === a.id ? 'ring-2 ring-[var(--accent)]' : ''}`}
              >
                {coche ? (
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={a.done}
                    aria-label={`${a.done ? 'Rouvrir' : 'Marquer faite'} : ${a.subject}`}
                    onChange={() => void basculer(a)}
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={`break-words font-medium ${a.done ? 'line-through opacity-70' : ''}`}
                  >
                    {a.subject}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--foreground-muted)]">
                    <Badge tone={a.kind === 'follow_up' ? 'info' : 'neutral'}>{a.kindLabel}</Badge>
                    <span
                      className={ton === 'retard' ? 'font-medium text-[var(--danger)]' : undefined}
                    >
                      {libelleEcheance(a, aujourdhui)}
                    </span>
                    <span>
                      {a.assigneeUserId
                        ? `Assignée à ${nomMembre(membres, a.assigneeUserId)}`
                        : 'Sans assigné'}
                    </span>
                    {a.opportunityId ? (
                      <Link href={lienOpportunite(a.opportunityId)} className="underline">
                        Voir l’opportunité
                      </Link>
                    ) : null}
                    {a.accountId ? (
                      <Link href={lienCompte(a.accountId)} className="underline">
                        Voir le compte
                      </Link>
                    ) : null}
                  </span>
                  {a.notes ? (
                    <p className="whitespace-pre-line break-words text-xs">{a.notes}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtres, suivante)}
        >
          Afficher plus d’activités
        </button>
      ) : null}
    </section>
  );
}

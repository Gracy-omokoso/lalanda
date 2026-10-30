'use client';

// Calendrier des absences (ADR-0045 § 3.2, § 8) : grille personnes × jours au-delà
// du téléphone, liste par jour en dessous. Une absence en attente se distingue
// par sa FORME (bordure pointillée) et son texte, pas seulement sa couleur ; un
// type confidentiel arrive « Absent » et garde la couleur commune (§ 8 : aucune
// couleur ne trahit le type).

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { hrApi, type HrCalendarScope, type HrCalendarView } from '@/lib/api-hr';

import { BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';
import { JOURS_COURTS, jourSemaine } from '../../projets/_components/calendar-model';

import {
  LIBELLES_DEMI,
  LIBELLES_PORTEE,
  decaler,
  feries,
  grillePersonnes,
  listeParJour,
  periode,
  texteCase,
  type CaseAbsence,
  type VueCalendrier,
} from './calendrier-model';
import { Chargement, EchecLecture, PhraseSection } from './rh-ui';
import { aujourdhui, lire, type Lecture } from './rh-model';

function Case({ c, nom, jour }: { c: CaseAbsence | null; nom: string; jour: string }): React.ReactElement {
  if (c === null) return <td className="h-8 min-w-8 border-l border-[var(--border)]" />;
  const attente = c.statut === 'pending';
  const fond = attente
    ? 'border border-dashed border-[var(--module-run)] bg-[color-mix(in_srgb,var(--module-run)_12%,transparent)]'
    : 'bg-[var(--module-run)]';
  const position = c.demi === 'am' ? 'left-0 w-1/2' : c.demi === 'pm' ? 'right-0 w-1/2' : 'inset-x-0';
  const texte = texteCase(nom, jour, c);
  return (
    <td className="relative h-8 min-w-8 border-l border-[var(--border)]" title={texte}>
      <span aria-hidden="true" className={`absolute inset-y-1 rounded-sm ${position} ${fond}`} />
      <span className="sr-only">{texte}</span>
    </td>
  );
}

export function CalendrierAbsences({
  portees,
  porteeInitiale,
}: {
  portees: readonly HrCalendarScope[];
  porteeInitiale: HrCalendarScope;
}): React.ReactElement {
  const id = useId();
  const [vue, setVue] = useState<VueCalendrier>('mois');
  const [ancre, setAncre] = useState(() => aujourdhui());
  const [portee, setPortee] = useState<HrCalendarScope>(porteeInitiale);
  const [lecture, setLecture] = useState<Lecture<HrCalendarView> | null>(null);
  const [version, setVersion] = useState(0);
  const p = useMemo(() => periode(vue, ancre), [vue, ancre]);
  const jours = useMemo(() => p.semaines.flat(), [p]);
  const jour = aujourdhui();

  useEffect(() => {
    let annule = false;
    setLecture(null);
    void lire(hrApi.getCalendar({ from: p.debut, to: p.fin, scope: portee })).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [p.debut, p.fin, portee, version]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BOUTON_PETIT}
          aria-label={vue === 'mois' ? 'Mois précédent' : 'Semaine précédente'}
          onClick={() => setAncre(decaler(vue, ancre, -1))}
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={BOUTON_PETIT}
          aria-label={vue === 'mois' ? 'Mois suivant' : 'Semaine suivante'}
          onClick={() => setAncre(decaler(vue, ancre, 1))}
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" className={BOUTON_PETIT} onClick={() => setAncre(aujourdhui())}>
          Aujourd’hui
        </button>
        <h3 className="min-w-0 flex-1 text-sm font-semibold first-letter:uppercase" aria-live="polite">
          {p.titre}
        </h3>
        <div className="flex gap-1" role="group" aria-label="Affichage">
          {(['mois', 'semaine'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={vue === v}
              onClick={() => setVue(v)}
            >
              {v === 'mois' ? 'Mois' : 'Semaine'}
            </button>
          ))}
        </div>
        {portees.length > 1 ? (
          <>
            <label htmlFor={`${id}-portee`} className="sr-only">
              Absences de
            </label>
            <select
              id={`${id}-portee`}
              className={`${CHAMP} w-auto`}
              value={portee}
              onChange={(e) => setPortee(e.target.value as HrCalendarScope)}
            >
              {portees.map((s) => (
                <option key={s} value={s}>
                  {LIBELLES_PORTEE[s]}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-[var(--module-run)]" />
          Absence accordée
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-sm border border-dashed border-[var(--module-run)]"
          />
          En attente de validation
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-[var(--surface-muted)]" />
          Jour férié
        </span>
      </p>

      {lecture === null ? (
        <Chargement texte="Chargement des absences…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Le calendrier des absences est illisible."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : (
        <Grille view={lecture.valeur} jours={jours} mois={p.mois} aujourdhui={jour} />
      )}
    </div>
  );
}

function Grille({
  view,
  jours,
  mois,
  aujourdhui: jour,
}: {
  view: HrCalendarView;
  jours: string[];
  mois: string;
  aujourdhui: string;
}): React.ReactElement {
  const lignes = grillePersonnes(view, jours);
  const f = feries(view);
  const liste = listeParJour(view, jours);

  if (lignes.length === 0 && f.size === 0) {
    return <PhraseSection>Aucune absence sur cette période.</PhraseSection>;
  }

  return (
    <>
      {/* Téléphone : une liste par jour. */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {liste.map((j) => (
          <li key={j.date} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm">
            <p className="font-medium first-letter:uppercase">{j.titre}</p>
            {j.ferie ? (
              <p className="text-xs text-[var(--foreground-muted)]">Férié : {j.ferie.libelle}</p>
            ) : null}
            <ul className="mt-1 flex flex-col gap-1">
              {j.absences.map((a) => (
                <li key={a.requestId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{a.nom}</span>
                  <span className="text-[var(--foreground-muted)]">
                    {a.libelle}
                    {a.demi !== 'full' ? ` (${LIBELLES_DEMI[a.demi]})` : ''}
                    {a.statut === 'pending' ? ' — en attente' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {/* Au-delà : grille personnes × jours, défilement horizontal dans son cadre. */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] sm:block">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Absences par personne et par jour</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left font-medium">
                Personne
              </th>
              {jours.map((d) => {
                const ferie = f.get(d);
                const horsMois = d.slice(0, 7) !== mois;
                return (
                  <th
                    key={d}
                    scope="col"
                    title={ferie ? `Férié : ${ferie.libelle}` : undefined}
                    className={`min-w-8 border-l border-[var(--border)] px-0.5 py-1 text-center font-normal ${
                      ferie ? 'bg-[var(--surface-muted)]' : ''
                    } ${horsMois ? 'text-[var(--foreground-muted)] opacity-60' : ''} ${
                      d === jour ? 'font-bold text-[var(--module-run)]' : ''
                    }`}
                  >
                    <span className="block">{JOURS_COURTS[jourSemaine(d)]!.slice(0, 1)}</span>
                    <span className="block tabular-nums">{Number(d.slice(8, 10))}</span>
                    {ferie ? <span className="sr-only">, férié : {ferie.libelle}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.employeeId} className="border-t border-[var(--border)]">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-40 truncate bg-[var(--surface)] px-2 py-1 text-left font-medium"
                >
                  {l.nom}
                </th>
                {l.cases.map((c, i) => (
                  <Case key={jours[i]} c={c} nom={l.nom} jour={jours[i]!} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {lignes.length === 0 ? (
          <p className="p-3 text-sm text-[var(--foreground-muted)]">Aucune absence sur cette période.</p>
        ) : null}
      </div>
    </>
  );
}

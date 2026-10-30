'use client';

// Échéances RH (ADR-0045 § 3.3, § 6.4), lot H7 : `GET /hr/deadlines` (`hr.read`).
// Cartes entièrement cliquables vers l'onglet de la fiche concernée ; délais
// rendus par l'API, jamais recomptés ici.

import { Badge } from '@lalanda/ui';
import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { hrAdminApi, type HrDeadlinesView } from '@/lib/api-hr-admin';

import { CHAMP } from '../../ventes/_components/form-ui';

import {
  HORIZONS,
  LIBELLES_ECHEANCE,
  NATURES_ECHEANCE,
  detailEcheance,
  filtrerEcheances,
  horizonDepuis,
  libelleHorizon,
  lienEcheance,
  phraseDate,
  phraseHorizons,
  tonDelai,
  type NatureEcheance,
} from './echeances-model';
import { useAccesRh } from './rh-access';
import { lire, peutLireRh, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, PhraseSection, Tuile } from './rh-ui';

export function Echeances(): React.ReactElement {
  const { actions } = useAccesRh();
  const autorise = peutLireRh(actions);
  const [horizon, setHorizon] = useState<number | null>(null);
  const [nature, setNature] = useState<NatureEcheance | ''>('');
  const [lecture, setLecture] = useState<Lecture<HrDeadlinesView> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!autorise) return;
    let annule = false;
    setLecture(null);
    void lire(hrAdminApi.getDeadlines(horizon ?? undefined)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [autorise, horizon, version]);

  if (!autorise) {
    return (
      <PhraseSection>
        Les échéances sont réservées aux personnes qui consultent les dossiers.
      </PhraseSection>
    );
  }

  const vue = lecture?.ok ? lecture.valeur : null;
  const items = vue ? filtrerEcheances(vue.items, nature) : [];

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarClock}
        titre="Échéances"
        sousTitre={
          vue
            ? phraseHorizons(vue)
            : 'Fins d’essai, fins de contrat, documents et pièces qui expirent.'
        }
      >
        {vue ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NATURES_ECHEANCE.map((k) => (
              <Tuile key={k} libelle={LIBELLES_ECHEANCE[k]} valeur={vue.counts[k]} />
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            Horizon
            <select
              className={CHAMP}
              value={horizon === null ? '' : String(horizon)}
              onChange={(e) => setHorizon(horizonDepuis(e.target.value))}
            >
              {HORIZONS.map((h) => (
                <option key={String(h)} value={h === null ? '' : String(h)}>
                  {libelleHorizon(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            Nature
            <select
              className={CHAMP}
              value={nature}
              onChange={(e) => setNature(e.target.value as NatureEcheance | '')}
            >
              <option value="">Toutes</option>
              {NATURES_ECHEANCE.map((k) => (
                <option key={k} value={k}>
                  {LIBELLES_ECHEANCE[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Bandeau>

      {lecture === null ? (
        <Chargement texte="Chargement des échéances…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les échéances sont illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : items.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucune échéance dans cet horizon.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((e, i) => {
            const detail = detailEcheance(e);
            return (
              <li key={`${e.kind}-${e.employeeId}-${e.documentId ?? ''}-${e.date}-${i}`}>
                <Link
                  href={lienEcheance(e)}
                  className="flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold break-words">{e.employeeName}</span>
                    <Badge tone={tonDelai(e.daysLeft)}>{LIBELLES_ECHEANCE[e.kind]}</Badge>
                  </span>
                  {detail ? <span className="text-sm break-words">{detail}</span> : null}
                  <span className="text-xs text-[var(--foreground-muted)]">{phraseDate(e)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

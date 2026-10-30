'use client';

// Absences — ADR-0045 § 8 : « À valider » (tout manager ou détenteur de
// `leave.approve`) et, avec `hr.read`, « Toutes les demandes » filtrées par statut.

import { ClipboardCheck, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { hrApi, type LeaveRequestPage, type LeaveRequestStatus } from '@/lib/api-hr';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { useAccesRh } from './rh-access';
import { RH_BASE, lire, peutLireRh, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, LigneDemande, Panneau, PhraseSection } from './rh-ui';
import { ValidationsListe } from './validations-liste';
import { FILTRES_STATUT, nomDemandeur, vueAbsences } from './validations-model';

export function Absences(): React.ReactElement {
  const { actions } = useAccesRh();
  const params = useSearchParams();
  const vue = vueAbsences(params.get('vue'), actions);
  const lireRh = peutLireRh(actions);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ClipboardCheck}
        titre={vue === 'a-valider' ? 'Absences à valider' : 'Toutes les demandes d’absence'}
        sousTitre={
          vue === 'a-valider'
            ? 'Les demandes qui attendent votre décision, comme manager ou comme validateur. Vous ne validez jamais vos propres absences.'
            : 'Les demandes de tout le personnel. Les types confidentiels restent « Absent » sans le droit aux données sensibles.'
        }
        actions={
          lireRh ? (
            <nav className="flex gap-1" aria-label="Vues des absences">
              <Link
                href={`${RH_BASE}/absences?vue=a-valider`}
                className={BOUTON_PETIT}
                aria-current={vue === 'a-valider' ? 'page' : undefined}
              >
                À valider
              </Link>
              <Link
                href={`${RH_BASE}/absences?vue=toutes`}
                className={BOUTON_PETIT}
                aria-current={vue === 'toutes' ? 'page' : undefined}
              >
                Toutes
              </Link>
            </nav>
          ) : null
        }
      />
      {vue === 'a-valider' ? <ValidationsListe /> : <Toutes />}
    </section>
  );
}

function Toutes(): React.ReactElement {
  const [statut, setStatut] = useState<LeaveRequestStatus | ''>('pending');
  const [lecture, setLecture] = useState<Lecture<LeaveRequestPage> | null>(null);

  useEffect(() => {
    let annule = false;
    setLecture(null);
    void lire(hrApi.listLeaveRequests({ limit: 100, ...(statut ? { status: statut } : {}) })).then(
      (l) => {
        if (!annule) setLecture(l);
      },
    );
    return () => {
      annule = true;
    };
  }, [statut]);

  return (
    <Panneau
      titre="Demandes"
      icone={ListChecks}
      id="rh-absences-toutes"
      action={
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrer par statut">
          {FILTRES_STATUT.map((f) => (
            <button
              key={f.libelle}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={statut === f.valeur}
              onClick={() => setStatut(f.valeur)}
            >
              {f.libelle}
            </button>
          ))}
        </div>
      }
    >
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Les demandes sont illisibles." />
      ) : lecture.valeur.items.length === 0 ? (
        <PhraseSection>Aucune demande.</PhraseSection>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
          {lecture.valeur.items.map((d) => (
            <LigneDemande key={d.id} demande={d} nom={nomDemandeur(d)} />
          ))}
        </ul>
      )}
    </Panneau>
  );
}

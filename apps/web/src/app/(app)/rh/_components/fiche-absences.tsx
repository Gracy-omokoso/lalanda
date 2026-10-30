'use client';

// Onglet « Absences et soldes » (ADR-0045 § 3.2) : soldes du collaborateur
// (moteur, `GET /hr/leave-balances`) et ses demandes (`GET /hr/leave-requests`),
// lisibles avec `hr.read`, par son manager ou par lui-même. Saisie d'une absence
// pour lui en fenêtre modale (`hr.manage`), y compris sans compte Lalanda.

import { buttonClasses } from '@lalanda/ui';
import { Plane, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  hrApi,
  type LeaveBalancesView,
  type LeaveRequestPage,
  type LeaveTypeView,
} from '@/lib/api-hr';

import { DemandeAbsence } from './demande-absence';
import { useFiche } from './fiche-chrome';
import { lignesSoldes } from './moi-model';
import { useAccesRh } from './rh-access';
import { lire, nomAffiche, peutGererRh, type Lecture } from './rh-model';
import { Chargement, EchecLecture, LigneDemande, Panneau, PhraseSection, Tuile } from './rh-ui';

export function FicheAbsences(): React.ReactElement {
  const { fiche } = useFiche();
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions) && fiche.status === 'active';
  const [soldes, setSoldes] = useState<Lecture<LeaveBalancesView> | null>(null);
  const [demandes, setDemandes] = useState<Lecture<LeaveRequestPage> | null>(null);
  const [types, setTypes] = useState<LeaveTypeView[]>([]);
  const [saisie, setSaisie] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void lire(hrApi.getLeaveBalances({ employeeId: fiche.id })).then((l) => {
      if (!annule) setSoldes(l);
    });
    void lire(hrApi.listLeaveRequests({ employeeId: fiche.id, limit: 100 })).then((l) => {
      if (!annule) setDemandes(l);
    });
    hrApi
      .listLeaveTypes()
      .then((r) => {
        if (!annule) setTypes(r.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [fiche.id, version]);

  return (
    <>
      <Panneau titre="Soldes" icone={Wallet} id="rh-fiche-soldes">
        {soldes === null ? (
          <Chargement />
        ) : !soldes.ok ? (
          <EchecLecture erreur={soldes.erreur} repli="Les soldes sont illisibles." />
        ) : soldes.valeur.balances.length === 0 ? (
          <PhraseSection>Aucun solde n’est tenu pour ce collaborateur.</PhraseSection>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lignesSoldes(soldes.valeur.balances, types).map((s) => (
              <Tuile
                key={s.typeId}
                libelle={`${s.libelle} — disponible`}
                valeur={s.disponible}
                detail={s.details.join(' · ')}
              />
            ))}
          </div>
        )}
      </Panneau>
      <Panneau
        titre="Demandes d’absence"
        icone={Plane}
        id="rh-fiche-demandes"
        action={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setSaisie(true)}
            >
              Saisir une absence
            </button>
          ) : null
        }
      >
        {demandes === null ? (
          <Chargement />
        ) : !demandes.ok ? (
          <EchecLecture erreur={demandes.erreur} repli="Les demandes sont illisibles." />
        ) : demandes.valeur.items.length === 0 ? (
          <PhraseSection>Aucune demande d’absence.</PhraseSection>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {demandes.valeur.items.map((d) => (
              <LigneDemande key={d.id} demande={d} />
            ))}
          </ul>
        )}
      </Panneau>
      <DemandeAbsence
        open={saisie}
        onFermer={() => setSaisie(false)}
        onCreee={() => setVersion((v) => v + 1)}
        gererRh
        employeeId={fiche.id}
        pourQui={nomAffiche(fiche)}
      />
    </>
  );
}

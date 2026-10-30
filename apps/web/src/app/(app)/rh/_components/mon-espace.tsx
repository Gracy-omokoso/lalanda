'use client';

// Mon espace — ADR-0045 § 8 (lot H6) : ma fiche (dossier non sensible), mes
// soldes (moteur), « Demander une absence » en fenêtre modale, mes demandes et
// leur annulation. Mes documents et mes éléments de liste viennent avec H4 :
// ils ne s'affichent que si `GET /hr/me` les sert.

import { buttonClasses } from '@lalanda/ui';
import { CalendarPlus, ClipboardCheck, IdCard, Plane, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { hrApi, type LeaveRequestView, type LeaveTypeView } from '@/lib/api-hr';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { DemandeAbsence } from './demande-absence';
import { etatMoi, grouperDemandes, lignesFiche, lignesSoldes, peutAnnulerDemande } from './moi-model';
import { useAccesRh } from './rh-access';
import {
  LIEN_A_VALIDER,
  RH_BASE,
  aujourdhui,
  formatJour,
  libellePeriode,
  nomAffiche,
  peutDemanderAbsence,
  peutGererRh,
} from './rh-model';
import {
  Bandeau,
  Chargement,
  DialogueDecision,
  EchecLecture,
  LigneDemande,
  Panneau,
  PhraseSection,
  Tuile,
} from './rh-ui';

export function MonEspace(): React.ReactElement {
  const { actions, moi, relireMoi } = useAccesRh();
  const [demande, setDemande] = useState(false);
  const [aAnnuler, setAAnnuler] = useState<LeaveRequestView | null>(null);
  const [types, setTypes] = useState<LeaveTypeView[]>([]);
  const etat = etatMoi(moi);
  const jour = aujourdhui();
  const demander = peutDemanderAbsence(actions);

  useEffect(() => {
    let annule = false;
    hrApi
      .listLeaveTypes()
      .then((r) => {
        if (!annule) setTypes(r.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  const fiche = etat.etat === 'pret' ? etat.moi.employee : null;
  const titre = fiche ? nomAffiche(fiche) : 'Mon espace';

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={IdCard}
        titre={titre}
        sousTitre={
          fiche
            ? [fiche.jobTitle, fiche.departmentName].filter(Boolean).join(' · ')
            : 'Votre fiche, vos soldes et vos demandes d’absence.'
        }
        actions={
          demander && fiche ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setDemande(true)}
            >
              <CalendarPlus aria-hidden="true" className="h-4 w-4" />
              Demander une absence
            </button>
          ) : null
        }
      >
        {etat.etat === 'pret' && (etat.moi.isManager || etat.moi.canApprove) ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {etat.moi.isManager ? (
              <Link href={`${RH_BASE}/equipe`} className={BOUTON_PETIT}>
                Mon équipe
              </Link>
            ) : null}
            <Link href={LIEN_A_VALIDER} className={BOUTON_PETIT}>
              Absences à valider
            </Link>
          </div>
        ) : null}
      </Bandeau>

      {etat.etat === 'chargement' ? <Chargement /> : null}
      {etat.etat === 'pas-encore' ? (
        <EchecLecture erreur={{ status: 404 }} repli="" />
      ) : null}
      {etat.etat === 'erreur' ? (
        <EchecLecture erreur={etat.erreur} repli="Votre espace est illisible." onReessayer={relireMoi} />
      ) : null}

      {etat.etat === 'pret' && fiche === null ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucun dossier collaborateur n’est relié à votre compte. Si vous êtes salarié de
          l’organisation, demandez aux ressources humaines de créer ou de relier votre fiche : vous
          pourrez alors demander vos absences ici.
        </p>
      ) : null}

      {etat.etat === 'pret' && fiche !== null ? (
        <>
          <Panneau titre="Mes soldes" icone={Wallet} id="rh-moi-soldes">
            {etat.moi.balances.length === 0 ? (
              <PhraseSection>
                Aucun solde n’est tenu pour vous : votre organisation n’a pas encore réglé de droits
                à congé, ou aucun type d’absence ne se décompte.
              </PhraseSection>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {lignesSoldes(etat.moi.balances, types).map((s) => (
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

          <Demandes
            demandes={etat.moi.requests}
            jour={jour}
            onAnnuler={setAAnnuler}
          />

          <Panneau titre="Ma fiche" icone={IdCard} id="rh-moi-fiche">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {lignesFiche(fiche).map(([k, v]) => (
                <div key={k} className="flex min-w-0 flex-col">
                  <dt className="text-xs text-[var(--foreground-muted)]">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-[var(--foreground-muted)]">
              Une information est fausse ? Signalez-la aux ressources humaines : elles tiennent votre
              dossier.
            </p>
          </Panneau>

          {etat.moi.checklistItems && etat.moi.checklistItems.length > 0 ? (
            <Panneau titre="Mes tâches d’accueil et de départ" icone={ClipboardCheck} id="rh-moi-listes">
              <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                {etat.moi.checklistItems.map((i) => (
                  <li key={`${i.checklistId}-${i.itemId}`} className="flex flex-wrap gap-x-3 py-2">
                    <span className="min-w-0 flex-1 break-words">
                      {i.label} — {i.employeeName}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {i.doneAt ? 'Fait' : i.dueDate ? `Pour le ${formatJour(i.dueDate)}` : 'À faire'}
                    </span>
                  </li>
                ))}
              </ul>
            </Panneau>
          ) : null}
        </>
      ) : null}

      <DemandeAbsence
        open={demande}
        onFermer={() => setDemande(false)}
        onCreee={() => relireMoi()}
        gererRh={peutGererRh(actions)}
      />

      {aAnnuler ? (
        <DialogueDecision
          titre="Annuler cette demande ?"
          description={`${aAnnuler.typeLabel}, ${libellePeriode(aAnnuler.start, aAnnuler.end)}.`}
          libelle="Motif (facultatif)"
          bouton="Annuler la demande"
          commentaire="facultatif"
          onFermer={() => setAAnnuler(null)}
          onValider={async (motif) => {
            await hrApi.cancelLeaveRequest(aAnnuler.id, motif ? { reason: motif } : {});
            setAAnnuler(null);
            relireMoi();
          }}
        >
          <p>
            Une absence déjà accordée rend ses jours à votre solde. Votre manager et les
            validateurs sont prévenus.
          </p>
        </DialogueDecision>
      ) : null}
    </section>
  );
}

function Demandes({
  demandes,
  jour,
  onAnnuler,
}: {
  demandes: LeaveRequestView[];
  jour: string;
  onAnnuler: (d: LeaveRequestView) => void;
}): React.ReactElement {
  const { enCours, passees } = grouperDemandes(demandes, jour);
  return (
    <Panneau titre="Mes demandes" icone={Plane} id="rh-moi-demandes">
      {demandes.length === 0 ? (
        <PhraseSection>Vous n’avez encore demandé aucune absence.</PhraseSection>
      ) : (
        <>
          {enCours.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm" aria-label="Demandes en cours">
              {enCours.map((d) => (
                <LigneDemande
                  key={d.id}
                  demande={d}
                  action={
                    peutAnnulerDemande(d, jour) ? (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        aria-haspopup="dialog"
                        onClick={() => onAnnuler(d)}
                      >
                        Annuler
                      </button>
                    ) : null
                  }
                />
              ))}
            </ul>
          ) : (
            <PhraseSection>Aucune demande en cours.</PhraseSection>
          )}
          {passees.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-[var(--foreground-muted)]">
                Demandes passées ({passees.length})
              </summary>
              <ul className="flex flex-col divide-y divide-[var(--border)]">
                {passees.map((d) => (
                  <LigneDemande key={d.id} demande={d} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </Panneau>
  );
}

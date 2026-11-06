'use client';

// « Mes frais » — ADR-0051 § 10 (lot H16) : mes notes de frais, mes avances, nouvelle
// note (photo du ticket depuis le téléphone), demande d'avance. `expenses.claim`.

import { buttonClasses } from '@lalanda/ui';
import { HandCoins, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  rh2Api,
  type AdvancePage,
  type AdvanceView,
  type ExpenseReportPage,
  type ExpenseReportView,
  type HrExpensesAdvancesSettingsView,
} from '@/lib/api-rh-2';

import { AvanceDetail, AvanceFormulaire } from './avance';
import {
  LIBELLES_STATUT_AVANCE,
  LIBELLES_STATUT_NOTE,
  lienFrais,
  libelleNatureAvance,
  montant,
  peutDeclarerFrais,
  tonStatutAvance,
  tonStatutNote,
} from './frais-model';
import { NoteDetail, NoteFormulaire } from './note-frais';
import { useAccesRh } from './rh-access';
import { Carte, GrilleCartes, useEquipe, useMoi } from './rh2-ui';
import { formatJour, lire, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection } from './rh-ui';

type Ouvert =
  | { type: 'nouvelle-note' }
  | { type: 'nouvelle-avance' }
  | { type: 'note'; note: ExpenseReportView }
  | { type: 'avance'; avance: AdvanceView }
  | null;

export function MesFrais(): React.ReactElement {
  const { actions, moi: lectureMoi } = useAccesRh();
  const moi = useMoi();
  const equipeHierarchique = useEquipe(moi.estManager);
  // ADR-0066 § 1 : le responsable d'une équipe RH tient aussi l'étape « manager ».
  const equipe = useMemo(
    () => [...new Set([...equipeHierarchique, ...moi.membresMenes])],
    [equipeHierarchique, moi.membresMenes],
  );
  const [notes, setNotes] = useState<Lecture<ExpenseReportPage> | null>(null);
  const [avances, setAvances] = useState<Lecture<AdvancePage> | null>(null);
  const [reglages, setReglages] = useState<HrExpensesAdvancesSettingsView | null>(null);
  const [ouvert, setOuvert] = useState<Ouvert>(null);
  const [version, setVersion] = useState(0);
  const relire = useCallback(() => setVersion((v) => v + 1), []);
  const employeeId = moi.employeeId;

  useEffect(() => {
    let annule = false;
    void rh2Api
      .getExpensesSettings()
      .then((r) => {
        if (!annule) setReglages(r);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (employeeId === null) return;
    let annule = false;
    void lire(rh2Api.listExpenseReports({ employeeId, limit: 100 })).then((l) => {
      if (!annule) setNotes(l);
    });
    void lire(rh2Api.listAdvances({ employeeId, limit: 100 })).then((l) => {
      if (!annule) setAvances(l);
    });
    return () => {
      annule = true;
    };
  }, [employeeId, version]);

  if (!peutDeclarerFrais(actions)) {
    return (
      <PhraseSection>
        Votre rôle ne permet pas de déclarer des frais. Si vous en avez besoin, demandez à un
        Propriétaire de revoir vos droits.
      </PhraseSection>
    );
  }
  if (lectureMoi === null) return <Chargement />;
  if (employeeId === null) {
    return (
      <PhraseSection>
        Aucun dossier collaborateur n’est relié à votre compte : demandez aux ressources humaines de
        relier votre fiche pour déclarer des frais.
      </PhraseSection>
    );
  }

  const fraisEteints = reglages !== null && !reglages.expenses.enabled;
  const avancesOuvertes =
    reglages === null || reglages.advances.enabled.expenses || reglages.advances.enabled.salary;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Receipt}
        titre="Mes frais"
        sousTitre="Vos notes de frais et vos avances. Prenez le ticket en photo depuis votre téléphone ; Lalanda calcule les totaux et ce qui vous reste dû."
        actions={
          <>
            {moi.estManager || moi.estResponsableEquipe ? (
              <Link href={lienFrais('a-valider')} className={buttonClasses('secondary', 'sm')}>
                À valider pour mon équipe
              </Link>
            ) : null}
            {avancesOuvertes && !fraisEteints ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                onClick={() => setOuvert({ type: 'nouvelle-avance' })}
              >
                + Demander une avance
              </button>
            ) : null}
            {!fraisEteints ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                onClick={() => setOuvert({ type: 'nouvelle-note' })}
              >
                + Nouvelle note
              </button>
            ) : null}
          </>
        }
      />
      {fraisEteints ? (
        <PhraseSection>
          Les notes de frais sont éteintes dans les réglages de votre organisation.
        </PhraseSection>
      ) : null}

      <Panneau titre="Mes notes de frais" icone={Receipt}>
        {notes === null ? (
          <Chargement />
        ) : !notes.ok ? (
          <EchecLecture erreur={notes.erreur} repli="Notes illisibles." onReessayer={relire} />
        ) : notes.valeur.items.length === 0 ? (
          <PhraseSection>Aucune note pour l’instant.</PhraseSection>
        ) : (
          <GrilleCartes>
            {notes.valeur.items.map((n) => (
              <Carte
                key={n.id}
                titre={n.title}
                detail={`${n.number ?? 'Brouillon'} · ${n.lines.length} ligne${n.lines.length > 1 ? 's' : ''}${n.submittedAt ? ` · envoyée le ${formatJour(n.submittedAt.slice(0, 10))}` : ''}`}
                statut={LIBELLES_STATUT_NOTE[n.status]}
                ton={tonStatutNote(n.status)}
                valeur={montant(n.total, n.currency)}
                onOuvrir={() => setOuvert({ type: 'note', note: n })}
              />
            ))}
          </GrilleCartes>
        )}
      </Panneau>

      <Panneau titre="Mes avances" icone={HandCoins}>
        {avances === null ? (
          <Chargement />
        ) : !avances.ok ? (
          <EchecLecture erreur={avances.erreur} repli="Avances illisibles." onReessayer={relire} />
        ) : avances.valeur.items.length === 0 ? (
          <PhraseSection>Aucune avance.</PhraseSection>
        ) : (
          <GrilleCartes>
            {avances.valeur.items.map((v) => (
              <Carte
                key={v.id}
                titre={libelleNatureAvance(v.kind)}
                detail={`${v.number ?? 'Brouillon'}${v.disbursement ? ` · reste dû ${montant(v.outstanding, v.currency)}` : ''}`}
                statut={LIBELLES_STATUT_AVANCE[v.status]}
                ton={tonStatutAvance(v.status)}
                valeur={montant(v.amount, v.currency)}
                onOuvrir={() => setOuvert({ type: 'avance', avance: v })}
              />
            ))}
          </GrilleCartes>
        )}
      </Panneau>

      {ouvert?.type === 'nouvelle-note' ? (
        <NoteFormulaire
          onFermer={() => setOuvert(null)}
          onEnregistree={(n) => {
            relire();
            setOuvert({ type: 'note', note: n });
          }}
        />
      ) : null}
      {ouvert?.type === 'nouvelle-avance' ? (
        <AvanceFormulaire
          salaireOuvert={reglages?.advances.enabled.salary === true}
          onFermer={() => setOuvert(null)}
          onEnregistree={() => {
            relire();
            setOuvert(null);
          }}
        />
      ) : null}
      {ouvert?.type === 'note' ? (
        <NoteDetail
          note={ouvert.note}
          moi={moi}
          actions={actions}
          dansAValider={false}
          onFermer={() => setOuvert(null)}
          onChangee={relire}
        />
      ) : null}
      {ouvert?.type === 'avance' ? (
        <AvanceDetail
          avance={ouvert.avance}
          moi={moi}
          actions={actions}
          equipe={equipe}
          onFermer={() => setOuvert(null)}
          onChangee={relire}
        />
      ) : null}
    </section>
  );
}

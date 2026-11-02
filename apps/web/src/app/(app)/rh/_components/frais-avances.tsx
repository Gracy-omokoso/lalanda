'use client';

// « Frais et avances » — ADR-0051 § 10 (lot H16) : `?vue=a-valider|a-payer|toutes`.
// À valider (manager de l'étape ou `expenses.approve` ; l'API ne rend que ce que
// l'appelant peut décider), à payer (`payables.pay`), toutes (`expenses.approve`,
// `payables.pay`, `hr.read` — sans justificatif pour `hr.read` seul).

import { ClipboardCheck, HandCoins, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { AdvanceStatus } from '@lalanda/shared/hr';

import {
  rh2Api,
  type AdvancePage,
  type AdvanceView,
  type ExpenseReportPage,
  type ExpenseReportView,
} from '@/lib/api-rh-2';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { AvanceDetail } from './avance';
import {
  LIBELLES_STATUT_AVANCE,
  LIBELLES_STATUT_NOTE,
  LIBELLES_VUE,
  lienFrais,
  libelleNatureAvance,
  montant,
  tonStatutAvance,
  tonStatutNote,
  vueFrais,
  vuesFraisOffertes,
} from './frais-model';
import { NoteDetail } from './note-frais';
import { useAccesRh } from './rh-access';
import { Carte, GrilleCartes, useEquipe, useMoi } from './rh2-ui';
import { lire, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection } from './rh-ui';

const SOUS_TITRES = {
  'a-valider':
    'Les notes et avances qui attendent votre décision. Celui qui demande ne valide pas, celui qui a saisi pour un collègue non plus, et les deux étapes sont tenues par deux personnes différentes.',
  'a-payer':
    'Les notes approuvées à rembourser et les avances approuvées à verser. Celui qui a validé l’étape financière ne paie pas s’il existe un autre payeur.',
  toutes:
    'Toutes les notes et avances envoyées. Les montants sont ceux calculés par Lalanda ; les justificatifs restent dans les ressources humaines.',
} as const;

const STATUT_AVANCES: Record<'a-valider' | 'a-payer', AdvanceStatus> = {
  'a-valider': 'submitted',
  'a-payer': 'approved',
};

type Ouvert =
  { type: 'note'; note: ExpenseReportView } | { type: 'avance'; avance: AdvanceView } | null;

export function FraisAvances(): React.ReactElement {
  const { actions } = useAccesRh();
  const params = useSearchParams();
  const vue = vueFrais(params.get('vue'), actions);
  const moi = useMoi();
  const equipe = useEquipe(moi.estManager);
  const [notes, setNotes] = useState<Lecture<ExpenseReportPage> | null>(null);
  const [avances, setAvances] = useState<Lecture<AdvancePage> | null>(null);
  const [ouvert, setOuvert] = useState<Ouvert>(null);
  const [version, setVersion] = useState(0);
  const relire = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let annule = false;
    setNotes(null);
    setAvances(null);
    void lire(rh2Api.listExpenseReports({ view: vue, limit: 100 })).then((l) => {
      if (!annule) setNotes(l);
    });
    void lire(
      rh2Api.listAdvances({
        limit: 100,
        ...(vue === 'toutes' ? {} : { status: STATUT_AVANCES[vue] }),
      }),
    ).then((l) => {
      if (!annule) setAvances(l);
    });
    return () => {
      annule = true;
    };
  }, [vue, version]);

  const vues = vuesFraisOffertes(actions);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ClipboardCheck}
        titre={`Frais et avances — ${LIBELLES_VUE[vue].toLowerCase()}`}
        sousTitre={SOUS_TITRES[vue]}
        actions={
          vues.length > 1 ? (
            <nav className="flex gap-1" aria-label="Vues des frais">
              {vues.map((v) => (
                <Link
                  key={v}
                  href={lienFrais(v)}
                  className={BOUTON_PETIT}
                  aria-current={vue === v ? 'page' : undefined}
                >
                  {LIBELLES_VUE[v]}
                </Link>
              ))}
            </nav>
          ) : null
        }
      />

      <Panneau titre="Notes de frais" icone={Receipt}>
        {notes === null ? (
          <Chargement />
        ) : !notes.ok ? (
          <EchecLecture erreur={notes.erreur} repli="Notes illisibles." onReessayer={relire} />
        ) : notes.valeur.items.length === 0 ? (
          <PhraseSection>
            {vue === 'a-valider'
              ? 'Rien à valider pour vous.'
              : vue === 'a-payer'
                ? 'Rien à rembourser.'
                : 'Aucune note.'}
          </PhraseSection>
        ) : (
          <GrilleCartes>
            {notes.valeur.items.map((n) => (
              <Carte
                key={n.id}
                titre={`${n.employeeName} · ${n.title}`}
                detail={`${n.number ?? 'Brouillon'} · ${n.lines.length} ligne${n.lines.length > 1 ? 's' : ''}`}
                statut={LIBELLES_STATUT_NOTE[n.status]}
                ton={tonStatutNote(n.status)}
                valeur={montant(
                  vue === 'a-payer' ? (n.toReimburse ?? n.total) : n.total,
                  n.currency,
                )}
                onOuvrir={() => setOuvert({ type: 'note', note: n })}
              />
            ))}
          </GrilleCartes>
        )}
      </Panneau>

      <Panneau titre="Avances" icone={HandCoins}>
        {avances === null ? (
          <Chargement />
        ) : !avances.ok ? (
          <EchecLecture erreur={avances.erreur} repli="Avances illisibles." onReessayer={relire} />
        ) : avances.valeur.items.length === 0 ? (
          <PhraseSection>Aucune avance dans cette vue.</PhraseSection>
        ) : (
          <GrilleCartes>
            {avances.valeur.items.map((v) => (
              <Carte
                key={v.id}
                titre={`${v.employeeName} · ${libelleNatureAvance(v.kind)}`}
                detail={v.number ?? 'Brouillon'}
                statut={LIBELLES_STATUT_AVANCE[v.status]}
                ton={tonStatutAvance(v.status)}
                valeur={montant(v.amount, v.currency)}
                onOuvrir={() => setOuvert({ type: 'avance', avance: v })}
              />
            ))}
          </GrilleCartes>
        )}
      </Panneau>

      {ouvert?.type === 'note' ? (
        <NoteDetail
          note={ouvert.note}
          moi={moi}
          actions={actions}
          dansAValider={vue === 'a-valider'}
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

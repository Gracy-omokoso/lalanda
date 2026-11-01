'use client';

// Vue d'ensemble de la comptabilité (ADR-0049 § 13). Les bandeaux « Projet » et
// « Simulation » sont posés par la coquille ; ici : réserves en premier, compte
// d'attente, « À comptabiliser », dernières clôtures, rapprochement du mois avec le
// réalisé. Chaque bloc lit sa route ; 404 → « bientôt disponible ».

import { Badge, buttonClasses } from '@lalanda/ui';
import { Calculator, GitCompareArrows, Lock, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { accountingApi } from '@/lib/api-accounting';

import { useAccesCompta } from './comptabilite-access';
import {
  COMPTA_BASE,
  LIBELLES_MODE,
  bornesDuMois,
  formatInstantJour,
  formatValeur,
  moisDe,
  peutParametrer,
} from './comptabilite-model';
import {
  Bandeau,
  CarteVide,
  Chargement,
  ChoixMois,
  EchecLecture,
  Panneau,
  PhraseSection,
  Reserves,
  Terme,
  Tuile,
} from './comptabilite-ui';
import { LIBELLES_CAUSE } from './libelles';
import { useLecture } from './use-lecture';
import {
  dernieresClotures,
  phraseMode,
  reservesDe,
  tuilesVue,
  type TuileVue,
} from './vue-ensemble-model';

function TuileCompta({ t }: { t: TuileVue }): React.ReactElement {
  const c = t.contenu;
  const tuile = (
    <Tuile
      libelle={t.libelle}
      valeur={
        c.etat === 'connu' ? (
          c.valeur
        ) : (
          <span className="text-sm font-normal text-[var(--foreground-muted)]">{c.phrase}</span>
        )
      }
      detail={c.etat === 'connu' ? (c.detail ?? undefined) : undefined}
      attention={c.etat === 'connu' && c.attention}
    />
  );
  return t.lien ? (
    <Link
      href={t.lien}
      className="block rounded-[var(--radius-md)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
    >
      {tuile}
    </Link>
  ) : (
    tuile
  );
}

export function VueEnsemble(): React.ReactElement {
  const { actions, mode } = useAccesCompta();
  const [mois, setMois] = useState(() => moisDe(new Date()));
  const bornes = bornesDuMois(mois);
  const allumee = mode === 'simulation' || mode === 'active';

  const balance = useLecture(
    () =>
      bornes ? accountingApi.trialBalance(bornes) : Promise.reject(new Error('Mois illisible.')),
    `${mois}-${String(mode)}`,
  );
  const aComptabiliser = useLecture(() => accountingApi.listPending(), String(mode));
  const exercices = useLecture(
    () => accountingApi.listFiscalYears().then((r) => r.items),
    String(mode),
  );
  const rapprochement = useLecture(
    () => accountingApi.reconciliation(mois),
    `${mois}-${String(mode)}`,
  );

  const phrase = phraseMode(mode);
  const tuiles = balance && aComptabiliser ? tuilesVue({ balance, aComptabiliser }) : null;
  const reserves = balance ? reservesDe(balance) : null;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Calculator}
        titre="Vue d’ensemble"
        sousTitre={
          mode ? (
            <>
              Mode : <strong>{LIBELLES_MODE[mode]}</strong>. Les écritures sont tirées de vos
              ventes, dépenses et paiements.
            </>
          ) : (
            'Les écritures sont tirées de vos ventes, dépenses et paiements.'
          )
        }
        actions={
          peutParametrer(actions) ? (
            <Link href={`${COMPTA_BASE}/reglages`} className={buttonClasses('secondary', 'sm')}>
              Réglages
            </Link>
          ) : null
        }
      >
        <ChoixMois id="compta-vue-mois" libelle="Mois" valeur={mois} onChange={setMois} />
        {phrase && !allumee ? <PhraseSection>{phrase}</PhraseSection> : null}
        {tuiles === null ? (
          <Chargement />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {tuiles.map((t) => (
              <TuileCompta key={t.id} t={t} />
            ))}
          </div>
        )}
      </Bandeau>

      <Panneau
        titre={<Terme terme="reserve">Réserves</Terme>}
        icone={ShieldAlert}
        id="compta-reserves"
      >
        {balance === null ? (
          <Chargement />
        ) : reserves === null ? (
          !balance.ok ? (
            <EchecLecture erreur={balance.erreur} repli="Les réserves sont illisibles." />
          ) : null
        ) : (
          <Reserves reserves={reserves} />
        )}
      </Panneau>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panneau
          titre="Dernières clôtures"
          icone={Lock}
          id="compta-dernieres-clotures"
          action={
            <Link href={`${COMPTA_BASE}/clotures`} className="text-sm underline underline-offset-2">
              Clôtures
            </Link>
          }
        >
          {exercices === null ? (
            <Chargement />
          ) : !exercices.ok ? (
            <EchecLecture erreur={exercices.erreur} repli="Les clôtures sont illisibles." />
          ) : dernieresClotures(exercices.valeur).length === 0 ? (
            <PhraseSection>Aucun mois n’est encore clos.</PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {dernieresClotures(exercices.valeur).map((c) => (
                <li key={c.cle} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">{c.libelle}</span>
                  <span className="text-[var(--foreground-muted)]">
                    clos le {formatInstantJour(c.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panneau>

        <Panneau
          titre="Rapprochement avec le réalisé"
          icone={GitCompareArrows}
          id="compta-rapprochement"
        >
          <PhraseSection>
            Le réalisé suit votre plan ; la comptabilité tient des comptes. Elles peuvent différer
            pour des raisons connues : chaque écart est expliqué, jamais corrigé en silence.
          </PhraseSection>
          {rapprochement === null ? (
            <Chargement />
          ) : !rapprochement.ok ? (
            <EchecLecture erreur={rapprochement.erreur} repli="Le rapprochement est illisible." />
          ) : !rapprochement.valeur.available ? (
            <CarteVide>
              {rapprochement.valeur.unavailableReason === 'NO_LINKED_PROJECT'
                ? 'Aucune initiative n’est reliée au réalisé : rien à rapprocher.'
                : 'Rapprochement non disponible pour ce mois.'}
            </CarteVide>
          ) : rapprochement.valeur.metrics.length === 0 ? (
            <CarteVide>Rien à rapprocher pour ce mois.</CarteVide>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {rapprochement.valeur.metrics.map((m) => (
                <li key={m.key} className="flex flex-col gap-1 py-2">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-[var(--foreground-muted)]">
                    Réalisé : {m.actual === null ? '—' : formatValeur(m.actual, m.currency)} ·
                    Comptabilité : {formatValeur(m.accounting, m.currency)} · Écart :{' '}
                    {m.difference === null ? '—' : formatValeur(m.difference, m.currency)}
                  </span>
                  {m.causes.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {m.causes.map((c) => (
                        <Badge
                          key={c.cause}
                          tone={c.cause === 'UNEXPLAINED' ? 'danger' : 'neutral'}
                        >
                          {LIBELLES_CAUSE[c.cause]} {formatValeur(c.amount, m.currency)}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panneau>
      </div>
    </section>
  );
}

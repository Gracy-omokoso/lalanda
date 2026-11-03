'use client';

// Réglages de la comptabilité (ADR-0049 § 13) : assistant d'activation, plan de
// l'organisation, règles de correspondance (création depuis le plan, modification d'un
// brouillon, validation avec déclaration de relecture ; chaque règle « à revoir » signalée
// avec son motif),
// journaux, taux saisis. Lecture `accounting.read` ; les modifications passent par
// `accounting.manage` (et `fiscal.manage` pour l'activation), vérifiées par l'API.
//
// Les comptes, règles, journaux et taux viennent TOUS de l'API : aucun numéro de compte
// n'est écrit dans ce fichier.

import { ACCOUNTING_TO_CONFIRM_LABEL } from '@lalanda/shared/accounting';
import { Badge } from '@lalanda/ui';
import { BookOpenCheck, Coins, Library, Scale, Settings2 } from 'lucide-react';

import {
  accountingApi,
  type AccountingAccountView,
  type AccountingChartPackDetail,
  type AccountingExchangeRateView,
  type AccountingJournalView,
  type AccountingRuleSetView,
} from '@/lib/api-accounting';

import { Activation } from './activation';
import { useAccesCompta } from './comptabilite-access';
import { type Lecture } from './comptabilite-model';
import {
  AConfirmer,
  Bandeau,
  CarteVide,
  Chargement,
  EchecLecture,
  Panneau,
  Terme,
} from './comptabilite-ui';
import { LIBELLES_JOURNAL } from './libelles';
import { GestesRegles, TableauRegles, usePackChoisi } from './regles';
import { useLecture } from './use-lecture';

function Plan({ l }: { l: Lecture<AccountingAccountView[]> | null }): React.ReactElement {
  if (l === null) return <Chargement />;
  if (!l.ok)
    return <EchecLecture erreur={l.erreur} repli="Le plan de l’organisation est illisible." />;
  if (l.valeur.length === 0) {
    return (
      <CarteVide>
        Le plan de l’organisation est vide : choisissez d’abord un plan comptable.
      </CarteVide>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead className="text-left text-xs text-[var(--foreground-muted)]">
          <tr>
            <th className="py-2 pr-3 font-medium">Compte</th>
            <th className="py-2 pr-3 font-medium">Libellé</th>
            <th className="py-2 pr-3 font-medium">Origine</th>
            <th className="py-2 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {l.valeur.map((c) => (
            <tr key={c.number} className={c.active ? '' : 'opacity-60'}>
              <td className="py-2 pr-3 font-mono tabular-nums">{c.number}</td>
              <td className="py-2 pr-3">
                {c.label}
                {c.packLabel && c.packLabel !== c.label ? (
                  <span className="block text-xs text-[var(--foreground-muted)]">
                    Libellé du plan : {c.packLabel}
                  </span>
                ) : null}
                {c.auxiliaryKind ? (
                  <span className="block text-xs text-[var(--foreground-muted)]">
                    {c.auxiliaryKind === 'customer'
                      ? 'Comptes des clients'
                      : 'Comptes des fournisseurs'}
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3">
                {c.origin === 'pack' ? 'Plan comptable' : 'Organisation'}
              </td>
              <td className="py-2">
                {c.confirmation === 'to_confirm' ? (
                  <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} />
                ) : c.active ? null : (
                  <Badge tone="neutral">Archivé</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Regles({
  l,
  pack,
}: {
  l: Lecture<AccountingRuleSetView[]> | null;
  pack: Lecture<AccountingChartPackDetail> | null;
}): React.ReactElement {
  if (l === null) return <Chargement />;
  if (!l.ok) return <EchecLecture erreur={l.erreur} repli="Les règles sont illisibles." />;
  return (
    <div className="flex flex-col gap-4">
      {l.valeur.length === 0 ? (
        <CarteVide>Aucune version des règles pour le moment.</CarteVide>
      ) : null}
      <GestesRegles jeux={l.valeur} pack={pack} />
      <TableauRegles jeux={l} pack={pack} />
    </div>
  );
}

function Journaux({ l }: { l: Lecture<AccountingJournalView[]> | null }): React.ReactElement {
  if (l === null) return <Chargement />;
  if (!l.ok) return <EchecLecture erreur={l.erreur} repli="Les journaux sont illisibles." />;
  if (l.valeur.length === 0) {
    return <CarteVide>Les journaux sont créés à l’activation.</CarteVide>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {l.valeur.map((j) => (
        <li
          key={j.code}
          className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm"
        >
          <span className="font-mono font-semibold">{j.code}</span>
          <span className="min-w-0 flex-1">{j.label}</span>
          <Badge tone="neutral">{LIBELLES_JOURNAL[j.kind]}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Taux({ l }: { l: Lecture<AccountingExchangeRateView[]> | null }): React.ReactElement {
  if (l === null) return <Chargement />;
  if (!l.ok) return <EchecLecture erreur={l.erreur} repli="Les taux sont illisibles." />;
  if (l.valeur.length === 0) {
    return (
      <CarteVide>
        Aucun taux saisi. Lalanda n’importe jamais de taux d’office : une pièce dans une autre
        devise attend un taux saisi.
      </CarteVide>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
      {l.valeur.map((t) => (
        <li key={`${t.date}-${t.from}-${t.to}`} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
          <span className="tabular-nums">{t.date}</span>
          <span className="font-medium tabular-nums">
            1 {t.from} = {t.rate.replace('.', ',')} {t.to}
          </span>
          {t.sourceText ? (
            <span className="text-[var(--foreground-muted)]">{t.sourceText}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function Reglages(): React.ReactElement {
  const { reglages } = useAccesCompta();
  const pack = usePackChoisi(reglages?.ok ? reglages.valeur : null);
  const plan = useLecture(() => accountingApi.listAccounts().then((r) => r.items), reglages);
  const regles = useLecture(() => accountingApi.listRuleSets().then((r) => r.items), reglages);
  const journaux = useLecture(() => accountingApi.listJournals().then((r) => r.items), reglages);
  const taux = useLecture(() => accountingApi.listExchangeRates().then((r) => r.items), reglages);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Settings2}
        titre="Réglages"
        sousTitre="Activer la comptabilité, choisir le plan, la monnaie de tenue, la bascule et les règles."
      />
      <Activation />
      <Panneau titre="Plan de l’organisation" icone={Library} id="compta-plan">
        <Plan l={plan} />
      </Panneau>
      <Panneau
        titre={<Terme terme="regle">Règles de correspondance</Terme>}
        icone={Scale}
        id="compta-regles"
      >
        <Regles l={regles} pack={pack} />
      </Panneau>
      <Panneau
        titre={<Terme terme="journal">Journaux</Terme>}
        icone={BookOpenCheck}
        id="compta-journaux"
      >
        <Journaux l={journaux} />
      </Panneau>
      <Panneau titre="Taux de change saisis" icone={Coins} id="compta-taux">
        <Taux l={taux} />
      </Panneau>
    </section>
  );
}

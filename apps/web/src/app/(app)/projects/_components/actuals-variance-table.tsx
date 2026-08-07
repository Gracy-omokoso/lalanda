'use client';

// Tableaux « Écarts » et « Projection actualisée » de l'onglet Réalisé (S18b — docs/08).
//
// Règles d'affichage :
// - le statut favorable/défavorable est TOUJOURS un texte, la pastille de couleur
//   n'est qu'un renfort (docs/04 — jamais d'information portée par la seule couleur) ;
// - une ligne non comparable (ADR-0011 friction n°3) affiche « Non comparable »
//   et des tirets, jamais un écart fabriqué.

import type { ProjectionLineView, VarianceLineView } from '@/lib/api';

import { money, percent, raisonLabel, signedMoney } from './actuals-format';

function StatutCell({ line }: { line: VarianceLineView }): React.ReactElement {
  if (!line.comparable) {
    return (
      <span className="inline-flex items-center gap-1.5" title={raisonLabel(line.raison)}>
        <span aria-hidden="true" className="dot dot-warn" />
        <span className="text-[var(--foreground-muted)]">Non comparable</span>
      </span>
    );
  }
  const favorable = line.statut === 'favorable';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={favorable ? 'dot dot-ok' : 'dot dot-ko'} />
      <span style={{ color: favorable ? 'var(--ok)' : 'var(--ko)' }}>
        {favorable ? 'Favorable' : 'Défavorable'}
      </span>
    </span>
  );
}

const TH = 'py-2 px-2 text-left font-medium text-[var(--foreground-muted)] whitespace-nowrap';
const TH_NUM = 'py-2 px-2 text-right font-medium text-[var(--foreground-muted)] whitespace-nowrap';
const TD_NUM = 'py-2.5 px-2 text-right fig whitespace-nowrap';

export function ActualsVarianceTable({
  lines,
  currency,
  monthsCounted,
}: {
  lines: VarianceLineView[];
  currency: string;
  monthsCounted: number[];
}): React.ReactElement {
  const nonComparables = lines.filter((l) => !l.comparable);
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Écarts cumulés
        </h3>
        <p className="text-xs text-[var(--foreground-muted)]">
          {monthsCounted.length === 0
            ? 'Aucun mois saisi'
            : `Cumul sur ${monthsCounted.length} mois saisi${monthsCounted.length > 1 ? 's' : ''}`}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="sr-only">
            Comparaison du réalisé cumulé au plan validé, ligne par ligne.
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className={TH}>
                Ligne
              </th>
              <th scope="col" className={TH_NUM}>
                Prévu cumulé
              </th>
              <th scope="col" className={TH_NUM}>
                Réalisé cumulé
              </th>
              <th scope="col" className={TH_NUM}>
                Écart
              </th>
              <th scope="col" className={TH_NUM}>
                Écart %
              </th>
              <th scope="col" className={TH}>
                Statut
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineId} className="border-b border-[var(--border)]">
                <th scope="row" className="py-2.5 px-2 text-left font-normal">
                  {line.label}
                  <span className="ml-2 text-[11px] text-[var(--foreground-muted)]">
                    {line.sens === 'charge' ? 'charge' : 'produit'}
                  </span>
                </th>
                <td className={TD_NUM}>{money(line.prevuCumule, currency)}</td>
                <td className={TD_NUM}>{money(line.realiseCumule, currency)}</td>
                <td className={TD_NUM}>{signedMoney(line.ecart, currency)}</td>
                <td className={TD_NUM}>{percent(line.ecartPct)}</td>
                <td className="py-2.5 px-2 text-left">
                  <StatutCell line={line} />
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-[var(--foreground-muted)]">
                  Le plan validé comparé ne contient aucune ligne de compte d’exploitation.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {nonComparables.length > 0 ? (
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--foreground-muted)]">
          <strong className="font-semibold">
            {nonComparables.length} ligne{nonComparables.length > 1 ? 's' : ''} non comparable
            {nonComparables.length > 1 ? 's' : ''}
          </strong>{' '}
          — {raisonLabel(nonComparables[0]?.raison ?? null)} Le réalisé saisi reste affiché ; aucun
          écart n’est estimé à partir d’un plan qui ne contient pas la ligne.
        </p>
      ) : null}
    </section>
  );
}

export function ActualsProjectionTable({
  lines,
  currency,
  monthsClosed,
}: {
  lines: ProjectionLineView[];
  currency: string;
  monthsClosed: number[];
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Projection actualisée
        </h3>
        <p className="text-xs text-[var(--foreground-muted)]">
          {monthsClosed.length} mois clôturé{monthsClosed.length > 1 ? 's' : ''} observé
          {monthsClosed.length > 1 ? 's' : ''} + {12 - monthsClosed.length} mois estimé
          {12 - monthsClosed.length > 1 ? 's' : ''}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="sr-only">
            Estimation de fin d’exercice combinant les mois clôturés et le prévisionnel restant.
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className={TH}>
                Ligne
              </th>
              <th scope="col" className={TH_NUM}>
                Plan annuel
              </th>
              <th scope="col" className={TH_NUM}>
                Réalisé clôturé
              </th>
              <th scope="col" className={TH_NUM}>
                Prévisionnel restant
              </th>
              <th scope="col" className={TH_NUM}>
                Total projeté
              </th>
              <th scope="col" className={TH_NUM}>
                Écart vs plan
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineId} className="border-b border-[var(--border)]">
                <th scope="row" className="py-2.5 px-2 text-left font-normal">
                  {line.label}
                  {!line.comparable ? (
                    <span
                      className="ml-2 text-[11px] text-[var(--foreground-muted)]"
                      title={raisonLabel(line.raison)}
                    >
                      non comparable
                    </span>
                  ) : null}
                </th>
                <td className={TD_NUM}>{money(line.planAnnuel, currency)}</td>
                <td className={TD_NUM}>{money(line.realiseClos, currency)}</td>
                <td className={TD_NUM}>{money(line.previsionnelRestant, currency)}</td>
                <td className={`${TD_NUM} font-semibold`}>{money(line.totalProjete, currency)}</td>
                <td className={TD_NUM}>{signedMoney(line.ecartVsPlan, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs italic text-[var(--foreground-muted)]">
        Méthode affichée (docs/08) : observation = mois clôturés uniquement ; estimation = plan
        annuel ÷ 12 sur les mois restants. Un mois saisi mais non clôturé reste une estimation.
      </p>
    </section>
  );
}

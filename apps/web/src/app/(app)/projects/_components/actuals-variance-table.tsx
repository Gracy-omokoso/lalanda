'use client';

// Tableaux « Écarts » et « Projection actualisée » de l'onglet Réalisé (S18b — docs/08).
//
// Règles d'affichage :
// - le statut est TOUJOURS un texte, la pastille de couleur n'est qu'un renfort
//   (docs/04 — jamais d'information portée par la seule couleur) ;
// - une ligne non comparable (ADR-0011) ou jamais saisie affiche son état en
//   toutes lettres et des tirets, jamais un écart fabriqué ;
// - la méthode de calcul de la base annuelle est affichée (docs/08 § Projection).

import type { ProjectionLineView, VarianceLineView } from '@/lib/api';

import { baseLabel, money, percent, raisonLabel, signedMoney } from './actuals-format';

/**
 * Cellule de statut. Trois états « sans comparaison possible » distincts, chacun
 * explicite : non comparable (le plan n'offre pas de base), non saisi (l'utilisateur
 * n'a rien entré), et les trois statuts d'écart réels.
 */
function StatutCell({ line }: { line: VarianceLineView }): React.ReactElement {
  if (!line.comparable) {
    return (
      <span className="inline-flex items-center gap-1.5" title={raisonLabel(line.raison)}>
        <span aria-hidden="true" className="dot dot-warn" />
        <span className="text-[var(--foreground-muted)]">Non comparable</span>
      </span>
    );
  }
  if (!line.saisi) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title="Aucun montant saisi sur la période — aucun écart n’est calculé."
      >
        <span
          aria-hidden="true"
          className="dot"
          style={{ backgroundColor: 'var(--border-strong)' }}
        />
        <span className="text-[var(--foreground-muted)]">Non saisi</span>
      </span>
    );
  }
  if (line.statut === 'conforme') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="dot dot-ok" />
        <span>Conforme</span>
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

/** Libellé de ligne + qualificatif d'état (sens seulement si la ligne est comparable). */
function LineHeader({
  label,
  sens,
  comparable,
  raison,
}: {
  label: string;
  sens: 'produit' | 'charge';
  comparable: boolean;
  raison: string | null;
}): React.ReactElement {
  return (
    <>
      {label}
      {comparable ? (
        <span className="ml-2 text-[11px] text-[var(--foreground-muted)]">
          {sens === 'charge' ? 'charge' : 'produit'}
        </span>
      ) : (
        // Sur une ligne non comparable, le sens n'a pas d'usage : aucun statut n'en
        // découle. On affiche la cause à la place.
        <span
          className="ml-2 text-[11px] text-[var(--foreground-muted)]"
          title={raisonLabel(raison)}
        >
          non comparable
        </span>
      )}
    </>
  );
}

/** Regroupe les lignes non comparables par cause, pour une bannière exacte. */
function groupByRaison(lines: { raison: string | null }[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const l of lines) counts.set(l.raison, (counts.get(l.raison) ?? 0) + 1);
  return counts;
}

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
  const parRaison = groupByRaison(nonComparables);
  const diagnostics = lines.flatMap((l) => l.diagnostics.map((d) => ({ label: l.label, ...d })));

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Écarts cumulés
        </h3>
        <p className="text-xs text-[var(--foreground-muted)]">
          {monthsCounted.length === 0
            ? 'Aucun mois saisi'
            : `${monthsCounted.length} mois saisi${monthsCounted.length > 1 ? 's' : ''} — chaque ligne n’est cumulée que sur les mois où elle est renseignée`}
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
                  <LineHeader
                    label={line.label}
                    sens={line.sens}
                    comparable={line.comparable}
                    raison={line.raison}
                  />
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

      {diagnostics.length > 0 ? (
        <ul
          role="status"
          className="flex flex-col gap-1 rounded-md border border-[var(--warn)]/40 bg-[var(--surface-muted)] px-3 py-2 text-xs"
        >
          {diagnostics.map((d) => (
            <li key={`${d.label}-${d.code}`} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="dot dot-warn mt-1" />
              <span>
                <strong className="font-semibold">{d.label}</strong> — {d.message} (mois{' '}
                {d.months.join(', ')})
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {nonComparables.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--foreground-muted)]">
          {[...parRaison.entries()].map(([raison, count]) => (
            <p key={raison ?? 'inconnu'}>
              <strong className="font-semibold">
                {count} ligne{count > 1 ? 's' : ''}
              </strong>{' '}
              — {raisonLabel(raison)}
            </p>
          ))}
          <p>
            Le réalisé saisi reste affiché ; aucun écart n’est estimé à partir d’un plan qui ne
            contient pas la référence.
          </p>
        </div>
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
  const restants = 12 - monthsClosed.length;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Projection actualisée
        </h3>
        <p className="text-xs text-[var(--foreground-muted)]">
          {monthsClosed.length} mois clôturé{monthsClosed.length > 1 ? 's' : ''} observé
          {monthsClosed.length > 1 ? 's' : ''} + {restants} mois estimé{restants > 1 ? 's' : ''}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <caption className="sr-only">
            Estimation de fin d’exercice combinant les mois clôturés et le prévisionnel restant.
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className={TH}>
                Ligne
              </th>
              <th scope="col" className={TH}>
                Base
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
                  <LineHeader
                    label={line.label}
                    sens={line.sens}
                    comparable={line.comparable}
                    raison={line.raison}
                  />
                </th>
                <td className="py-2.5 px-2 text-left text-[11px] text-[var(--foreground-muted)]">
                  {baseLabel(line.base)}
                </td>
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
        Méthode affichée (docs/08) : observation = mois clôturés uniquement ; estimation = base
        annuelle de l’exercice ÷ 12 sur les mois restants. Un mois saisi mais non clôturé reste une
        estimation. Un tiret signale une donnée absente du plan ou de la saisie — jamais un zéro
        supposé.
      </p>
    </section>
  );
}

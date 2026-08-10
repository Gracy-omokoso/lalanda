'use client';

// Onglets de feuilles de la vue résultats (S13d, éclatée en écran propre S23a).
//
// Une feuille = un onglet = une URL (`?tab=`). Le lien d'un onglet est
// partageable et le retour navigateur ramène à l'onglet précédent : la
// navigation est poussée dans l'historique (`push`) et non remplacée, sinon
// « précédent » sortait du projet d'un coup depuis le cinquième onglet
// consulté.

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import type { AmortissementsView, EtatsFinanciersView, LineResult } from '@/lib/api';
import { LIENS_AIDE } from '@/lib/aide/liens';

import { LienAideFeuille } from './aide-contextuelle';
import { AmortissementsTable } from './amortissements-table';
import { BfrTable, BilanTable, CafTable, SeuilTable } from './etats-financiers-tables';
import { RatiosStickyBanner } from './ratios-sticky-banner';
import {
  SHEET_LABELS,
  SHEET_WARNINGS,
  buildResultTabs,
  formatValue,
  groupLinesBySheet,
  linesForTab,
  resolveActiveTab,
} from './results-model';
import { SheetTabs } from './sheet-tabs';

interface ResultsTabsProps {
  lines: LineResult[];
  currency: string;
  amortissements?: AmortissementsView;
  etatsFinanciers?: EtatsFinanciersView;
}

export function ResultsTabs({
  lines,
  currency,
  amortissements,
  etatsFinanciers,
}: ResultsTabsProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const bySheet = useMemo(() => groupLinesBySheet(lines), [lines]);

  // Onglets rendus depuis une struct dédiée plutôt que depuis des lignes :
  // `amortissements` (S14c) et `bfr` (S18a, lignes portées par plan_financement).
  const tabs = useMemo(() => {
    const virtual: string[] = [];
    if (amortissements !== undefined) virtual.push('amortissements');
    if (etatsFinanciers !== undefined) virtual.push('bfr');
    return buildResultTabs(bySheet.keys(), virtual);
  }, [bySheet, amortissements, etatsFinanciers]);

  const activeTab = resolveActiveTab(searchParams.get('tab'), tabs);

  const setActiveTab = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('tab', id);
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const activeLines = linesForTab(bySheet, activeTab);
  const avertissement = SHEET_WARNINGS[activeTab];

  return (
    <div className="flex flex-col gap-4">
      <RatiosStickyBanner
        lines={bySheet.get('ratios') ?? []}
        currency={currency}
        onSelect={() => setActiveTab('ratios')}
        hrefAide={LIENS_AIDE.bandeauRatios}
      />
      <SheetTabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} />
      <LienAideFeuille
        idFeuille={activeTab}
        libelleFeuille={SHEET_LABELS[activeTab] ?? activeTab}
      />
      <div
        role="tabpanel"
        id={`sheet-panel-${activeTab}`}
        aria-labelledby={`sheet-tab-${activeTab}`}
      >
        {/* Réserve de portée de la feuille : elle vient du label déclaré par le
            DSL, que l'onglet raccourcit. Elle est placée AVANT le tableau — une
            réserve lue après les chiffres arrive trop tard. */}
        {avertissement ? (
          <p className="mb-3 rounded-md border border-[var(--warn)]/40 bg-[var(--surface-muted)] p-3 text-[0.78rem] leading-relaxed text-[var(--foreground-muted)]">
            <strong className="text-[var(--warn)]">Portée de cette feuille.</strong> {avertissement}
          </p>
        ) : null}
        {activeTab === 'ratios' ? (
          <RatiosCard lines={activeLines} currency={currency} />
        ) : activeTab === 'amortissements' && amortissements ? (
          <AmortissementsTable amortissements={amortissements} currency={currency} />
        ) : activeTab === 'bilan' && etatsFinanciers ? (
          <BilanTable etats={etatsFinanciers} currency={currency} />
        ) : activeTab === 'bfr' && etatsFinanciers ? (
          <BfrTable etats={etatsFinanciers} currency={currency} />
        ) : activeTab === 'caf' && etatsFinanciers ? (
          <CafTable etats={etatsFinanciers} currency={currency} />
        ) : activeTab === 'seuil_rentabilite' && etatsFinanciers ? (
          <SeuilTable etats={etatsFinanciers} currency={currency} />
        ) : (
          <ResultsTable sheetId={activeTab} lines={activeLines} currency={currency} />
        )}
      </div>
    </div>
  );
}

// ─── Sous-composants d'affichage (S10) ───────────────────────

function ResultsTable({
  sheetId,
  lines,
  currency,
}: {
  sheetId: string;
  lines: LineResult[];
  currency: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        {SHEET_LABELS[sheetId] ?? sheetId}
      </h3>
      {/* Les tables financières défilent horizontalement sur mobile (docs/04-UX-UI.md). */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="py-2 pr-2 font-medium text-[var(--foreground-muted)]">Ligne</th>
              <th className="py-2 pl-2 text-right font-medium text-[var(--foreground-muted)]">
                Valeur
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.lineId}
                className={`border-b border-[var(--border)] ${
                  line.lineId === 'resultat_net' ? 'font-semibold text-[var(--accent)]' : ''
                }`}
              >
                <td className="py-2.5 pr-2">{line.label}</td>
                <td className="fig py-2.5 pl-2 text-right">
                  {formatValue(line.value, line.format, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Couleurs des feux tricolores — cohérentes avec la palette produit. */
const STATUT_COLORS: Record<
  'vert' | 'orange' | 'rouge',
  { dot: string; text: string; label: string }
> = {
  vert: { dot: '#16a34a', text: 'text-[#15803d]', label: 'OK' },
  orange: { dot: '#ea580c', text: 'text-[#c2410c]', label: 'Vigilance' },
  rouge: { dot: '#dc2626', text: 'text-[#b91c1c]', label: 'Critique' },
};

function RatiosCard({
  lines,
  currency,
}: {
  lines: LineResult[];
  currency: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        Ratios financiers
      </h3>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const seuilInfo = line.seuil ? STATUT_COLORS[line.seuil.statut] : null;
          return (
            <li
              key={line.lineId}
              className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {seuilInfo ? (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: seuilInfo.dot }}
                    />
                  ) : null}
                  <span className="text-sm font-medium">{line.label}</span>
                </div>
                <span className="fig text-sm font-semibold">
                  {formatValue(line.value, line.format, currency)}
                </span>
              </div>
              {line.seuil && seuilInfo ? (
                <div className={`text-[11px] ${seuilInfo.text}`}>
                  {seuilInfo.label} — seuil {line.seuil.direction === 'min' ? '≥' : '≤'}{' '}
                  {formatValue(line.seuil.valeur, line.format, currency)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

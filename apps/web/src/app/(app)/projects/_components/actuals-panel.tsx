'use client';

// Onglet « Réalisé » (S18b — docs/08, docs/22 § Période réalisée).
//
// Trois blocs : grille de saisie mois × lignes, écarts cumulés vs dernier plan
// validé, projection actualisée. Tous les chiffres viennent de l'API — ce
// composant n'applique aucune règle financière (docs/26).
//
// Les lignes de la grille sont celles renvoyées par `GET /variances` : les lignes
// du compte d'exploitation du plan validé comparé, plus les lignes déjà saisies
// sans contrepartie dans ce plan (« non comparable », ADR-0011 friction n°3).
// Sans plan validé, l'API répond 409 NO_APPROVED_PLAN : on l'affiche tel quel
// plutôt que d'inventer une référence.

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  api,
  type ActualPeriodView,
  type UpdatedProjectionView,
  type VariancesView,
} from '@/lib/api';

import { MONTHS, monthLabel } from './actuals-format';
import { ActualsProjectionTable, ActualsVarianceTable } from './actuals-variance-table';

/** Années d'exercice suivables — même borne que le schéma serveur (1..5). */
const YEARS = [1, 2, 3, 4, 5];

/** Saisies locales non encore envoyées : `{ [month]: { [lineId]: montant } }`. */
type Draft = Record<number, Record<string, number>>;

function errorCode(err: unknown): string | undefined {
  const detail = (err as { detail?: { code?: string } } | undefined)?.detail;
  return detail?.code;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function ActualsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [year, setYear] = useState(1);
  const [currency, setCurrency] = useState('USD');
  const [periods, setPeriods] = useState<ActualPeriodView[]>([]);
  const [variances, setVariances] = useState<VariancesView | null>(null);
  const [projection, setProjection] = useState<UpdatedProjectionView | null>(null);
  const [noPlan, setNoPlan] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Mois dont on saisit le motif de réouverture (docs/08 : motif obligatoire). */
  const [reopenMonth, setReopenMonth] = useState<number | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setDraft({});
    try {
      const [project, { periods: fetched }] = await Promise.all([
        api.getProject(projectId),
        api.listActualPeriods(projectId, year),
      ]);
      setCurrency(project.deviseAffichage || 'USD');
      setPeriods(fetched);
      try {
        const [v, p] = await Promise.all([
          api.getVariances(projectId, year),
          api.getUpdatedProjection(projectId, year),
        ]);
        setVariances(v);
        setProjection(p);
        setNoPlan(false);
      } catch (err) {
        if (errorCode(err) === 'NO_APPROVED_PLAN') {
          setVariances(null);
          setProjection(null);
          setNoPlan(true);
        } else {
          throw err;
        }
      }
    } catch (err) {
      setError(errorMessage(err, 'Impossible de charger le réalisé.'));
    } finally {
      setLoading(false);
    }
  }, [projectId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const byMonth = useMemo(() => new Map(periods.map((p) => [p.month, p])), [periods]);
  const rows = variances?.lines ?? [];
  const dirtyMonths = useMemo(
    () =>
      Object.keys(draft)
        .map(Number)
        .sort((a, b) => a - b),
    [draft],
  );

  function cellValue(month: number, lineId: string): string {
    const local = draft[month]?.[lineId];
    if (local !== undefined) return String(local);
    const saved = byMonth.get(month)?.values[lineId];
    return saved === undefined ? '' : String(saved);
  }

  function editCell(month: number, lineId: string, raw: string): void {
    setNotice(null);
    setDraft((prev) => {
      const monthDraft = { ...(prev[month] ?? {}) };
      if (raw.trim() === '') {
        delete monthDraft[lineId];
        if (Object.keys(monthDraft).length === 0) {
          const rest = { ...prev };
          delete rest[month];
          return rest;
        }
        return { ...prev, [month]: monthDraft };
      }
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) return prev;
      monthDraft[lineId] = parsed;
      return { ...prev, [month]: monthDraft };
    });
  }

  async function handleSave(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const month of dirtyMonths) {
        await api.upsertActualPeriod(projectId, year, month, draft[month] ?? {});
      }
      setNotice(
        `Réalisé enregistré pour ${dirtyMonths.length} mois — écarts et projection recalculés.`,
      );
      await load();
    } catch (err) {
      setError(
        errorCode(err) === 'PERIOD_CLOSED'
          ? 'Période clôturée : rouvrez-la (owner, avec motif) avant de modifier le réalisé.'
          : errorMessage(err, 'Impossible d’enregistrer le réalisé.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(month: number): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // La saisie en cours part avec la clôture — sinon elle serait perdue.
      if (draft[month]) await api.upsertActualPeriod(projectId, year, month, draft[month]);
      await api.closeActualPeriod(projectId, year, month);
      setNotice(`${monthLabel(month)} clôturé — la saisie est désormais protégée.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Impossible de clôturer la période.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen(): Promise<void> {
    if (reopenMonth === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.reopenActualPeriod(projectId, year, reopenMonth, reopenReason);
      setNotice(`${monthLabel(reopenMonth)} rouvert — la réouverture est journalisée.`);
      setReopenMonth(null);
      setReopenReason('');
      await load();
    } catch (err) {
      setError(
        errorCode(err) === 'REOPEN_OWNER_ONLY'
          ? 'Seul un owner de l’organisation peut rouvrir une période clôturée.'
          : errorMessage(err, 'Impossible de rouvrir la période.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            Réalisé
          </h2>
          <p className="text-xs text-[var(--foreground-muted)]">
            Saisie mensuelle observée, comparée au plan validé. Aucune saisie ne modifie le plan.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs text-[var(--foreground-muted)]">Exercice</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                Année {y}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-[var(--accent)]">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement du réalisé…</p>
      ) : noPlan ? (
        <div className="doc-card p-5 text-sm">
          <p className="font-semibold">Aucun plan validé pour ce projet.</p>
          <p className="mt-1 text-[var(--foreground-muted)]">
            Le réalisé se compare toujours à une référence figée. Validez un plan depuis l’onglet
            plan financier, puis revenez saisir les mois écoulés.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                Saisie mensuelle
              </h3>
              <p className="text-xs text-[var(--foreground-muted)]">
                Référence : plan validé v{variances?.planVersion} · prévu mensuel = plan annuel ÷ 12
              </p>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] border-collapse text-sm">
                <caption className="sr-only">
                  Grille de saisie du réalisé : une colonne par mois de l’exercice, une ligne par
                  poste du compte d’exploitation.
                </caption>
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-[var(--background)] py-2 pr-3 text-left font-medium text-[var(--foreground-muted)]"
                    >
                      Ligne
                    </th>
                    {MONTHS.map((month) => {
                      const closed = byMonth.get(month)?.status === 'closed';
                      return (
                        <th key={month} scope="col" className="px-1 py-2 text-center font-medium">
                          <span className="block">{monthLabel(month)}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-normal">
                            <span
                              aria-hidden="true"
                              className={closed ? 'dot dot-ko' : 'dot dot-ok'}
                            />
                            <span className="text-[var(--foreground-muted)]">
                              {closed ? 'Clôturé' : 'Ouvert'}
                            </span>
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-[var(--border)]">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-[var(--background)] py-1.5 pr-3 text-left text-[11px] font-normal text-[var(--foreground-muted)]"
                    >
                      Période
                    </th>
                    {MONTHS.map((month) => {
                      const closed = byMonth.get(month)?.status === 'closed';
                      return (
                        <td key={month} className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              closed ? setReopenMonth(month) : void handleClose(month)
                            }
                            title={
                              closed
                                ? `Rouvrir ${monthLabel(month)} — owner uniquement, motif obligatoire et journalisé`
                                : `Clôturer ${monthLabel(month)} — la saisie sera protégée`
                            }
                            className="w-full rounded border border-[var(--border)] px-1 py-1 text-[11px] transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
                          >
                            {closed ? 'Rouvrir' : 'Clôturer'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((line) => (
                    <tr key={line.lineId} className="border-b border-[var(--border)]">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-[var(--background)] py-2 pr-3 text-left font-normal"
                      >
                        {line.label}
                        {!line.comparable ? (
                          <span className="ml-2 text-[11px] text-[var(--foreground-muted)]">
                            non comparable
                          </span>
                        ) : null}
                      </th>
                      {MONTHS.map((month) => {
                        const closed = byMonth.get(month)?.status === 'closed';
                        return (
                          <td key={month} className="px-1 py-1">
                            <input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              disabled={closed || busy}
                              value={cellValue(month, line.lineId)}
                              onChange={(e) => editCell(month, line.lineId, e.target.value)}
                              aria-label={`${line.label} — ${monthLabel(month)}${closed ? ' (période clôturée)' : ''}`}
                              className="fig w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1.5 text-right text-xs outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--foreground-muted)]"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy || dirtyMonths.length === 0}
                className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-40"
              >
                {busy
                  ? 'Enregistrement…'
                  : dirtyMonths.length === 0
                    ? 'Aucune modification'
                    : `Enregistrer ${dirtyMonths.length} mois`}
              </button>
              <span className="text-xs text-[var(--foreground-muted)]">
                Devise {currency} · les périodes clôturées sont en lecture seule.
              </span>
            </div>

            {reopenMonth !== null ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleReopen();
                }}
                className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
              >
                <label className="flex min-w-[18rem] flex-1 flex-col gap-1 text-sm">
                  <span className="text-xs font-medium">
                    Motif de réouverture de {monthLabel(reopenMonth)} (obligatoire, journalisé)
                  </span>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="Ex. facture fournisseur reçue après la clôture"
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || reopenReason.trim() === ''}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-40"
                >
                  Rouvrir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReopenMonth(null);
                    setReopenReason('');
                  }}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm transition hover:bg-[var(--surface-muted)]"
                >
                  Annuler
                </button>
              </form>
            ) : null}

            <ReopenLog periods={periods} />
          </section>

          {variances ? (
            <ActualsVarianceTable
              lines={variances.lines}
              currency={currency}
              monthsCounted={variances.monthsCounted}
            />
          ) : null}

          {projection ? (
            <ActualsProjectionTable
              lines={projection.lines}
              currency={currency}
              monthsClosed={projection.monthsClosed}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Trace d'audit des réouvertures — exigée par docs/08 § Périodes. */
function ReopenLog({ periods }: { periods: ActualPeriodView[] }): React.ReactElement | null {
  const entries = periods.flatMap((p) => p.reopenedLog.map((e) => ({ month: p.month, ...e })));
  if (entries.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-[var(--foreground-muted)]">
        Historique des réouvertures ({entries.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map((e, i) => (
          <li key={`${e.month}-${i}`} className="text-[var(--foreground-muted)]">
            <span className="font-medium text-[var(--foreground)]">{monthLabel(e.month)}</span> —{' '}
            {new Date(e.reopenedAt).toLocaleString('fr-FR')} — {e.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

'use client';

// Onglet « Trésorerie » (ADR-0034 § 4 et § 7) : comptes et soldes (moteur),
// mouvements, virements, et prévision 7 / 30 / 90 / 180 jours en trois scénarios
// à hypothèses explicites, avec alertes et incertitude. Le jour 0 est une
// observation (soldes) ; tout le reste est une ESTIMATION, et l'écran le dit.

import { Modal, buttonClasses } from '@lalanda/ui';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  messageOf,
  treasuryApi,
  type AccountsPage,
  type LedgerEntry,
  type ScenarioHypotheses,
  type ScenarioId,
  type TreasuryAccountKind,
  type TreasuryCurrency,
  type TreasuryForecast,
  type TreasurySettingsView,
} from '@/lib/treasury-api';

import { lireMontantSaisi } from '../../ventes/_components/sales-model';
import { Bandeau, Section, useAccesTresorerie } from '../_components/treasury-access';
import {
  ACCOUNT_KIND_LABELS,
  FLOW_SOURCE_LABELS,
  FORECAST_FINDING_LABELS,
  SCENARIO_LABELS,
  estNegatif,
  formatMontantSigne,
  geometrieGraphique,
  graduation,
  hypothesesLisibles,
  libelleDate,
  lireMontantSigne,
  lirePourcent,
} from '../_components/treasury-model';

const CHAMP =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60';
const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';
const PETIT =
  'rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

/** Couleurs des scénarios : distinctes en clair et en sombre, doublées d'un trait. */
const SCENARIO_STYLE: Record<ScenarioId, { stroke: string; dash: string }> = {
  optimistic: { stroke: 'var(--success, #15803d)', dash: '' },
  probable: { stroke: 'var(--accent, #2563eb)', dash: '' },
  pessimistic: { stroke: 'var(--danger, #b91c1c)', dash: '5 4' },
};

function aujourdhui(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

export default function ComptesPage(): React.ReactElement {
  const { gerer } = useAccesTresorerie();
  const [page, setPage] = useState<AccountsPage | null>(null);
  const [devise, setDevise] = useState<TreasuryCurrency>('USD');
  const [prevision, setPrevision] = useState<TreasuryForecast | null>(null);
  const [mouvements, setMouvements] = useState<LedgerEntry[]>([]);
  const [compteFiltre, setCompteFiltre] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState<'compte' | 'mouvement' | null>(null);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  function ouvrirCreation(quoi: 'compte' | 'mouvement'): void {
    setErreurCreation(null);
    setCreation(quoi);
  }

  function apresCreation(): void {
    setCreation(null);
    void charger();
  }
  const [reglages, setReglages] = useState<TreasurySettingsView | null>(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const [p, f, m, s] = await Promise.all([
        treasuryApi.listAccounts(),
        treasuryApi.forecast(devise),
        treasuryApi.ledger({ accountId: compteFiltre || undefined }),
        treasuryApi.settings(),
      ]);
      setPage(p);
      setPrevision(f);
      setMouvements(m.items);
      setReglages(s);
    } catch (err) {
      setErreur(messageOf(err));
    }
  }, [devise, compteFiltre]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const nom = new Map((page?.items ?? []).map((a) => [a.id, a.name]));

  return (
    <div className="flex flex-col gap-6">
      {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

      <Section
        titre="Comptes et soldes"
        description={`Soldes au ${page ? libelleDate(page.asOf) : '…'}, calculés à partir du solde d’ouverture et de tous les mouvements enregistrés.`}
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => ouvrirCreation('compte')}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouveau compte
            </button>
          ) : undefined
        }
      >
        {page && page.items.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucun compte. Créez votre caisse, votre compte bancaire ou votre compte mobile money.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(page?.items ?? []).map((a) => (
            <article
              key={a.id}
              className={`rounded-lg border border-[var(--border)] p-3 ${a.active ? '' : 'opacity-60'}`}
            >
              <p className="text-xs uppercase text-[var(--foreground-muted)]">
                {ACCOUNT_KIND_LABELS[a.kind]}
                {a.institution ? ` · ${a.institution}` : ''}
                {a.active ? '' : ' · désactivé'}
              </p>
              <p className="font-medium">{a.name}</p>
              <p
                className={`text-xl font-semibold tabular-nums ${estNegatif(a.balance) ? 'text-[var(--danger)]' : ''}`}
              >
                {formatMontantSigne(a.balance, a.currency)}
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">
                Ouverture {formatMontantSigne(a.openingBalance, a.currency)} le{' '}
                {libelleDate(a.openingDate)} · {a.movementCount} mouvement(s)
              </p>
            </article>
          ))}
        </div>
        {page ? (
          <p className="text-sm">
            Total :{' '}
            {(Object.entries(page.totalsByCurrency) as [TreasuryCurrency, string][]).map(
              ([c, v], i) => (
                <span key={c} className="tabular-nums font-medium">
                  {i > 0 ? ' · ' : ''}
                  {formatMontantSigne(v, c)}
                </span>
              ),
            )}
            <span className="block text-xs text-[var(--foreground-muted)]">
              Les devises ne sont jamais additionnées entre elles : aucun taux n’est appliqué.
              {page.receiptsIntegrated
                ? ''
                : ' Les encaissements de factures ne sont pas encore reliés aux comptes.'}
            </span>
          </p>
        ) : null}
      </Section>

      <Modal
        open={gerer && creation === 'compte'}
        onClose={() => setCreation(null)}
        title="Nouveau compte"
        description="Caisse, banque ou mobile money. Devise et date d’ouverture ne se modifient plus ensuite."
        size="md"
      >
        <div className="flex flex-col gap-3">
          {erreurCreation ? <Bandeau ton="erreur">{erreurCreation}</Bandeau> : null}
          <NouveauCompte onDone={apresCreation} onError={setErreurCreation} />
        </div>
      </Modal>
      <Modal
        open={gerer && page !== null && creation === 'mouvement'}
        onClose={() => setCreation(null)}
        title="Nouveau mouvement"
        description="Virement entre vos comptes, ou autre entrée ou sortie (apport, prêt, prélèvement)."
        size="md"
      >
        <div className="flex flex-col gap-3">
          {erreurCreation ? <Bandeau ton="erreur">{erreurCreation}</Bandeau> : null}
          <NouveauMouvement
            comptes={(page?.items ?? []).filter((a) => a.active)}
            onDone={apresCreation}
            onError={setErreurCreation}
          />
        </div>
      </Modal>

      {prevision ? (
        <PrevisionSection prevision={prevision} devise={devise} setDevise={setDevise} />
      ) : null}

      {reglages ? (
        <HypothesesSection
          reglages={reglages}
          gerer={gerer}
          onSaved={() => void charger()}
          onError={setErreur}
        />
      ) : null}

      <Section
        titre="Mouvements"
        actions={
          <select
            aria-label="Compte"
            className={CHAMP + ' w-56'}
            value={compteFiltre}
            onChange={(e) => setCompteFiltre(e.target.value)}
          >
            <option value="">Tous les comptes</option>
            {(page?.items ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        }
      >
        {gerer && page ? (
          <button
            type="button"
            className={`${buttonClasses('primary', 'sm')} self-start`}
            onClick={() => ouvrirCreation('mouvement')}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Nouveau mouvement
          </button>
        ) : null}
        {mouvements.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucun mouvement.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--foreground-muted)]">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Compte</th>
                  <th className="py-2 pr-3">Libellé</th>
                  <th className="py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {mouvements.map((m) => (
                  <tr key={`${m.id}-${m.accountId}-${m.direction}`}>
                    <td className="py-2 pr-3 whitespace-nowrap">{libelleDate(m.date)}</td>
                    <td className="py-2 pr-3">{nom.get(m.accountId) ?? '—'}</td>
                    <td className="py-2 pr-3">{m.label}</td>
                    <td
                      className={`py-2 text-right tabular-nums whitespace-nowrap ${m.direction === 'out' ? 'text-[var(--danger)]' : ''}`}
                    >
                      {m.direction === 'out' ? '−' : '+'}
                      {formatMontantSigne(m.amount, m.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function PrevisionSection({
  prevision,
  devise,
  setDevise,
}: {
  prevision: TreasuryForecast;
  devise: TreasuryCurrency;
  setDevise: (d: TreasuryCurrency) => void;
}): React.ReactElement {
  const [scenario, setScenario] = useState<ScenarioId>('probable');
  const g = geometrieGraphique(prevision);
  const courant = prevision.scenarios.find((s) => s.id === scenario) ?? prevision.scenarios[0];
  const alertes = prevision.scenarios.flatMap((s) =>
    s.alerts.map((a) => ({ ...a, scenario: s.id })),
  );

  return (
    <Section
      titre="Prévision de trésorerie"
      description={`Estimation du ${libelleDate(prevision.asOf)} au ${libelleDate(prevision.scenarios[0]?.series.at(-1)?.date ?? prevision.asOf)}. Le solde du jour est observé ; tout le reste est estimé à partir des échéances clients, des dépenses récurrentes${prevision.planUsed ? ' et du plan BUILD' : ''}.`}
      actions={
        <div className="flex gap-1" role="group" aria-label="Devise">
          {(['USD', 'CDF'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === devise}
              className={`${PETIT} ${d === devise ? 'border-[var(--accent)]' : ''}`}
              onClick={() => setDevise(d)}
            >
              {d}
            </button>
          ))}
        </div>
      }
    >
      {alertes.length > 0 ? (
        <Bandeau ton={alertes.some((a) => a.severity === 'critique') ? 'erreur' : 'alerte'}>
          <ul className="flex flex-col gap-1">
            {alertes.map((a) => (
              <li key={`${a.scenario}-${a.severity}`}>
                <strong>{SCENARIO_LABELS[a.scenario]}</strong> —{' '}
                {a.severity === 'critique' ? 'trésorerie négative' : 'sous le minimum fixé'} le{' '}
                {libelleDate(a.date)} (horizon {a.horizon} jours) :{' '}
                {formatMontantSigne(a.balance, prevision.currency)}
                {a.probableCause ? (
                  <span className="text-[var(--foreground-muted)]">
                    {' '}
                    · cause probable : {a.probableCause.label} (
                    {formatMontantSigne(a.probableCause.amount, prevision.currency)})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Bandeau>
      ) : (
        <Bandeau>Aucune tension prévue sur 180 jours, dans aucun des trois scénarios.</Bandeau>
      )}

      <figure className="flex flex-col gap-2">
        <svg
          viewBox={`0 0 ${g.width} ${g.height}`}
          role="img"
          aria-label="Solde de trésorerie prévu jour par jour, trois scénarios"
          className="w-full"
        >
          {g.band ? <polygon points={g.band} fill="var(--accent, #2563eb)" opacity="0.08" /> : null}
          {g.ticks.map((t) => (
            <g key={t.y}>
              <line
                x1={64}
                x2={g.width - 12}
                y1={t.y}
                y2={t.y}
                stroke="var(--border)"
                strokeWidth="0.5"
              />
              <text
                x={58}
                y={t.y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--foreground-muted)"
              >
                {graduation(t.value)}
              </text>
            </g>
          ))}
          {g.zeroY !== null ? (
            <line
              x1={64}
              x2={g.width - 12}
              y1={g.zeroY}
              y2={g.zeroY}
              stroke="var(--foreground)"
              strokeWidth="1"
            />
          ) : null}
          {g.thresholdY !== null ? (
            <line
              x1={64}
              x2={g.width - 12}
              y1={g.thresholdY}
              y2={g.thresholdY}
              stroke="var(--danger, #b91c1c)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          ) : null}
          {g.horizons.map((h) => (
            <g key={h.days}>
              <line
                x1={h.x}
                x2={h.x}
                y1={12}
                y2={g.height - 24}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <text
                x={h.x}
                y={g.height - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--foreground-muted)"
              >
                J+{h.days}
              </text>
            </g>
          ))}
          {(Object.keys(g.paths) as ScenarioId[]).map((id) => (
            <path
              key={id}
              d={g.paths[id]}
              fill="none"
              stroke={SCENARIO_STYLE[id].stroke}
              strokeWidth={id === 'probable' ? 2 : 1.5}
              strokeDasharray={SCENARIO_STYLE[id].dash}
            />
          ))}
          {g.alerts.map((a) => (
            <circle
              key={`${a.scenario}-${a.severity}`}
              cx={a.x}
              cy={a.y}
              r="4"
              fill={
                a.severity === 'critique' ? 'var(--danger, #b91c1c)' : 'var(--warning, #b45309)'
              }
            />
          ))}
        </svg>
        <figcaption className="flex flex-wrap gap-4 text-xs">
          {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
            <span key={id} className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden="true">
                <line
                  x1="0"
                  x2="18"
                  y1="3"
                  y2="3"
                  stroke={SCENARIO_STYLE[id].stroke}
                  strokeWidth="2"
                  strokeDasharray={SCENARIO_STYLE[id].dash}
                />
              </svg>
              {SCENARIO_LABELS[id]}
            </span>
          ))}
          <span className="text-[var(--foreground-muted)]">
            Zone ombrée : écart optimiste – pessimiste (incertitude).
          </span>
        </figcaption>
      </figure>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Solde prévu par horizon et par scénario</caption>
          <thead className="text-left text-xs uppercase text-[var(--foreground-muted)]">
            <tr>
              <th className="py-2 pr-3">Horizon</th>
              {prevision.scenarios.map((s) => (
                <th key={s.id} className="py-2 pr-3 text-right">
                  {SCENARIO_LABELS[s.id]}
                </th>
              ))}
              <th className="py-2 text-right">Incertitude</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {prevision.uncertainty.horizons.map((u, i) => (
              <tr key={u.days}>
                <td className="py-2 pr-3">{u.days} jours</td>
                {prevision.scenarios.map((s) => {
                  const h = s.horizons[i];
                  return (
                    <td
                      key={s.id}
                      className={`py-2 pr-3 text-right tabular-nums ${h && estNegatif(h.min) ? 'text-[var(--danger)]' : ''}`}
                    >
                      {h ? formatMontantSigne(h.closing, prevision.currency) : '—'}
                      {h && h.min !== h.closing ? (
                        <span className="block text-xs text-[var(--foreground-muted)]">
                          min. {formatMontantSigne(h.min, prevision.currency)}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td className="py-2 text-right tabular-nums">
                  ± {formatMontantSigne(u.spread, prevision.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Détail du scénario
          {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === scenario}
              className={`${PETIT} ${id === scenario ? 'border-[var(--accent)]' : ''}`}
              onClick={() => setScenario(id)}
            >
              {SCENARIO_LABELS[id]}
            </button>
          ))}
        </div>
        {courant ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {hypothesesLisibles(courant.hypotheses).map((h) => (
                <div key={h.label} className="contents">
                  <dt className="text-[var(--foreground-muted)]">{h.label}</dt>
                  <dd className="text-right tabular-nums">{h.valeur}</dd>
                </div>
              ))}
            </dl>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {(Object.keys(FLOW_SOURCE_LABELS) as (keyof typeof FLOW_SOURCE_LABELS)[]).map((k) => (
                <div key={k} className="contents">
                  <dt className="text-[var(--foreground-muted)]">
                    {FLOW_SOURCE_LABELS[k]} (180 j)
                  </dt>
                  <dd className="text-right tabular-nums">
                    {formatMontantSigne(
                      courant.horizons.at(-1)?.bySource[k] ?? '0.00',
                      prevision.currency,
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      {prevision.uncertainty.findings.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">Ce que la prévision ne sait pas</p>
          <ul className="mt-1 list-disc pl-5 text-[var(--foreground-muted)]">
            {prevision.uncertainty.findings.map((f) => (
              <li key={f.code}>
                {FORECAST_FINDING_LABELS[f.code] ?? f.code}
                {f.count > 1 ? ` (${f.count})` : ''}
                {f.detail ? ` — ${f.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function HypothesesSection({
  reglages,
  gerer,
  onSaved,
  onError,
}: {
  reglages: TreasurySettingsView;
  gerer: boolean;
  onSaved: () => void;
  onError: (m: string) => void;
}): React.ReactElement {
  const [ouvert, setOuvert] = useState(false);
  const pct = (r: number): string => String(Math.round(r * 1000) / 10).replace('.', ',');
  const [champs, setChamps] = useState(
    () =>
      Object.fromEntries(
        (Object.keys(reglages.scenarios) as ScenarioId[]).map((id) => {
          const h = reglages.scenarios[id];
          return [
            id,
            {
              receivableCollectionRate: pct(h.receivableCollectionRate),
              receivableDelayDays: String(h.receivableDelayDays),
              noDueDateDays: String(h.noDueDateDays),
              recurringFactor: pct(h.recurringFactor),
              planRevenueRate: pct(h.planRevenueRate),
              planChargesRate: pct(h.planChargesRate),
            },
          ];
        }),
      ) as Record<ScenarioId, Record<keyof ScenarioHypotheses, string>>,
  );
  const [minimums, setMinimums] = useState({
    CDF: reglages.minimumBalances.CDF ?? '',
    USD: reglages.minimumBalances.USD ?? '',
  });

  const LIGNES: { key: keyof ScenarioHypotheses; label: string; unite: '%' | 'j' }[] = [
    { key: 'receivableCollectionRate', label: 'Encaissement des échéances clients', unite: '%' },
    { key: 'receivableDelayDays', label: 'Retard après l’échéance', unite: 'j' },
    { key: 'noDueDateDays', label: 'Délai supposé sans échéance', unite: 'j' },
    { key: 'recurringFactor', label: 'Dépenses récurrentes', unite: '%' },
    { key: 'planRevenueRate', label: 'Ventes du plan réalisées', unite: '%' },
    { key: 'planChargesRate', label: 'Charges du plan', unite: '%' },
  ];

  async function enregistrer(parDefaut: boolean): Promise<void> {
    const scenarios = {} as Record<ScenarioId, ScenarioHypotheses>;
    if (!parDefaut) {
      for (const id of Object.keys(champs) as ScenarioId[]) {
        const h = {} as ScenarioHypotheses;
        for (const l of LIGNES) {
          const brut = champs[id][l.key];
          const v =
            l.unite === '%'
              ? lirePourcent(brut)
              : /^\d{1,3}$/.test(brut.trim())
                ? Number(brut.trim())
                : null;
          if (v === null) {
            onError(`${SCENARIO_LABELS[id]} — ${l.label} : valeur illisible.`);
            return;
          }
          h[l.key] = v;
        }
        scenarios[id] = h;
      }
    }
    const minimum = (s: string): string | null => {
      if (s.trim() === '') return null;
      const lu = lireMontantSigne(s);
      return lu.ok ? lu.valeur : null;
    };
    try {
      await treasuryApi.putSettings({
        expectedRevision: reglages.revision,
        minimumBalances: { CDF: minimum(minimums.CDF), USD: minimum(minimums.USD) },
        scenarios: parDefaut ? null : scenarios,
      });
      setOuvert(false);
      onSaved();
    } catch (err) {
      onError(messageOf(err));
    }
  }

  return (
    <Section
      titre="Hypothèses des scénarios"
      description={
        reglages.defaultScenarios
          ? 'Valeurs par défaut proposées par Lalanda, à valider (décision ouverte) : chaque chiffre de la prévision en dépend.'
          : 'Hypothèses fixées par votre organisation.'
      }
      actions={
        gerer ? (
          <button
            type="button"
            className={PETIT}
            onClick={() => setOuvert(!ouvert)}
            aria-expanded={ouvert}
          >
            {ouvert ? 'Fermer' : 'Modifier'}
          </button>
        ) : undefined
      }
    >
      {ouvert ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--foreground-muted)]">
                <tr>
                  <th className="py-2 pr-3">Hypothèse</th>
                  {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
                    <th key={id} className="py-2 pr-3">
                      {SCENARIO_LABELS[id]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIGNES.map((l) => (
                  <tr key={l.key}>
                    <td className="py-1 pr-3">
                      {l.label} ({l.unite === '%' ? '%' : 'jours'})
                    </td>
                    {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
                      <td key={id} className="py-1 pr-3">
                        <input
                          aria-label={`${SCENARIO_LABELS[id]} — ${l.label}`}
                          className={CHAMP + ' w-24'}
                          inputMode="decimal"
                          value={champs[id][l.key]}
                          onChange={(e) =>
                            setChamps({
                              ...champs,
                              [id]: { ...champs[id], [l.key]: e.target.value },
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            {(['USD', 'CDF'] as const).map((d) => (
              <label key={d} className="flex flex-col gap-1 text-sm">
                Minimum de trésorerie {d}
                <input
                  className={CHAMP + ' w-40'}
                  inputMode="decimal"
                  placeholder="0"
                  value={minimums[d]}
                  onChange={(e) => setMinimums({ ...minimums, [d]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={BOUTON} onClick={() => void enregistrer(false)}>
              Enregistrer
            </button>
            <button type="button" className={BOUTON} onClick={() => void enregistrer(true)}>
              Revenir aux valeurs proposées
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">
          Minimum de trésorerie : USD {reglages.minimumBalances.USD ?? '0'} · CDF{' '}
          {reglages.minimumBalances.CDF ?? '0'}.
        </p>
      )}
    </Section>
  );
}

function NouveauCompte({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (m: string) => void;
}): React.ReactElement {
  const [f, setF] = useState({
    name: '',
    kind: 'cash' as TreasuryAccountKind,
    institution: '',
    currency: 'USD' as TreasuryCurrency,
    openingBalance: '',
    openingDate: aujourdhui(),
  });
  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const solde = lireMontantSigne(f.openingBalance || '0');
    if (!solde.ok) {
      onError(solde.erreur);
      return;
    }
    try {
      await treasuryApi.createAccount({
        ...f,
        institution: f.institution || null,
        openingBalance: solde.valeur,
      });
      setF({ ...f, name: '', institution: '', openingBalance: '' });
      onDone();
    } catch (err) {
      onError(messageOf(err));
    }
  }
  return (
    <form
      onSubmit={(e) => void creer(e)}
      aria-label="Nouveau compte"
      className="grid gap-3 sm:grid-cols-2"
    >
      <input
        aria-label="Nom du compte"
        placeholder="Nom du compte"
        className={CHAMP}
        value={f.name}
        required
        onChange={(e) => setF({ ...f, name: e.target.value })}
      />
      <select
        aria-label="Nature"
        className={CHAMP}
        value={f.kind}
        onChange={(e) => setF({ ...f, kind: e.target.value as TreasuryAccountKind })}
      >
        {(Object.keys(ACCOUNT_KIND_LABELS) as TreasuryAccountKind[]).map((k) => (
          <option key={k} value={k}>
            {ACCOUNT_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <input
        aria-label="Banque ou opérateur"
        placeholder="Banque ou opérateur"
        className={CHAMP}
        value={f.institution}
        onChange={(e) => setF({ ...f, institution: e.target.value })}
      />
      <select
        aria-label="Devise"
        className={CHAMP}
        value={f.currency}
        onChange={(e) => setF({ ...f, currency: e.target.value as TreasuryCurrency })}
      >
        <option value="USD">USD</option>
        <option value="CDF">CDF</option>
      </select>
      <input
        aria-label="Solde d’ouverture"
        placeholder="Solde d’ouverture"
        inputMode="decimal"
        className={CHAMP}
        value={f.openingBalance}
        onChange={(e) => setF({ ...f, openingBalance: e.target.value })}
      />
      <input
        aria-label="Date d’ouverture"
        type="date"
        className={CHAMP}
        value={f.openingDate}
        required
        onChange={(e) => setF({ ...f, openingDate: e.target.value })}
      />
      <div className="sm:col-span-2">
        <button type="submit" className={BOUTON}>
          Créer le compte
        </button>
      </div>
    </form>
  );
}

function NouveauMouvement({
  comptes,
  onDone,
  onError,
}: {
  comptes: AccountsPage['items'];
  onDone: () => void;
  onError: (m: string) => void;
}): React.ReactElement {
  const [f, setF] = useState({
    type: 'transfer' as 'transfer' | 'other_in' | 'other_out',
    date: aujourdhui(),
    from: '',
    to: '',
    amountOut: '',
    amountIn: '',
    label: '',
  });
  const source = comptes.find((c) => c.id === f.from);
  const cible = comptes.find((c) => c.id === f.to);
  const deuxDevises =
    f.type === 'transfer' && source && cible && source.currency !== cible.currency;

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const sortie = lireMontantSaisi(f.amountOut);
    if (!sortie.ok) {
      onError(sortie.erreur);
      return;
    }
    try {
      if (f.type === 'transfer') {
        const entree = deuxDevises ? lireMontantSaisi(f.amountIn) : sortie;
        if (!entree.ok) {
          onError(entree.erreur);
          return;
        }
        await treasuryApi.transfer({
          date: f.date,
          fromAccountId: f.from,
          toAccountId: f.to,
          amountOut: sortie.valeur,
          amountIn: entree.valeur,
          label: f.label || null,
        });
      } else {
        await treasuryApi.otherMovement({
          kind: f.type,
          date: f.date,
          accountId: f.type === 'other_in' ? f.to : f.from,
          amount: sortie.valeur,
          label: f.label,
        });
      }
      setF({ ...f, amountOut: '', amountIn: '', label: '' });
      onDone();
    } catch (err) {
      onError(messageOf(err));
    }
  }

  return (
    <form
      onSubmit={(e) => void enregistrer(e)}
      aria-label="Nouveau mouvement"
      className="grid gap-3 sm:grid-cols-2"
    >
      <select
        aria-label="Type de mouvement"
        className={CHAMP}
        value={f.type}
        onChange={(e) => setF({ ...f, type: e.target.value as typeof f.type })}
      >
        <option value="transfer">Virement interne</option>
        <option value="other_in">Autre entrée (apport, prêt reçu)</option>
        <option value="other_out">Autre sortie (prélèvement)</option>
      </select>
      <input
        aria-label="Date"
        type="date"
        className={CHAMP}
        value={f.date}
        max={aujourdhui()}
        onChange={(e) => setF({ ...f, date: e.target.value })}
      />
      {f.type !== 'other_in' ? (
        <select
          aria-label="Compte débité"
          className={CHAMP}
          value={f.from}
          required
          onChange={(e) => setF({ ...f, from: e.target.value })}
        >
          <option value="">Depuis…</option>
          {comptes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.currency})
            </option>
          ))}
        </select>
      ) : null}
      {f.type !== 'other_out' ? (
        <select
          aria-label="Compte crédité"
          className={CHAMP}
          value={f.to}
          required
          onChange={(e) => setF({ ...f, to: e.target.value })}
        >
          <option value="">Vers…</option>
          {comptes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.currency})
            </option>
          ))}
        </select>
      ) : null}
      <input
        aria-label={deuxDevises ? 'Montant sorti' : 'Montant'}
        placeholder={deuxDevises ? `Sorti (${source?.currency})` : 'Montant'}
        inputMode="decimal"
        className={CHAMP}
        value={f.amountOut}
        required
        onChange={(e) => setF({ ...f, amountOut: e.target.value })}
      />
      {deuxDevises ? (
        <input
          aria-label="Montant entré"
          placeholder={`Entré (${cible?.currency})`}
          inputMode="decimal"
          className={CHAMP}
          value={f.amountIn}
          required
          onChange={(e) => setF({ ...f, amountIn: e.target.value })}
        />
      ) : null}
      <input
        aria-label="Libellé"
        placeholder="Libellé"
        className={CHAMP}
        value={f.label}
        required={f.type !== 'transfer'}
        onChange={(e) => setF({ ...f, label: e.target.value })}
      />
      <div className="flex items-end">
        <button type="submit" className={BOUTON}>
          Enregistrer
        </button>
      </div>
      {deuxDevises ? (
        <p className="text-xs text-[var(--foreground-muted)] sm:col-span-2">
          Entre deux devises, saisissez les deux montants constatés : Lalanda ne calcule aucun taux
          de change.
        </p>
      ) : null}
    </form>
  );
}

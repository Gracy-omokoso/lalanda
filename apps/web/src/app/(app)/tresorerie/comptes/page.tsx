'use client';

// Onglet « Trésorerie » (ADR-0034 § 4 et § 7) : comptes et soldes (moteur),
// mouvements, virements, et prévision 7 / 30 / 90 / 180 jours en trois scénarios
// à hypothèses explicites, avec alertes et incertitude. Le jour 0 est une
// observation (soldes) ; tout le reste est une ESTIMATION, et l'écran le dit.
//
// ADR-0074 : formulaires sur les composants de `@lalanda/ui` — dates en
// `DatePicker`, montants en `MoneyInput` (mise en forme seulement : les
// lecteurs existants, `lireMontantSaisi` et `lireMontantSigne`, lisent la
// valeur), listes en `Select`, devise en segments, largeurs sémantiques.
// Mêmes champs envoyés, mêmes contrôles.

import {
  Button,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  MoneyInput,
  SegmentedControl,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
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

import {
  BOUTON_PRINCIPAL,
  EnTeteEcran,
  IconePlus,
  SelecteurDevise,
} from '@/components/tableau-de-bord/briques';
import { nombre } from '@/components/tableau-de-bord/format';
import { TableauChiffres } from '@/components/tableau-de-bord/tableau';
import { useTableau } from '@/components/tableau-de-bord/use-tableau';
import { runStatsApi } from '@/lib/api-run-stats';

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
import { barresComptes, cartesComptes, noteComptes } from '../_components/tableau-tresorerie-model';

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
  const [rev, setRev] = useState(0);
  const [deviseTableau, setDeviseTableau] = useState<TreasuryCurrency | null>(null);

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
      setRev((v) => v + 1);
    } catch (err) {
      setErreur(messageOf(err));
    }
  }, [devise, compteFiltre]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const nom = new Map((page?.items ?? []).map((a) => [a.id, a.name]));

  // ADR-0071 : chiffres du moteur sur les comptes réels, relus après chaque
  // chargement (`rev`) ; un échec ne bloque pas l'écran.
  const {
    stats,
    etat: etatStats,
    reessayer,
  } = useTableau(() => runStatsApi.accounts(), `comptes-${rev}`);
  const bloc = stats
    ? (stats.byCurrency.find((c) => c.currency === deviseTableau) ?? stats.byCurrency[0] ?? null)
    : null;

  return (
    <div aria-labelledby="cpt-titre" className="flex min-w-0 flex-col gap-3.5">
      <EnTeteEcran
        id="cpt-titre"
        titre="Comptes"
        sousTitre="Caisse, banque et mobile money : vos soldes réels et ce qu’il vous restera."
        detail="Les soldes partent du solde d’ouverture et de tous les mouvements enregistrés ; la prévision est une estimation, et l’écran le dit."
        action={
          gerer ? (
            <button
              type="button"
              className={BOUTON_PRINCIPAL}
              onClick={() => ouvrirCreation('compte')}
            >
              <IconePlus />
              Nouveau compte
            </button>
          ) : null
        }
      />

      <TableauChiffres
        etat={etatStats}
        libelle="Chiffres des comptes"
        texteErreur="Les chiffres des comptes sont momentanément indisponibles. Les soldes ci-dessous restent à jour."
        onReessayer={reessayer}
        outils={
          stats && bloc ? (
            <SelecteurDevise
              devises={stats.byCurrency.map((c) => c.currency)}
              valeur={bloc.currency}
              onChange={setDeviseTableau}
            />
          ) : null
        }
        cartes={stats && bloc ? cartesComptes(stats, bloc) : stats ? [] : null}
        vide={
          stats && !bloc
            ? {
                titre: 'Pas encore de compte',
                texte:
                  'Créez votre caisse, votre compte bancaire ou votre compte mobile money : le solde de fin de mois sur 12 mois et le solde par compte apparaîtront ici.',
              }
            : null
        }
        courbe={
          bloc
            ? {
                titre: 'Solde de fin de mois, 12 mois',
                nom: `Solde total des comptes actifs en fin de mois, en ${bloc.currency}`,
                mois: bloc.months.map((m) => m.month),
                valeurs: bloc.months.map((m) => nombre(m.closingBalance)),
                serie: 'Solde',
                unite: bloc.currency,
              }
            : null
        }
        repartition={
          bloc
            ? {
                titre: 'Solde par compte',
                nom: `Solde de chaque compte actif au jour, en ${bloc.currency}`,
                barres: barresComptes(bloc),
                vide: 'Aucun compte actif.',
                couleur: 2,
              }
            : null
        }
        note={stats && bloc ? noteComptes(stats, bloc.currency) : null}
      />

      {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

      <Section
        titre="Comptes et soldes"
        description={`Soldes au ${page ? libelleDate(page.asOf) : '…'}, calculés à partir du solde d’ouverture et de tous les mouvements enregistrés.`}
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
          <Select<string>
            aria-label="Compte"
            className="w-56 max-w-full"
            value={compteFiltre}
            onChange={setCompteFiltre}
            options={[
              { value: '', label: 'Tous les comptes' },
              ...(page?.items ?? []).map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
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
                        <TextInput
                          aria-label={`${SCENARIO_LABELS[id]} — ${l.label}`}
                          className="w-28 text-right tabular-nums"
                          inputMode="decimal"
                          trailing={l.unite === '%' ? '%' : 'j'}
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
          <FormGrid>
            {(['USD', 'CDF'] as const).map((d) => (
              <Field key={d} id={`hyp-minimum-${d}`} label={`Minimum de trésorerie ${d}`} size="sm">
                <MoneyInput
                  value={minimums[d]}
                  currency={d}
                  allowNegative
                  placeholder="0"
                  onChange={(v) => setMinimums({ ...minimums, [d]: v })}
                />
              </Field>
            ))}
          </FormGrid>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              variant="primary"
              onClick={() => void enregistrer(false)}
              className="max-sm:h-11"
            >
              Enregistrer
            </Button>
            <Button onClick={() => void enregistrer(true)} className="max-sm:h-11">
              Revenir aux valeurs proposées
            </Button>
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
    if (f.openingDate === '') {
      onError('Indiquez la date d’ouverture.');
      return;
    }
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
      className="flex min-w-0 flex-col gap-4"
    >
      <FormGrid>
        <Field id="cpt-nom" label="Nom du compte" required size="lg">
          <TextInput
            value={f.name}
            required
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field id="cpt-nature" label="Nature" size="md" newRow>
          <Select<TreasuryAccountKind>
            value={f.kind}
            onChange={(v) => setF({ ...f, kind: v })}
            options={(Object.keys(ACCOUNT_KIND_LABELS) as TreasuryAccountKind[]).map((k) => ({
              value: k,
              label: ACCOUNT_KIND_LABELS[k],
            }))}
          />
        </Field>
        <Field id="cpt-institution" label="Banque ou opérateur" optional size="md">
          <TextInput
            value={f.institution}
            onChange={(e) => setF({ ...f, institution: e.target.value })}
          />
        </Field>
        <Field id="cpt-devise" label="Devise" group size="sm" newRow>
          <SegmentedControl<TreasuryCurrency>
            value={f.currency}
            onChange={(v) => setF({ ...f, currency: v })}
            options={[
              { value: 'USD', label: 'USD' },
              { value: 'CDF', label: 'CDF' },
            ]}
          />
        </Field>
        <Field id="cpt-solde" label="Solde d’ouverture" optional size="sm" hint="Vide : zéro.">
          <MoneyInput
            value={f.openingBalance}
            currency={f.currency}
            allowNegative
            onChange={(v) => setF({ ...f, openingBalance: v })}
          />
        </Field>
        <Field id="cpt-date" label="Date d’ouverture" required size="sm">
          <DatePicker
            value={f.openingDate}
            required
            onChange={(v) => setF({ ...f, openingDate: v })}
            shortcuts={['today']}
          />
        </Field>
      </FormGrid>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SubmitButton className="max-sm:h-11">Créer le compte</SubmitButton>
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
    if ((f.type !== 'other_in' && f.from === '') || (f.type !== 'other_out' && f.to === '')) {
      onError('Choisissez le compte.');
      return;
    }
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
      className="flex min-w-0 flex-col gap-4"
    >
      <FormGrid>
        <Field id="mvt-type" label="Type de mouvement" size="lg">
          <Select<typeof f.type>
            value={f.type}
            onChange={(v) => setF({ ...f, type: v })}
            options={[
              { value: 'transfer', label: 'Virement interne' },
              { value: 'other_in', label: 'Autre entrée (apport, prêt reçu)' },
              { value: 'other_out', label: 'Autre sortie (prélèvement)' },
            ]}
          />
        </Field>
        <Field id="mvt-date" label="Date" size="sm">
          <DatePicker
            value={f.date}
            max={aujourdhui()}
            onChange={(v) => setF({ ...f, date: v })}
            shortcuts={['today']}
          />
        </Field>
        {f.type !== 'other_in' ? (
          <Field id="mvt-depuis" label="Compte débité" required size="md" newRow>
            <Select<string>
              value={f.from}
              placeholder="Depuis…"
              required
              onChange={(v) => setF({ ...f, from: v })}
              options={comptes.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.currency})`,
              }))}
            />
          </Field>
        ) : null}
        {f.type !== 'other_out' ? (
          <Field
            id="mvt-vers"
            label="Compte crédité"
            required
            size="md"
            newRow={f.type === 'other_in'}
          >
            <Select<string>
              value={f.to}
              placeholder="Vers…"
              required
              onChange={(v) => setF({ ...f, to: v })}
              options={comptes.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.currency})`,
              }))}
            />
          </Field>
        ) : null}
        <Field
          id="mvt-sortie"
          label={deuxDevises ? 'Montant sorti' : 'Montant'}
          required
          size="sm"
          newRow
        >
          <MoneyInput
            value={f.amountOut}
            currency={source?.currency ?? cible?.currency ?? null}
            required
            onChange={(v) => setF({ ...f, amountOut: v })}
          />
        </Field>
        {deuxDevises ? (
          <Field id="mvt-entree" label="Montant entré" required size="sm">
            <MoneyInput
              value={f.amountIn}
              currency={cible?.currency ?? null}
              required
              onChange={(v) => setF({ ...f, amountIn: v })}
            />
          </Field>
        ) : null}
        <Field
          id="mvt-libelle"
          label="Libellé"
          required={f.type !== 'transfer'}
          optional={f.type === 'transfer'}
          size="lg"
          newRow
        >
          <TextInput
            value={f.label}
            required={f.type !== 'transfer'}
            onChange={(e) => setF({ ...f, label: e.target.value })}
          />
        </Field>
      </FormGrid>
      {deuxDevises ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Entre deux devises, saisissez les deux montants constatés : Lalanda ne calcule aucun taux
          de change.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SubmitButton className="max-sm:h-11">Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

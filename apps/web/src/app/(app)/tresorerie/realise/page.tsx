'use client';

// Onglet « Réalisé vs prévu » (ADR-0034 § 5 et § 6) : relier les dépenses au
// réalisé d'un projet BUILD validé (table de correspondance choisie par
// l'utilisateur, jamais devinée), synchroniser de façon idempotente, puis lire
// l'écart au plan, expliqué ligne par ligne. Sans projet validé, l'écran le dit :
// RUN fonctionne seul, la comparaison exige BUILD.

import { useCallback, useEffect, useState } from 'react';

import { api, type ProjectView } from '@/lib/api';
import {
  codeOf,
  messageOf,
  treasuryApi,
  type BridgeView,
  type ReconciliationView,
  type SyncReport,
} from '@/lib/treasury-api';

import { Bandeau, Section, useAccesTresorerie } from '../_components/treasury-access';
import {
  RECONCILIATION_FINDING_LABELS,
  SYNC_STATUS_LABELS,
  formatMontantSigne,
  libelleMois,
} from '../_components/treasury-model';

const CHAMP =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60';
const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

const STATUT_COULEUR: Record<string, string> = {
  favorable: 'text-[var(--success,#15803d)]',
  defavorable: 'text-[var(--danger)]',
  conforme: '',
};

export default function RealisePage(): React.ReactElement {
  const { relier } = useAccesTresorerie();
  const [pont, setPont] = useState<BridgeView | null>(null);
  const [projets, setProjets] = useState<ProjectView[]>([]);
  const [annee, setAnnee] = useState(1);
  const [rapprochement, setRapprochement] = useState<ReconciliationView | null>(null);
  const [rapport, setRapport] = useState<SyncReport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    projectId: '',
    firstMonth: '',
    mapping: {} as Record<string, string>,
  });

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const b = await treasuryApi.bridge();
      setPont(b);
      setForm({
        enabled: b.enabled,
        projectId: b.projectId ?? '',
        firstMonth: b.firstMonth ?? '',
        mapping: { ...b.mapping },
      });
      if (b.status !== 'not_configured') {
        try {
          setRapprochement(await treasuryApi.reconciliation(annee));
        } catch (err) {
          setRapprochement(null);
          if (codeOf(err) !== 'BRIDGE_NOT_CONFIGURED') setErreur(messageOf(err));
        }
      } else {
        setRapprochement(null);
      }
    } catch (err) {
      setErreur(messageOf(err));
    }
  }, [annee]);

  useEffect(() => {
    void charger();
  }, [charger]);
  useEffect(() => {
    void api
      .listProjects()
      .then((r) => setProjets(r.projects))
      .catch(() => undefined);
  }, []);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const mapping = Object.fromEntries(Object.entries(form.mapping).filter(([, v]) => v !== ''));
    try {
      await treasuryApi.putBridge({
        enabled: form.enabled,
        projectId: form.projectId || null,
        firstMonth: form.firstMonth || null,
        mapping,
      });
      await charger();
    } catch (err) {
      setErreur(messageOf(err));
    }
  }

  async function synchroniser(dryRun: boolean): Promise<void> {
    setErreur(null);
    try {
      setRapport(await treasuryApi.sync(dryRun));
      if (!dryRun) await charger();
    } catch (err) {
      setErreur(messageOf(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

      <Section
        titre="Relier les dépenses au plan BUILD"
        description="Les dépenses d’exploitation alimentent le réalisé d’un projet validé, ligne par ligne, selon la correspondance que vous choisissez. Le plan validé n’est jamais modifié ; une période clôturée ou une saisie manuelle ne sont jamais écrasées."
      >
        {pont?.status === 'not_configured' ? (
          <Bandeau>
            Aucun projet relié : vos dépenses restent consultables dans l’onglet Dépenses, mais la
            comparaison au prévisionnel exige un projet BUILD validé.
          </Bandeau>
        ) : null}
        <form onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Projet
              <select
                className={CHAMP}
                value={form.projectId}
                disabled={!relier}
                onChange={(e) => setForm({ ...form, projectId: e.target.value, mapping: {} })}
              >
                <option value="">— Aucun —</option>
                {projets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Mois d’ouverture de l’exercice 1
              <input
                type="month"
                className={CHAMP}
                value={form.firstMonth}
                disabled={!relier}
                onChange={(e) => setForm({ ...form, firstMonth: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={!relier}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Report actif
            </label>
          </div>
          {pont && pont.projectId === form.projectId && pont.mappableLines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="text-left text-xs text-[var(--foreground-muted)]">
                  Correspondance catégorie → ligne de charge du plan validé v{pont.planVersion}. Une
                  catégorie sans ligne reste dans la file des non rattachées.
                </caption>
                <tbody className="divide-y divide-[var(--border)]">
                  {pont.categories.map((c) => (
                    <tr key={c.code}>
                      <td className="py-1.5 pr-3">{c.label}</td>
                      <td className="py-1.5">
                        {c.mappable ? (
                          <select
                            aria-label={`Ligne du plan pour ${c.label}`}
                            className={CHAMP}
                            value={form.mapping[c.code] ?? ''}
                            disabled={!relier}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                mapping: { ...form.mapping, [c.code]: e.target.value },
                              })
                            }
                          >
                            <option value="">— Non rattachée —</option>
                            {pont.mappableLines.map((l) => (
                              <option key={l.lineId} value={l.lineId}>
                                {l.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-[var(--foreground-muted)]">
                            Hors compte d’exploitation : suivie en trésorerie seulement.
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : form.projectId ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Enregistrez le projet pour choisir la correspondance avec les lignes de son plan
              validé.
            </p>
          ) : null}
          {relier ? (
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={BOUTON}>
                Enregistrer
              </button>
              {pont?.status === 'enabled' ? (
                <>
                  <button type="button" className={BOUTON} onClick={() => void synchroniser(true)}>
                    Simuler la synchronisation
                  </button>
                  <button type="button" className={BOUTON} onClick={() => void synchroniser(false)}>
                    Synchroniser le réalisé
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-[var(--foreground-muted)]">
              Relier au réalisé exige le droit d’importer le réalisé (Propriétaire, Directeur
              financier, Comptable).
            </p>
          )}
        </form>
        {rapport ? <RapportSync rapport={rapport} /> : null}
      </Section>

      {rapprochement ? (
        <Section
          titre={`Réalisé vs prévu — exercice ${rapprochement.year}`}
          description={`${rapprochement.projectName}, plan validé v${rapprochement.planVersion}, en ${rapprochement.projectCurrency}. Prévu mensuel = plan annuel ÷ 12 ; réalisé = dépenses rattachées. Une case vide n’est pas un zéro.`}
          actions={
            <select
              aria-label="Exercice"
              className={CHAMP + ' w-36'}
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((a) => (
                <option key={a} value={a}>
                  Exercice {a}
                </option>
              ))}
            </select>
          }
        >
          {rapprochement.lines.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Aucune catégorie n’est rattachée à une ligne du plan.
            </p>
          ) : null}
          {rapprochement.lines.map((l) => (
            <div key={l.lineId} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {l.label}
                {l.total.ecart !== null ? (
                  <span
                    className={`ml-2 font-normal ${STATUT_COULEUR[l.total.statut ?? ''] ?? ''}`}
                  >
                    écart {formatMontantSigne(l.total.ecart, rapprochement.projectCurrency)}
                    {l.total.ecartPct !== null
                      ? ` (${String(Math.round(l.total.ecartPct * 1000) / 10).replace('.', ',')} %)`
                      : ''}{' '}
                    sur {l.total.monthsCounted.length} mois
                  </span>
                ) : (
                  <span className="ml-2 font-normal text-[var(--foreground-muted)]">
                    non comparable
                  </span>
                )}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left uppercase text-[var(--foreground-muted)]">
                    <tr>
                      <th className="py-1 pr-2">Mois</th>
                      <th className="py-1 pr-2 text-right">Prévu</th>
                      <th className="py-1 pr-2 text-right">Dépenses</th>
                      <th className="py-1 pr-2 text-right">Porté au réalisé</th>
                      <th className="py-1 pr-2 text-right">Écart</th>
                      <th className="py-1">Explication</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {l.months
                      .filter(
                        (m) =>
                          m.realise !== null ||
                          m.stored !== null ||
                          m.findings.some((f) => f !== 'NO_PLAN_BASE'),
                      )
                      .map((m) => (
                        <tr key={m.month}>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {libelleMois(rapprochement.calendarMonths[m.month - 1] ?? '')}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {m.prevu
                              ? formatMontantSigne(m.prevu, rapprochement.projectCurrency)
                              : '—'}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {m.realise
                              ? formatMontantSigne(m.realise, rapprochement.projectCurrency)
                              : '—'}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {m.stored
                              ? formatMontantSigne(m.stored, rapprochement.projectCurrency)
                              : '—'}
                            {m.storedSource ? (
                              <span className="block text-[var(--foreground-muted)]">
                                {m.storedSource === 'run.expenses'
                                  ? 'issu des dépenses'
                                  : m.storedSource === 'run.sales'
                                    ? 'issu des ventes'
                                    : 'saisi à la main'}
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={`py-1 pr-2 text-right tabular-nums ${STATUT_COULEUR[m.statut ?? ''] ?? ''}`}
                          >
                            {m.ecart
                              ? formatMontantSigne(m.ecart, rapprochement.projectCurrency)
                              : '—'}
                          </td>
                          <td className="py-1">
                            {m.findings.map((f) => RECONCILIATION_FINDING_LABELS[f]).join(' · ')}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {l.categories.length > 0 ? (
                <p className="text-xs text-[var(--foreground-muted)]">
                  Contributions :{' '}
                  {l.categories
                    .map(
                      (c) =>
                        `${pont?.categories.find((x) => x.code === c.category)?.label ?? c.category} ${formatMontantSigne(c.amount, rapprochement.projectCurrency)}`,
                    )
                    .join(' · ')}
                  {l.topExpenses.length > 0
                    ? ` — plus fortes dépenses : ${l.topExpenses.map((e) => `${e.label} (${formatMontantSigne(e.amount, rapprochement.projectCurrency)})`).join(', ')}`
                    : ''}
                </p>
              ) : null}
            </div>
          ))}
          {rapprochement.unmapped.length > 0 ? (
            <Bandeau ton="alerte">
              Dépenses non rattachées cet exercice :{' '}
              {rapprochement.unmapped
                .map(
                  (u) =>
                    `${libelleMois(u.calendarMonth)} · ${pont?.categories.find((c) => c.code === u.category)?.label ?? u.category} ${formatMontantSigne(u.total, u.currency)}`,
                )
                .join(' ; ')}
            </Bandeau>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function RapportSync({ rapport }: { rapport: SyncReport }): React.ReactElement {
  const comptes = Object.entries(rapport.counts).filter(([, n]) => n > 0);
  return (
    <Bandeau>
      <p className="font-medium">
        {rapport.dryRun ? 'Simulation — rien n’a été écrit.' : 'Synchronisation effectuée.'}
      </p>
      <p>
        {comptes.length === 0
          ? 'Aucune case concernée.'
          : comptes
              .map(([s, n]) => `${SYNC_STATUS_LABELS[s as keyof typeof SYNC_STATUS_LABELS]} : ${n}`)
              .join(' · ')}
      </p>
      {rapport.skipped.length > 0 ? (
        <p className="text-xs">
          Non reportées :{' '}
          {rapport.skipped
            .map(
              (s) =>
                `${libelleMois(s.calendarMonth)} (${s.reason === 'CURRENCY_NOT_CONVERTIBLE' ? 'autre devise que le projet' : 'hors des 5 exercices'})`,
            )
            .join(', ')}
        </p>
      ) : null}
    </Bandeau>
  );
}

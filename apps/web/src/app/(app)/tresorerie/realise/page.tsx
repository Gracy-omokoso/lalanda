'use client';

// Onglet « Réalisé vs prévu » (ADR-0034 § 5 et § 6) : relier les dépenses au
// réalisé d'un projet BUILD validé (table de correspondance choisie par
// l'utilisateur, jamais devinée), synchroniser de façon idempotente, puis lire
// l'écart au plan, expliqué ligne par ligne. Sans projet validé, l'écran le dit :
// RUN fonctionne seul, la comparaison exige BUILD.
//
// ADR-0074 : initiative, correspondances et exercice en `Select`, report en
// interrupteur, champs à leur largeur. Mêmes champs envoyés. Le mois
// d'ouverture reste un champ « mois » du navigateur : `@lalanda/ui` n'a pas de
// sélecteur de mois (décision ouverte).

import { Button, Field, FormGrid, Select, SubmitButton, Switch, TextInput } from '@lalanda/ui';
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

const EXERCICES = [1, 2, 3, 4, 5] as const;

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
        description="Les dépenses d’exploitation alimentent le réalisé d’une initiative validée, ligne par ligne, selon la correspondance que vous choisissez. Le plan validé n’est jamais modifié ; une période clôturée ou une saisie manuelle ne sont jamais écrasées."
      >
        {pont?.status === 'not_configured' ? (
          <Bandeau>
            Aucune initiative reliée : vos dépenses restent consultables dans l’onglet Dépenses,
            mais la comparaison au prévisionnel exige une initiative BUILD validée.
          </Bandeau>
        ) : null}
        <form onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-3">
          <p className="text-xs text-[var(--foreground-muted)]">
            L’initiative et le mois d’ouverture de l’exercice 1 sont communs au pont des ventes
            (Encaissements) : les changer ici les change là-bas, et c’est refusé tant que l’autre
            pont est actif.
          </p>
          <FormGrid>
            <Field id="rea-initiative" label="Initiative" size="lg" disabled={!relier}>
              <Select<string>
                value={form.projectId}
                onChange={(v) => setForm({ ...form, projectId: v, mapping: {} })}
                options={[
                  { value: '', label: '— Aucun —' },
                  ...projets.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            <Field
              id="rea-premier-mois"
              label="Mois d’ouverture de l’exercice 1"
              size="sm"
              disabled={!relier}
            >
              <TextInput
                type="month"
                value={form.firstMonth}
                onChange={(e) => setForm({ ...form, firstMonth: e.target.value })}
              />
            </Field>
            <Field id="rea-actif" label="Report" group size="md" newRow disabled={!relier}>
              <Switch
                checked={form.enabled}
                disabled={!relier}
                onChange={(v) => setForm({ ...form, enabled: v })}
                label="Report actif"
              />
            </Field>
          </FormGrid>
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
                          <Select<string>
                            aria-label={`Ligne du plan pour ${c.label}`}
                            value={form.mapping[c.code] ?? ''}
                            disabled={!relier}
                            onChange={(v) =>
                              setForm({
                                ...form,
                                mapping: { ...form.mapping, [c.code]: v },
                              })
                            }
                            options={[
                              { value: '', label: '— Non rattachée —' },
                              ...pont.mappableLines.map((l) => ({
                                value: l.lineId,
                                label: l.label,
                              })),
                            ]}
                          />
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
              Enregistrez l’initiative pour choisir la correspondance avec les lignes de son plan
              validé.
            </p>
          ) : null}
          {relier ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <SubmitButton className="max-sm:h-11">Enregistrer</SubmitButton>
              {pont?.status === 'enabled' ? (
                <>
                  <Button onClick={() => void synchroniser(true)} className="max-sm:h-11">
                    Simuler la synchronisation
                  </Button>
                  <Button onClick={() => void synchroniser(false)} className="max-sm:h-11">
                    Synchroniser le réalisé
                  </Button>
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
            <Select<string>
              aria-label="Exercice"
              className="w-40"
              value={String(annee)}
              onChange={(v) => setAnnee(EXERCICES.find((a) => String(a) === v) ?? 1)}
              options={EXERCICES.map((a) => ({ value: String(a), label: `Exercice ${a}` }))}
            />
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
                `${libelleMois(s.calendarMonth)} (${s.reason === 'CURRENCY_NOT_CONVERTIBLE' ? 'autre devise que l’initiative' : 'hors des 5 exercices'})`,
            )
            .join(', ')}
        </p>
      ) : null}
    </Bandeau>
  );
}

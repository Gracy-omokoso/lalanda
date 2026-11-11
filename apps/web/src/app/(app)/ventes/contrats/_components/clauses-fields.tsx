'use client';

// Clauses SAISIES d'un contrat (début, durée, reconduction, préavis, échéancier, texte) —
// ADR-0050 § 2.3, § 2.4, lot V7. Lalanda calcule des dates à partir de ces clauses ; il
// n'en juge pas la validité juridique (bandeau constant de la fiche).
//
// ADR-0074 : dates en `DatePicker`, durées et nombres à la largeur d'un nombre, listes
// en `Select`, mode de facturation en cartes de choix, préparation automatique en
// interrupteur. Mêmes valeurs saisies, mêmes erreurs. Les identifiants des échéances
// viennent de leur position (la clé interne diffère entre serveur et navigateur).

import { SALES_CONTRACT_CLAUSES_BANNER } from '@lalanda/shared/sales-contracts';
import {
  ChoiceCards,
  DatePicker,
  Field,
  FormGrid,
  Select,
  Switch,
  TextArea,
  TextInput,
} from '@lalanda/ui';

import type { InvoiceLineBody } from '@/lib/api';

import { BOUTON_PETIT } from '../../_components/form-ui';

import {
  FREQUENCE_LABELS,
  MOMENT_LABELS,
  RECONDUCTION_LABELS,
  echeanceVide,
  type FormulaireClauses,
} from './contract-model';

/** Désignation lisible d'une ligne au corps du brouillon. */
function nomLigne(l: InvoiceLineBody, i: number): string {
  if (l.source === 'free') return l.name;
  return `Ligne ${i + 1} (article du catalogue)`;
}

const options = <K extends string>(libelles: Record<K, string>): { value: K; label: string }[] =>
  (Object.keys(libelles) as K[]).map((k) => ({ value: k, label: libelles[k] }));

export function ChampsClauses({
  prefixe,
  f,
  setF,
  erreurs,
  desactive,
  lignesContrat,
  nomsLignes,
  avecEcheancier = true,
}: {
  prefixe: string;
  f: FormulaireClauses;
  setF: React.Dispatch<React.SetStateAction<FormulaireClauses>>;
  erreurs: Record<string, string>;
  desactive: boolean;
  /** Lignes du contrat (corps) : une échéance en reprend certaines, avec sa quantité. */
  lignesContrat: readonly InvoiceLineBody[];
  /** Désignations affichées des lignes (si connues). */
  nomsLignes?: readonly string[];
  avecEcheancier?: boolean;
}): React.ReactElement {
  const p = prefixe;
  const set =
    <K extends keyof FormulaireClauses>(k: K) =>
    (v: FormulaireClauses[K]) =>
      setF((x) => ({ ...x, [k]: v }));
  const majEcheance = (
    cleEcheance: string,
    patch: Partial<FormulaireClauses['echeances'][number]>,
  ): void =>
    setF((x) => ({
      ...x,
      echeances: x.echeances.map((y) => (y.cle === cleEcheance ? { ...y, ...patch } : y)),
    }));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm">
        {SALES_CONTRACT_CLAUSES_BANNER}
      </p>
      <fieldset className="flex min-w-0 flex-col gap-3" disabled={desactive}>
        <legend className="mb-1 text-sm font-semibold">Durée et préavis</legend>
        <FormGrid>
          <Field
            id={`${p}-debut`}
            label="Début du contrat"
            required
            size="sm"
            error={erreurs['startDate']}
          >
            <DatePicker
              value={f.startDate}
              onChange={set('startDate')}
              shortcuts={['today', 'endOfMonth']}
            />
          </Field>
          <Field
            id={`${p}-duree`}
            label="Durée du premier terme"
            optional
            size="sm"
            hint="Vide : durée indéterminée."
            error={erreurs['initialTermMonths']}
          >
            <TextInput
              inputMode="numeric"
              value={f.dureeMois}
              onChange={(e) => set('dureeMois')(e.target.value)}
              trailing="mois"
              className="text-right tabular-nums"
            />
          </Field>
          <Field
            id={`${p}-preavis`}
            label="Préavis"
            required
            size="sm"
            hint="Clause de votre contrat, de 0 à 365 jours."
            error={erreurs['noticeDays']}
          >
            <TextInput
              inputMode="numeric"
              value={f.preavisJours}
              onChange={(e) => set('preavisJours')(e.target.value)}
              trailing="jours"
              className="text-right tabular-nums"
            />
          </Field>
        </FormGrid>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3" disabled={desactive}>
        <legend className="mb-1 text-sm font-semibold">Reconduction</legend>
        <FormGrid>
          <Field id={`${p}-reconduction`} label="Mode" size="md" error={erreurs['renewal.mode']}>
            <Select<FormulaireClauses['reconduction']>
              value={f.reconduction}
              onChange={set('reconduction')}
              options={options(RECONDUCTION_LABELS)}
            />
          </Field>
          {f.reconduction !== 'none' ? (
            <>
              <Field
                id={`${p}-periode`}
                label="Période de reconduction"
                required
                size="sm"
                error={erreurs['renewal.periodMonths']}
              >
                <TextInput
                  inputMode="numeric"
                  value={f.periodeMois}
                  onChange={(e) => set('periodeMois')(e.target.value)}
                  trailing="mois"
                  className="text-right tabular-nums"
                />
              </Field>
              <Field
                id={`${p}-max`}
                label="Reconductions au plus"
                optional
                size="sm"
                hint="Vide : sans limite saisie."
                error={erreurs['renewal.maxRenewals']}
              >
                <TextInput
                  inputMode="numeric"
                  value={f.maxReconductions}
                  onChange={(e) => set('maxReconductions')(e.target.value)}
                  className="text-right tabular-nums"
                />
              </Field>
            </>
          ) : null}
        </FormGrid>
        {f.reconduction === 'tacit' ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            À la fin de chaque terme, Lalanda propose le terme suivant ; une personne habilitée le
            constate d’un geste. Sans ce geste, aucun brouillon n’est préparé au-delà du terme.
          </p>
        ) : null}
      </fieldset>

      {avecEcheancier ? (
        <fieldset className="flex min-w-0 flex-col gap-4" disabled={desactive}>
          <legend className="mb-1 text-sm font-semibold">Facturation</legend>
          <ChoiceCards<FormulaireClauses['facturation']>
            aria-label="Mode de facturation"
            value={f.facturation}
            onChange={(k) =>
              setF((x) => ({
                ...x,
                facturation: k,
                echeances:
                  k === 'schedule' && x.echeances.length === 0 ? [echeanceVide(0)] : x.echeances,
              }))
            }
            options={[
              { value: 'none', label: 'Sans échéancier (factures préparées à la main)' },
              { value: 'recurring', label: 'Abonnement (récurrent)' },
              { value: 'schedule', label: 'Échéancier à dates fixes' },
            ]}
          />
          {f.facturation === 'recurring' ? (
            <div className="flex min-w-0 flex-col gap-3">
              <FormGrid>
                <Field id={`${p}-frequence`} label="Fréquence" size="md">
                  <Select<FormulaireClauses['frequence']>
                    value={f.frequence}
                    onChange={set('frequence')}
                    options={options(FREQUENCE_LABELS)}
                  />
                </Field>
                <Field
                  id={`${p}-ancre`}
                  label="Première échéance"
                  required
                  size="sm"
                  hint="Les suivantes tombent le même quantième, ramené au dernier jour du mois."
                  error={erreurs['billing.anchorDate']}
                >
                  <DatePicker
                    value={f.ancre}
                    onChange={set('ancre')}
                    shortcuts={['today', 'endOfMonth']}
                  />
                </Field>
                <Field id={`${p}-moment`} label="Libellé de période" size="md">
                  <Select<FormulaireClauses['moment']>
                    value={f.moment}
                    onChange={set('moment')}
                    options={options(MOMENT_LABELS)}
                  />
                </Field>
              </FormGrid>
              <Switch
                checked={f.autoPrepare}
                onChange={set('autoPrepare')}
                disabled={desactive}
                label="Préparer les brouillons automatiquement à chaque échéance (jamais émis seuls)"
              />
              <p className="text-xs text-[var(--foreground-muted)]">
                Chaque brouillon reprend les lignes du contrat en vigueur à la date de l’échéance.
                Aucun prorata : une période incomplète s’ajuste à la main sur le brouillon.
              </p>
            </div>
          ) : null}
          {f.facturation === 'schedule' ? (
            <div className="flex min-w-0 flex-col gap-3">
              {erreurs['billing.items'] ? (
                <p className="text-xs font-medium text-[var(--danger)]">
                  {erreurs['billing.items']}
                </p>
              ) : null}
              <p className="text-xs text-[var(--foreground-muted)]">
                Chaque échéance porte ses propres quantités des lignes du contrat, à leurs prix.
                Aucun pourcentage.
              </p>
              {lignesContrat.length === 0 ? (
                <p className="text-sm">Ajoutez d’abord des lignes au contrat.</p>
              ) : null}
              {f.echeances.map((e, i) => (
                <div
                  key={e.cle}
                  className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Échéance {i + 1}</span>
                    <button
                      type="button"
                      className={`${BOUTON_PETIT} max-sm:h-11`}
                      onClick={() =>
                        setF((x) => ({
                          ...x,
                          echeances: x.echeances.filter((y) => y.cle !== e.cle),
                        }))
                      }
                    >
                      Retirer l’échéance
                    </button>
                  </div>
                  <FormGrid>
                    <Field
                      id={`${p}-ech-${i}-date`}
                      label="Date"
                      required
                      size="sm"
                      error={erreurs[`billing.items.${i}.dueDate`]}
                    >
                      <DatePicker
                        value={e.dueDate}
                        onChange={(v) => majEcheance(e.cle, { dueDate: v })}
                        shortcuts={['endOfMonth', 'plus30']}
                      />
                    </Field>
                    <Field
                      id={`${p}-ech-${i}-label`}
                      label="Libellé"
                      required
                      size="lg"
                      error={erreurs[`billing.items.${i}.label`]}
                    >
                      <TextInput
                        value={e.label}
                        maxLength={200}
                        onChange={(ev) => majEcheance(e.cle, { label: ev.target.value })}
                      />
                    </Field>
                  </FormGrid>
                  {erreurs[`billing.items.${i}.lines`] ? (
                    <p className="text-xs font-medium text-[var(--danger)]">
                      {erreurs[`billing.items.${i}.lines`]}
                    </p>
                  ) : null}
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {lignesContrat.map((l, n) =>
                      l.source === 'origin' ? null : (
                        <li key={n} className="flex min-w-0 items-center gap-2 text-sm">
                          <TextInput
                            aria-label={`Quantité à l’échéance ${i + 1} — ${nomsLignes?.[n] ?? nomLigne(l, n)}`}
                            inputMode="decimal"
                            value={e.quantites[n] ?? ''}
                            onChange={(ev) =>
                              majEcheance(e.cle, {
                                quantites: { ...e.quantites, [n]: ev.target.value },
                              })
                            }
                            className="w-24 shrink-0 text-right tabular-nums"
                            aria-invalid={
                              erreurs[`billing.items.${i}.lines.${n}`] ? true : undefined
                            }
                          />
                          <span className="min-w-0 break-words">
                            {nomsLignes?.[n] ?? nomLigne(l, n)}
                          </span>
                          {erreurs[`billing.items.${i}.lines.${n}`] ? (
                            <span className="text-xs text-[var(--danger)]">
                              {erreurs[`billing.items.${i}.lines.${n}`]}
                            </span>
                          ) : null}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
              <button
                type="button"
                className={`${BOUTON_PETIT} self-start max-sm:h-11`}
                onClick={() =>
                  setF((x) => ({
                    ...x,
                    echeances: [...x.echeances, echeanceVide(x.echeances.length)],
                  }))
                }
              >
                + Échéance
              </button>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <FormGrid>
        <Field
          id={`${p}-clauses`}
          label="Clauses"
          optional
          size="full"
          hint="Texte libre, saisi par vous. Lalanda ne propose aucun modèle de clause."
          error={erreurs['clauses']}
          disabled={desactive}
        >
          <TextArea
            value={f.clauses}
            rows={4}
            maxLength={4000}
            onChange={(e) => set('clauses')(e.target.value)}
          />
        </Field>
      </FormGrid>
    </div>
  );
}

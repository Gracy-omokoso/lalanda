'use client';

// Clauses SAISIES d'un contrat (début, durée, reconduction, préavis, échéancier, texte) —
// ADR-0050 § 2.3, § 2.4, lot V7. Lalanda calcule des dates à partir de ces clauses ; il
// n'en juge pas la validité juridique (bandeau constant de la fiche).

import { SALES_CONTRACT_CLAUSES_BANNER } from '@lalanda/shared/sales-contracts';

import type { InvoiceLineBody } from '@/lib/api';

import { BOUTON_PETIT, CHAMP, Champ, aria } from '../../_components/form-ui';

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

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-md border border-[var(--border)] p-3 text-sm">
        {SALES_CONTRACT_CLAUSES_BANNER}
      </p>
      <fieldset className="grid gap-4 sm:grid-cols-3" disabled={desactive}>
        <legend className="mb-1 text-sm font-semibold sm:col-span-3">Durée et préavis</legend>
        <Champ id={`${p}-debut`} label="Début du contrat" requis erreur={erreurs['startDate']}>
          <input
            id={`${p}-debut`}
            type="date"
            value={f.startDate}
            onChange={(e) => set('startDate')(e.target.value)}
            className={CHAMP}
            {...aria(`${p}-debut`, erreurs['startDate'])}
          />
        </Champ>
        <Champ
          id={`${p}-duree`}
          label="Durée du premier terme (mois)"
          aide="Vide : durée indéterminée."
          erreur={erreurs['initialTermMonths']}
        >
          <input
            id={`${p}-duree`}
            inputMode="numeric"
            value={f.dureeMois}
            onChange={(e) => set('dureeMois')(e.target.value)}
            className={CHAMP}
            {...aria(`${p}-duree`, erreurs['initialTermMonths'], true)}
          />
        </Champ>
        <Champ
          id={`${p}-preavis`}
          label="Préavis (jours)"
          requis
          aide="Clause de votre contrat, de 0 à 365 jours."
          erreur={erreurs['noticeDays']}
        >
          <input
            id={`${p}-preavis`}
            inputMode="numeric"
            value={f.preavisJours}
            onChange={(e) => set('preavisJours')(e.target.value)}
            className={CHAMP}
            {...aria(`${p}-preavis`, erreurs['noticeDays'], true)}
          />
        </Champ>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3" disabled={desactive}>
        <legend className="mb-1 text-sm font-semibold sm:col-span-3">Reconduction</legend>
        <Champ id={`${p}-reconduction`} label="Mode" erreur={erreurs['renewal.mode']}>
          <select
            id={`${p}-reconduction`}
            value={f.reconduction}
            onChange={(e) =>
              set('reconduction')(e.target.value as FormulaireClauses['reconduction'])
            }
            className={CHAMP}
          >
            {(Object.keys(RECONDUCTION_LABELS) as FormulaireClauses['reconduction'][]).map((m) => (
              <option key={m} value={m}>
                {RECONDUCTION_LABELS[m]}
              </option>
            ))}
          </select>
        </Champ>
        {f.reconduction !== 'none' ? (
          <>
            <Champ
              id={`${p}-periode`}
              label="Période de reconduction (mois)"
              requis
              erreur={erreurs['renewal.periodMonths']}
            >
              <input
                id={`${p}-periode`}
                inputMode="numeric"
                value={f.periodeMois}
                onChange={(e) => set('periodeMois')(e.target.value)}
                className={CHAMP}
                {...aria(`${p}-periode`, erreurs['renewal.periodMonths'])}
              />
            </Champ>
            <Champ
              id={`${p}-max`}
              label="Nombre maximal de reconductions"
              aide="Vide : sans limite saisie."
              erreur={erreurs['renewal.maxRenewals']}
            >
              <input
                id={`${p}-max`}
                inputMode="numeric"
                value={f.maxReconductions}
                onChange={(e) => set('maxReconductions')(e.target.value)}
                className={CHAMP}
                {...aria(`${p}-max`, erreurs['renewal.maxRenewals'], true)}
              />
            </Champ>
          </>
        ) : null}
        {f.reconduction === 'tacit' ? (
          <p className="text-xs text-[var(--foreground-muted)] sm:col-span-3">
            À la fin de chaque terme, Lalanda propose le terme suivant ; une personne habilitée le
            constate d’un geste. Sans ce geste, aucun brouillon n’est préparé au-delà du terme.
          </p>
        ) : null}
      </fieldset>

      {avecEcheancier ? (
        <fieldset className="flex flex-col gap-4" disabled={desactive}>
          <legend className="mb-1 text-sm font-semibold">Facturation</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                ['none', 'Sans échéancier (factures préparées à la main)'],
                ['recurring', 'Abonnement (récurrent)'],
                ['schedule', 'Échéancier à dates fixes'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${p}-facturation`}
                  checked={f.facturation === k}
                  onChange={() =>
                    setF((x) => ({
                      ...x,
                      facturation: k,
                      echeances:
                        k === 'schedule' && x.echeances.length === 0
                          ? [echeanceVide(0)]
                          : x.echeances,
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {f.facturation === 'recurring' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Champ id={`${p}-frequence`} label="Fréquence">
                <select
                  id={`${p}-frequence`}
                  value={f.frequence}
                  onChange={(e) =>
                    set('frequence')(e.target.value as FormulaireClauses['frequence'])
                  }
                  className={CHAMP}
                >
                  {(Object.keys(FREQUENCE_LABELS) as FormulaireClauses['frequence'][]).map((k) => (
                    <option key={k} value={k}>
                      {FREQUENCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Champ>
              <Champ
                id={`${p}-ancre`}
                label="Première échéance"
                requis
                aide="Les suivantes tombent le même quantième, ramené au dernier jour du mois."
                erreur={erreurs['billing.anchorDate']}
              >
                <input
                  id={`${p}-ancre`}
                  type="date"
                  value={f.ancre}
                  onChange={(e) => set('ancre')(e.target.value)}
                  className={CHAMP}
                  {...aria(`${p}-ancre`, erreurs['billing.anchorDate'], true)}
                />
              </Champ>
              <Champ id={`${p}-moment`} label="Libellé de période">
                <select
                  id={`${p}-moment`}
                  value={f.moment}
                  onChange={(e) => set('moment')(e.target.value as FormulaireClauses['moment'])}
                  className={CHAMP}
                >
                  {(Object.keys(MOMENT_LABELS) as FormulaireClauses['moment'][]).map((k) => (
                    <option key={k} value={k}>
                      {MOMENT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Champ>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <input
                  type="checkbox"
                  checked={f.autoPrepare}
                  onChange={(e) => set('autoPrepare')(e.target.checked)}
                />
                Préparer les brouillons automatiquement à chaque échéance (jamais émis seuls)
              </label>
              <p className="text-xs text-[var(--foreground-muted)] sm:col-span-3">
                Chaque brouillon reprend les lignes du contrat en vigueur à la date de l’échéance.
                Aucun prorata : une période incomplète s’ajuste à la main sur le brouillon.
              </p>
            </div>
          ) : null}
          {f.facturation === 'schedule' ? (
            <div className="flex flex-col gap-3">
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
                  className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Champ
                      id={`${p}-ech-${e.cle}-date`}
                      label={`Échéance ${i + 1} — date`}
                      requis
                      erreur={erreurs[`billing.items.${i}.dueDate`]}
                    >
                      <input
                        id={`${p}-ech-${e.cle}-date`}
                        type="date"
                        value={e.dueDate}
                        onChange={(ev) =>
                          setF((x) => ({
                            ...x,
                            echeances: x.echeances.map((y) =>
                              y.cle === e.cle ? { ...y, dueDate: ev.target.value } : y,
                            ),
                          }))
                        }
                        className={CHAMP}
                      />
                    </Champ>
                    <Champ
                      id={`${p}-ech-${e.cle}-label`}
                      label="Libellé"
                      requis
                      erreur={erreurs[`billing.items.${i}.label`]}
                    >
                      <input
                        id={`${p}-ech-${e.cle}-label`}
                        value={e.label}
                        maxLength={200}
                        onChange={(ev) =>
                          setF((x) => ({
                            ...x,
                            echeances: x.echeances.map((y) =>
                              y.cle === e.cle ? { ...y, label: ev.target.value } : y,
                            ),
                          }))
                        }
                        className={CHAMP}
                      />
                    </Champ>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className={BOUTON_PETIT}
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
                  </div>
                  {erreurs[`billing.items.${i}.lines`] ? (
                    <p className="text-xs font-medium text-[var(--danger)]">
                      {erreurs[`billing.items.${i}.lines`]}
                    </p>
                  ) : null}
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {lignesContrat.map((l, n) =>
                      l.source === 'origin' ? null : (
                        <li key={n} className="flex items-center gap-2 text-sm">
                          <input
                            aria-label={`Quantité à l’échéance ${i + 1} — ${nomsLignes?.[n] ?? nomLigne(l, n)}`}
                            inputMode="decimal"
                            value={e.quantites[n] ?? ''}
                            onChange={(ev) =>
                              setF((x) => ({
                                ...x,
                                echeances: x.echeances.map((y) =>
                                  y.cle === e.cle
                                    ? { ...y, quantites: { ...y.quantites, [n]: ev.target.value } }
                                    : y,
                                ),
                              }))
                            }
                            className={`${CHAMP} max-w-[6rem] text-right`}
                            aria-invalid={
                              erreurs[`billing.items.${i}.lines.${n}`] ? true : undefined
                            }
                          />
                          <span>{nomsLignes?.[n] ?? nomLigne(l, n)}</span>
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
                className={`${BOUTON_PETIT} self-start`}
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

      <Champ
        id={`${p}-clauses`}
        label="Clauses (texte libre, saisi par vous)"
        aide="Lalanda ne propose aucun modèle de clause."
        erreur={erreurs['clauses']}
      >
        <textarea
          id={`${p}-clauses`}
          value={f.clauses}
          rows={4}
          maxLength={4000}
          onChange={(e) => set('clauses')(e.target.value)}
          className={CHAMP}
          disabled={desactive}
        />
      </Champ>
    </div>
  );
}

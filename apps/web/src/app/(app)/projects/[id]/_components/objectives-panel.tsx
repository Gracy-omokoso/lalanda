'use client';

// Objectifs financiers et taux d'atteinte (S18d, docs/01).
//
// Le taux d'atteinte est calculé PAR L'API contre le snapshot du dernier plan
// validé (docs/26 : aucune règle financière dans un composant UI). Ce composant
// se contente d'afficher `atteinte`, `statut` et, quand la mesure n'existe pas,
// de le dire explicitement — jamais un 0 par défaut (ADR-0011, risque n°4).

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  api,
  OBJECTIVE_KEYS,
  type AttainmentStatut,
  type AttainmentView,
  type ObjectiveAttainment,
  type ObjectiveKey,
  type ObjectivesInput,
  type ProjectView,
} from '@/lib/api';

const OBJECTIVE_META: Record<ObjectiveKey, { label: string; aide: string }> = {
  ca_cible_an1: {
    label: "Chiffre d'affaires cible à 1 an",
    aide: 'Comparé à la ligne « CA annuel 1 » du plan validé.',
  },
  ca_cible_an5: {
    label: "Chiffre d'affaires cible à 5 ans",
    aide: 'Mesurable dès que votre plan projette 5 exercices.',
  },
  resultat_net_cible_an1: {
    label: 'Résultat net cible à 1 an',
    aide: 'Comparé à la ligne « Résultat annuel 1 » du plan validé.',
  },
  resultat_net_cible_an5: {
    label: 'Résultat net cible à 5 ans',
    aide: 'Mesurable dès que votre plan projette 5 exercices.',
  },
  tresorerie_cible: {
    label: 'Trésorerie cible (fin de 1re année)',
    aide: 'Comparée à la trésorerie de fin du 12e mois.',
  },
};

/**
 * Rendu d'un statut : pastille + libellé texte.
 * La couleur n'est JAMAIS seule porteuse d'information (docs/04, accessibilité).
 */
const STATUT_META: Record<AttainmentStatut, { dot: string; label: string; text: string }> = {
  atteint: { dot: 'dot-ok', label: 'Atteint', text: 'text-[var(--ok)]' },
  partiel: { dot: 'dot-warn', label: 'Partiellement atteint', text: 'text-[var(--warn)]' },
  non_atteint: { dot: 'dot-ko', label: 'Non atteint', text: 'text-[var(--ko)]' },
  indisponible: {
    dot: 'bg-[var(--border-strong)]',
    label: 'Non mesurable',
    text: 'text-[var(--foreground-muted)]',
  },
};

type FormState = Record<ObjectiveKey, string>;

function emptyForm(): FormState {
  return Object.fromEntries(OBJECTIVE_KEYS.map((k) => [k, ''])) as FormState;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ObjectivesPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [attainment, setAttainment] = useState<AttainmentView | null>(null);
  /** Renseigné quand l'API répond 409 NO_APPROVED_PLAN — ce n'est pas une erreur. */
  const [noPlan, setNoPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currency = project?.deviseAffichage ?? 'USD';

  const loadAttainment = useCallback(async (): Promise<void> => {
    try {
      setAttainment(await api.getAttainment(projectId));
      setNoPlan(false);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setAttainment(null);
      // 409 = aucun plan validé : cas métier normal, pas un message d'erreur rouge.
      setNoPlan(status === 409);
      if (status !== 409) {
        setError(err instanceof Error ? err.message : "Impossible de calculer l'atteinte");
      }
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [proj, objectives] = await Promise.all([
          api.getProject(projectId),
          api.getObjectives(projectId),
        ]);
        if (cancelled) return;
        setProject(proj);
        const next = emptyForm();
        for (const key of OBJECTIVE_KEYS) {
          const value = objectives[key];
          next[key] = value === undefined ? '' : String(value);
        }
        setForm(next);
        await loadAttainment();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Impossible de charger les objectifs');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadAttainment]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // PUT = remplacement complet : un champ vidé efface la cible côté serveur.
      const payload: ObjectivesInput = {};
      for (const key of OBJECTIVE_KEYS) {
        const raw = form[key].trim();
        if (raw === '') continue;
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`« ${OBJECTIVE_META[key].label} » doit être un montant positif.`);
        }
        payload[key] = parsed;
      }
      await api.putObjectives(projectId, payload);
      setSavedAt(new Date().toISOString());
      await loadAttainment();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer les objectifs');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement des objectifs…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold tracking-tight">Objectifs financiers</h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Fixez vos cibles, puis comparez-les au dernier plan validé. Une cible laissée vide n’est
          pas évaluée.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-4">
            <legend className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
              Mes cibles ({currency})
            </legend>
            {OBJECTIVE_KEYS.map((key) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{OBJECTIVE_META[key].label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    min={0}
                    inputMode="decimal"
                    value={form[key]}
                    placeholder="—"
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="fig w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                  />
                  <span className="w-10 text-xs text-[var(--foreground-muted)]">{currency}</span>
                </div>
                <span className="text-xs italic text-[var(--foreground-muted)]">
                  {OBJECTIVE_META[key].aide}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les objectifs'}
            </button>
            {savedAt ? (
              <span className="text-xs text-[var(--foreground-muted)]">
                Enregistré à {new Date(savedAt).toLocaleTimeString('fr-FR')}
              </span>
            ) : null}
          </div>
        </form>

        <AttainmentCard
          projectId={projectId}
          attainment={attainment}
          noPlan={noPlan}
          currency={currency}
        />
      </div>
    </div>
  );
}

// ─── Carte d'atteinte ────────────────────────────────────────

function AttainmentCard({
  projectId,
  attainment,
  noPlan,
  currency,
}: {
  projectId: string;
  attainment: AttainmentView | null;
  noPlan: boolean;
  currency: string;
}): React.ReactElement {
  if (noPlan) {
    return (
      <section className="doc-card flex flex-col gap-2 p-4">
        <h3 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#6c685a]">
          Taux d’atteinte
        </h3>
        <p className="text-sm text-[#14191b]">
          Aucun plan validé pour ce projet. L’atteinte se mesure contre des chiffres figés : validez
          d’abord un plan.
        </p>
        <Link
          href={`/projects/${projectId}`}
          className="self-start rounded-md border border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
        >
          Aller au plan financier
        </Link>
      </section>
    );
  }

  if (!attainment) {
    return (
      <section className="doc-card p-4">
        <p className="text-sm text-[#6c685a]">Calcul de l’atteinte indisponible.</p>
      </section>
    );
  }

  return (
    <section className="doc-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#6c685a]">
          Taux d’atteinte
        </h3>
        <span className="text-xs text-[#6c685a]">
          Plan validé <span className="fig font-semibold">v{attainment.planVersion}</span> du{' '}
          {new Date(attainment.planApprovedAt).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </span>
      </header>

      {attainment.objectifs.length === 0 ? (
        <p className="text-sm text-[#6c685a]">
          Aucune cible renseignée — saisissez au moins un objectif pour mesurer son atteinte.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attainment.objectifs.map((o) => (
            <AttainmentRow key={o.objectif} item={o} currency={currency} />
          ))}
        </ul>
      )}

      <p className="text-[0.65rem] leading-snug text-[#6c685a]">
        Seuil « partiellement atteint » : à partir de {attainment.seuilPartielPct} %. Les valeurs
        observées proviennent du snapshot figé du plan validé — elles ne sont jamais recalculées.
      </p>
    </section>
  );
}

function AttainmentRow({
  item,
  currency,
}: {
  item: ObjectiveAttainment;
  currency: string;
}): React.ReactElement {
  const statut = STATUT_META[item.statut];
  const mesurable = item.atteinte !== null;

  return (
    <li className="flex flex-col gap-1 rounded-md border border-[#d6cdb9] bg-white/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-[#14191b]">{item.label}</span>
        <span className={`fig text-sm font-semibold ${statut.text}`}>
          {mesurable ? `${item.atteinte} %` : '—'}
        </span>
      </div>

      {/* Pastille ET texte : la couleur ne porte jamais seule le statut. */}
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`dot ${statut.dot}`} />
        <span className={`text-[0.7rem] font-medium ${statut.text}`}>{statut.label}</span>
      </div>

      <div className="ledger-row text-[0.7rem] text-[#6c685a]">
        <span>Cible</span>
        <span className="leader" aria-hidden="true" />
        <span className="fig">{formatMoney(item.cible, currency)}</span>
      </div>
      <div className="ledger-row text-[0.7rem] text-[#6c685a]">
        <span>Plan validé</span>
        <span className="leader" aria-hidden="true" />
        <span className="fig">
          {item.valeur === null ? 'non disponible' : formatMoney(item.valeur, currency)}
        </span>
      </div>

      {item.raison ? (
        <p className="text-[0.7rem] italic leading-snug text-[#6c685a]">
          {item.raison === 'LIGNE_INDISPONIBLE'
            ? 'Cette mesure n’existe pas dans le plan validé. Aucun taux n’est affiché plutôt qu’un chiffre trompeur.'
            : 'Cette mesure existe dans le plan validé mais ne porte pas un montant exploitable. Aucun taux n’est affiché plutôt qu’un chiffre trompeur.'}
        </p>
      ) : null}
    </li>
  );
}

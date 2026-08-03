'use client';

// Vue projet : charge le projet + ses drivers, permet d'ajuster, évalue via l'API,
// affiche la table de résultats. Bouton "Enregistrer" persiste les drivers.
// Aucune logique métier locale — le moteur reste la source de vérité (brief §3-1).

import { useEffect, useState } from 'react';

import { api, type LineResult, type ProjectView } from '@/lib/api';

interface DriverDef {
  id: string;
  label: string;
  defaut: number;
  unite?: string;
  isPercent?: boolean;
}

// Défauts synchronisés avec toy-template.yaml (côté serveur). S5-full lira les métadonnées via l'API.
const DRIVERS: DriverDef[] = [
  { id: 'prix_unitaire', label: 'Prix unitaire', defaut: 10, unite: '$' },
  { id: 'quantite_mois', label: 'Quantité par mois', defaut: 100, unite: 'unités' },
  { id: 'cout_variable_pct', label: 'Coût variable', defaut: 0.4, isPercent: true },
  { id: 'charges_fixes_mois', label: 'Charges fixes par mois', defaut: 500, unite: '$' },
  { id: 'taux_impot', label: "Taux d'impôt", defaut: 0.3, isPercent: true },
];

function formatValue(value: number, format: LineResult['format']): string {
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'money') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

export function ProjectPlan({ projectId }: { projectId: string }): React.ReactElement {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<LineResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function load(): Promise<void> {
    setError(null);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      const initial = {
        ...Object.fromEntries(DRIVERS.map((d) => [d.id, d.defaut])),
        ...p.driverValues,
      };
      setValues(initial);
      setDirty(false);
      await evaluate(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
  }

  async function evaluate(payload: Record<string, number>): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await api.evaluateProject(projectId, payload, false);
      setLines(res.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'évaluation");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateDrivers(projectId, values);
      setProject(updated);
      setDirty(false);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de sauvegarder');
    } finally {
      setSaving(false);
    }
  }

  function updateDriver(id: string, raw: string): void {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const def = DRIVERS.find((d) => d.id === id)!;
    const finalValue = def.isPercent ? parsed / 100 : parsed;
    setValues((v) => ({ ...v, [id]: finalValue }));
    setDirty(true);
  }

  if (!project) {
    return <p className="text-sm opacity-60">{error ?? 'Chargement…'}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{project.name}</h2>
        <span className="text-xs opacity-60">
          Template <code>{project.templateSlug}</code>
        </span>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void evaluate(values);
          }}
          className="flex flex-col gap-4"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide opacity-60">Hypothèses</h3>
          {DRIVERS.map((d) => {
            const display = d.isPercent ? (values[d.id] ?? 0) * 100 : (values[d.id] ?? 0);
            return (
              <label key={d.id} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{d.label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    value={display}
                    onChange={(e) => updateDriver(d.id, e.target.value)}
                    className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/30"
                  />
                  <span className="w-16 text-xs opacity-60">
                    {d.isPercent ? '%' : (d.unite ?? '')}
                  </span>
                </div>
              </label>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {loading ? 'Calcul…' : 'Recalculer'}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
            >
              {saving ? 'Sauvegarde…' : dirty ? 'Enregistrer' : 'Enregistré'}
            </button>
            {savedAt ? (
              <span className="text-xs opacity-60">
                Sauvegardé à {new Date(savedAt).toLocaleTimeString('fr-FR')}
              </span>
            ) : null}
          </div>
        </form>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide opacity-60">Résultats</h3>
          {error ? (
            <div className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <strong>Erreur :</strong> {error}
            </div>
          ) : null}
          {lines ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left dark:border-white/10">
                  <th className="py-2 pr-2 font-medium opacity-60">Ligne</th>
                  <th className="py-2 pl-2 text-right font-medium opacity-60">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr
                    key={line.lineId}
                    className={`border-b border-black/5 dark:border-white/5 ${
                      line.lineId === 'resultat_net' ? 'font-semibold' : ''
                    }`}
                  >
                    <td className="py-2 pr-2">{line.label}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">
                      {formatValue(line.value, line.format)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm opacity-60">…</p>
          )}
        </div>
      </div>
    </div>
  );
}

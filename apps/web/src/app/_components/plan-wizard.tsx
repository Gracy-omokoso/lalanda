'use client';

// Wizard minimal : saisie des 5 drivers du template jouet, appel de POST /evaluate,
// affichage de la table de résultats. Aucune logique métier ici — le calcul est
// exclusivement côté serveur (via le moteur), la source de vérité (brief §3-1).

import { useEffect, useState } from 'react';

interface DriverDef {
  id: string;
  label: string;
  defaut: number;
  unite?: string;
  isPercent?: boolean;
}

// Défauts synchronisés avec toy-template.yaml — évite un round-trip supplémentaire au chargement.
// La source de vérité reste le fichier YAML côté serveur ; ces valeurs sont ré-envoyées via /evaluate.
const DRIVERS: DriverDef[] = [
  { id: 'prix_unitaire', label: 'Prix unitaire', defaut: 10, unite: '$' },
  { id: 'quantite_mois', label: 'Quantité par mois', defaut: 100, unite: 'unités' },
  { id: 'cout_variable_pct', label: 'Coût variable', defaut: 0.4, isPercent: true },
  { id: 'charges_fixes_mois', label: 'Charges fixes par mois', defaut: 500, unite: '$' },
  { id: 'taux_impot', label: "Taux d'impôt", defaut: 0.3, isPercent: true },
];

interface LineResult {
  sheetId: string;
  lineId: string;
  label: string;
  formulaSource: string;
  value: number;
  format: 'money' | 'number' | 'percent';
}

interface EvaluateResponse {
  templateSlug: string;
  templateVersion: string;
  drivers: Record<string, number>;
  lines: LineResult[];
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

function formatValue(value: number, format: LineResult['format']): string {
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 }).format(
      value,
    );
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

export function PlanWizard(): React.ReactElement {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(DRIVERS.map((d) => [d.id, d.defaut])),
  );
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function evaluate(payload: Record<string, number>): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateSlug: 'hello-world', drivers: payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as EvaluateResponse;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Évaluation automatique au premier rendu.
  useEffect(() => {
    void evaluate(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void evaluate(values);
  }

  function updateDriver(id: string, raw: string): void {
    // Interprétation : les champs `isPercent` acceptent la valeur en pourcentage (ex : 40)
    // et sont convertis en fraction (0.4) avant envoi.
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const def = DRIVERS.find((d) => d.id === id)!;
    const finalValue = def.isPercent ? parsed / 100 : parsed;
    setValues((v) => ({ ...v, [id]: finalValue }));
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {loading ? 'Calcul en cours…' : 'Recalculer'}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide opacity-60">Résultats</h3>
        {error ? (
          <div className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <strong>Erreur :</strong> {error}
          </div>
        ) : null}
        {result ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/10">
                <th className="py-2 pr-2 font-medium opacity-60">Ligne</th>
                <th className="py-2 pl-2 text-right font-medium opacity-60">Valeur</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((line) => (
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
        ) : null}
        {result ? (
          <p className="text-xs opacity-50">
            Template <code>{result.templateSlug}</code> v{result.templateVersion}
          </p>
        ) : null}
      </div>
    </div>
  );
}

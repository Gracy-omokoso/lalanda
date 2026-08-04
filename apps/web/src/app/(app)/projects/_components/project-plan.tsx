'use client';

// Vue projet — wizard généré dynamiquement depuis le DSL (S5a) :
// - drivers, labels, aide, min/max, unité, devise viennent tous du serveur
// - regroupement par `groupes_hypotheses` si le template en définit
// Aucune logique métier locale — le moteur reste la source de vérité (brief §3-1).

import { useEffect, useMemo, useState } from 'react';

import {
  api,
  type LineResult,
  type ProjectView,
  type TemplateDriverMeta,
  type TemplateMeta,
} from '@/lib/api';

interface DriverGroup {
  id: string;
  label: string;
  drivers: TemplateDriverMeta[];
}

function isPercent(d: TemplateDriverMeta): boolean {
  return d.type === 'percent';
}

function driverSuffix(d: TemplateDriverMeta): string {
  if (isPercent(d)) return '%';
  if (d.type === 'money') return d.devise ?? 'USD';
  return d.unite ?? '';
}

function formatValue(
  value: number,
  format: LineResult['format'],
  currency: string = 'USD',
): string {
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'money') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Regroupe les drivers selon `groupes_hypotheses` du template.
 * Fallback : un seul groupe "default" avec tous les drivers.
 */
function groupDrivers(template: TemplateMeta): DriverGroup[] {
  const groups = template.groupes_hypotheses ?? [];
  if (groups.length === 0) {
    return [{ id: '_all', label: 'Hypothèses', drivers: template.drivers }];
  }
  const byId = new Map(groups.map((g) => [g.id, { ...g, drivers: [] as TemplateDriverMeta[] }]));
  const orphans: TemplateDriverMeta[] = [];
  for (const d of template.drivers) {
    if (d.groupe && byId.has(d.groupe)) {
      byId.get(d.groupe)!.drivers.push(d);
    } else {
      orphans.push(d);
    }
  }
  const result: DriverGroup[] = [...byId.values()].filter((g) => g.drivers.length > 0);
  if (orphans.length > 0) result.push({ id: '_other', label: 'Autres', drivers: orphans });
  return result;
}

export function ProjectPlan({ projectId }: { projectId: string }): React.ReactElement {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<LineResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const groups = useMemo(() => (template ? groupDrivers(template) : []), [template]);
  const currency = template?.devise_base ?? 'USD';

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function load(): Promise<void> {
    setError(null);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      const { template: tmpl } = await api.getTemplate(p.templateSlug);
      setTemplate(tmpl);

      // Défauts DSL + overrides du projet.
      const defaults = Object.fromEntries(tmpl.drivers.map((d) => [d.id, d.defaut ?? 0]));
      const initial = { ...defaults, ...p.driverValues };
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

  function updateDriver(driver: TemplateDriverMeta, raw: string): void {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    // percent : l'UI reçoit en pourcentage (ex 40), on stocke en fraction (0.4).
    let final = isPercent(driver) ? parsed / 100 : parsed;
    // Contraintes min/max si définies dans le DSL.
    if (driver.min !== undefined && final < driver.min) final = driver.min;
    if (driver.max !== undefined && final > driver.max) final = driver.max;
    setValues((v) => ({ ...v, [driver.id]: final }));
    setDirty(true);
  }

  if (!project || !template) {
    return <p className="text-sm opacity-60">{error ?? 'Chargement…'}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{project.name}</h2>
        <span className="text-xs opacity-60">
          Template <code>{template.slug}</code> v{template.version}
        </span>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void evaluate(values);
          }}
          className="flex flex-col gap-6"
        >
          {groups.map((group) => (
            <fieldset key={group.id} className="flex flex-col gap-4">
              <legend className="text-sm font-semibold uppercase tracking-wide opacity-60">
                {group.label}
              </legend>
              {group.drivers.map((d) => {
                const raw = values[d.id] ?? d.defaut ?? 0;
                const display = isPercent(d) ? raw * 100 : raw;
                return (
                  <label key={d.id} className="flex flex-col gap-1 text-sm">
                    <span className="flex items-baseline justify-between gap-2 font-medium">
                      <span>{d.label ?? d.id}</span>
                      {d.min !== undefined || d.max !== undefined ? (
                        <span className="text-xs font-normal opacity-40">
                          {d.min !== undefined ? `min ${isPercent(d) ? d.min * 100 : d.min}` : ''}
                          {d.min !== undefined && d.max !== undefined ? ' · ' : ''}
                          {d.max !== undefined ? `max ${isPercent(d) ? d.max * 100 : d.max}` : ''}
                        </span>
                      ) : null}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="any"
                        value={display}
                        min={d.min !== undefined ? (isPercent(d) ? d.min * 100 : d.min) : undefined}
                        max={d.max !== undefined ? (isPercent(d) ? d.max * 100 : d.max) : undefined}
                        onChange={(e) => updateDriver(d, e.target.value)}
                        className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/30"
                      />
                      <span className="w-16 text-xs opacity-60">{driverSuffix(d)}</span>
                    </div>
                    {d.aide ? <span className="text-xs italic opacity-60">{d.aide}</span> : null}
                  </label>
                );
              })}
            </fieldset>
          ))}
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
                      {formatValue(line.value, line.format, currency)}
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

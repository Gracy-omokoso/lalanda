'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type ProjectView, type TemplateSummary } from '@/lib/api';

const TEMPLATE_LABELS: Record<string, { label: string; description: string }> = {
  'restaurant-kinshasa': {
    label: 'Restaurant à Kinshasa',
    description: 'Restauration. Couverts, food cost, salaires, loyer, charges.',
  },
  'quincaillerie-negoce': {
    label: 'Quincaillerie et négoce',
    description: 'Achat-revente. CA journalier, marge commerciale, stock, personnel.',
  },
  'prestation-services': {
    label: 'Prestation de services',
    description: 'Conseil, agence, freelance. Tarif journalier, taux de facturation, équipe.',
  },
  'hello-world': {
    label: 'Démo (hello-world)',
    description: 'Template minimal de démonstration. À réserver aux tests.',
  },
};

function templateMeta(slug: string): { label: string; description: string } {
  return TEMPLATE_LABELS[slug] ?? { label: slug, description: '' };
}

const DEFAULT_TEMPLATE_SLUG = 'restaurant-kinshasa';

export default function ProjectsPage(): React.ReactElement {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>(DEFAULT_TEMPLATE_SLUG);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshTemplates()]);
  }, []);

  async function refreshProjects(): Promise<void> {
    setError(null);
    try {
      const { projects } = await api.listProjects();
      setProjects(projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
  }

  async function refreshTemplates(): Promise<void> {
    try {
      const { templates } = await api.listTemplates();
      setTemplates(templates);
      // Si le défaut n'existe pas dans la liste renvoyée, on retombe sur le premier disponible.
      if (!templates.some((t) => t.slug === DEFAULT_TEMPLATE_SLUG) && templates[0]) {
        setSelectedSlug(templates[0].slug);
      }
    } catch {
      // Silencieux : le formulaire fonctionne quand même avec le défaut hardcodé.
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createProject({
        name: newName.trim(),
        templateSlug: selectedSlug,
      });
      setNewName('');
      router.push(`/projects/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer le projet');
      setCreating(false);
    }
  }

  // Templates hors "hello-world" en premier — le démo reste sélectionnable en dernier recours.
  const orderedTemplates = (templates ?? []).slice().sort((a, b) => {
    if (a.slug === 'hello-world') return 1;
    if (b.slug === 'hello-world') return -1;
    return a.slug.localeCompare(b.slug);
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Mes projets</h2>
          <p className="text-sm text-[var(--foreground-muted)]">
            Chaque projet = un plan financier basé sur un template sectoriel.
          </p>
        </div>
        {projects ? (
          <span className="text-xs text-[var(--foreground-muted)]">
            {projects.length} projet{projects.length > 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Nouveau projet</h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            Choisis un template sectoriel — les hypothèses par défaut sont pré-remplies et
            modifiables ensuite.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Template
          </legend>
          {templates === null ? (
            <p className="text-xs text-[var(--foreground-muted)]">Chargement des templates…</p>
          ) : orderedTemplates.length === 0 ? (
            <p className="text-xs text-[var(--foreground-muted)]">Aucun template disponible.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {orderedTemplates.map((t) => {
                const meta = templateMeta(t.slug);
                const active = selectedSlug === t.slug;
                return (
                  <label
                    key={t.slug}
                    className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                        : 'border-[var(--border)] hover:border-[var(--accent)]/40'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="templateSlug"
                        value={t.slug}
                        checked={active}
                        onChange={() => setSelectedSlug(t.slug)}
                        className="accent-[var(--accent)]"
                      />
                      <span className="font-medium">{meta.label}</span>
                      {t.secteur ? (
                        <span className="ml-auto rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--foreground-muted)]">
                          {t.secteur}
                        </span>
                      ) : null}
                    </span>
                    {meta.description ? (
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {meta.description}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium">Nom du projet</span>
            <input
              type="text"
              required
              maxLength={200}
              placeholder="Ex : Restaurant Kinshasa 2026"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !newName.trim() || !selectedSlug}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      {projects === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucun projet pour l&apos;instant. Crée ton premier plan financier ci-dessus.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="group flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-sm transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-muted)]"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {templateMeta(p.templateSlug).label} · mis à jour{' '}
                    {new Date(p.updatedAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="text-lg opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-80"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

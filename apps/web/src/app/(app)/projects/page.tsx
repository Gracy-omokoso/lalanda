'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type ProjectView } from '@/lib/api';

export default function ProjectsPage(): React.ReactElement {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const { projects } = await api.listProjects();
      setProjects(projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createProject({ name: newName.trim() });
      setNewName('');
      router.push(`/projects/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer le projet');
      setCreating(false);
    }
  }

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
        className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Nouveau projet</span>
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
          disabled={creating || !newName.trim()}
          className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Création…' : 'Créer'}
        </button>
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
                    Template <code>{p.templateSlug}</code> · mis à jour{' '}
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

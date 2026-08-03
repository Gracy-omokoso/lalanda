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
        <h2 className="text-xl font-semibold">Mes projets</h2>
        {projects ? (
          <span className="text-xs opacity-60">
            {projects.length} projet{projects.length > 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Nouveau projet</span>
          <input
            type="text"
            required
            maxLength={200}
            placeholder="Ex : Restaurant Kinshasa 2026"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/30"
          />
        </label>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {creating ? 'Création…' : 'Créer'}
        </button>
      </form>

      {error ? (
        <div className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {projects === null ? (
        <p className="text-sm opacity-60">Chargement…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm opacity-70 dark:border-white/20">
          Aucun projet pour l&apos;instant. Crée ton premier plan financier ci-dessus.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-center justify-between rounded-lg border border-black/10 bg-white/40 px-4 py-3 text-sm transition hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs opacity-60">
                    Template <code>{p.templateSlug}</code> · mis à jour{' '}
                    {new Date(p.updatedAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                <span className="text-xs opacity-50">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

'use client';

// Dashboard projets. Depuis S9 : la création exige un choix de pays + cadre fiscal
// (ParameterPack) en plus du template sectoriel. L'UI est un formulaire à sections
// clairement séparées, pas un vrai wizard multi-étapes — plus rapide pour un
// utilisateur habitué et lisible pour un nouveau.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { api, type ParameterPackSummary, type ProjectView, type TemplateSummary } from '@/lib/api';

import { PremiersPas } from './_components/premiers-pas';

const TEMPLATE_LABELS: Record<string, { label: string; description: string }> = {
  'restaurant-kinshasa': {
    label: 'Restaurant',
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
  'ecommerce-cod': {
    label: 'E-commerce (paiement à la livraison)',
    description:
      'Import, vente par publicité sociale ou WhatsApp, livraison encaissée en cash. Budget pub, taux de livraison, panier moyen.',
  },
  'hello-world': {
    label: 'Démo (hello-world)',
    description: 'Template minimal de démonstration. À réserver aux tests.',
  },
};

function templateMeta(slug: string): { label: string; description: string } {
  return TEMPLATE_LABELS[slug] ?? { label: slug, description: '' };
}

// Liste des pays exposés à l'utilisateur au moment de la création.
// Ordre : pays principaux MVP d'abord, puis le reste OHADA.
const COUNTRIES: Array<{ code: string; label: string; flag: string }> = [
  { code: 'CD', label: 'République Démocratique du Congo', flag: '🇨🇩' },
  { code: 'CI', label: "Côte d'Ivoire", flag: '🇨🇮' },
  { code: 'SN', label: 'Sénégal', flag: '🇸🇳' },
  { code: 'CM', label: 'Cameroun', flag: '🇨🇲' },
  { code: 'BJ', label: 'Bénin', flag: '🇧🇯' },
  { code: 'TG', label: 'Togo', flag: '🇹🇬' },
  { code: 'ML', label: 'Mali', flag: '🇲🇱' },
  { code: 'BF', label: 'Burkina Faso', flag: '🇧🇫' },
  { code: 'NE', label: 'Niger', flag: '🇳🇪' },
  { code: 'CG', label: 'Congo-Brazzaville', flag: '🇨🇬' },
  { code: 'GA', label: 'Gabon', flag: '🇬🇦' },
];

const DEFAULT_COUNTRY = 'CD';
const DEFAULT_TEMPLATE_SLUG = 'restaurant-kinshasa';

/**
 * Trouve le meilleur pack pour un pays donné :
 * 1. Match direct sur pack.pays
 * 2. Match sur pack.pays_couverts (packs génériques)
 * 3. Fallback : premier pack disponible.
 */
function bestPackForCountry(
  packs: ParameterPackSummary[],
  pays: string,
): ParameterPackSummary | undefined {
  return (
    packs.find((p) => p.pays === pays) ??
    packs.find((p) => p.pays_couverts?.includes(pays)) ??
    packs.find((p) => p.slug.startsWith('ohada-generic-')) ??
    packs[0]
  );
}

export default function ProjectsPage(): React.ReactElement {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [packs, setPacks] = useState<ParameterPackSummary[] | null>(null);

  const [country, setCountry] = useState<string>(DEFAULT_COUNTRY);
  const [packSlug, setPackSlug] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [templateSlug, setTemplateSlug] = useState<string>(DEFAULT_TEMPLATE_SLUG);
  const [newName, setNewName] = useState('');

  const [error, setError] = useState<string | null>(null);
  // (S16b) Limite de projets du plan atteinte (403 PLAN_LIMIT_PROJECTS de l'API).
  const [planLimit, setPlanLimit] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshTemplates(), refreshPacks()]);
  }, []);

  // Quand `packs` arrive ou que l'utilisateur change de pays : recalcule le pack par défaut.
  useEffect(() => {
    if (!packs || packs.length === 0) return;
    const best = bestPackForCountry(packs, country);
    if (best) {
      setPackSlug(best.slug);
      setCurrency(best.devise_principale);
    }
  }, [packs, country]);

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
      if (!templates.some((t) => t.slug === DEFAULT_TEMPLATE_SLUG) && templates[0]) {
        setTemplateSlug(templates[0].slug);
      }
    } catch {
      /* silencieux */
    }
  }

  async function refreshPacks(): Promise<void> {
    try {
      const { packs } = await api.listParameterPacks();
      setPacks(packs);
    } catch {
      /* silencieux — la création tape sur le fallback serveur */
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    setPlanLimit(null);
    try {
      const created = await api.createProject({
        name: newName.trim(),
        templateSlug,
        pays: country,
        parameterPackSlug: packSlug || undefined,
        deviseAffichage: (currency as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR') || undefined,
      });
      setNewName('');
      router.push(`/projects/${created.id}`);
    } catch (err) {
      // (S16b) L'API impose la limite de projets du plan : message dédié + lien tarifs.
      const detail = (err as { detail?: { code?: string; limit?: number } }).detail;
      if (detail?.code === 'PLAN_LIMIT_PROJECTS') {
        setPlanLimit(detail.limit ?? 1);
      } else {
        setError(err instanceof Error ? err.message : 'Impossible de créer le projet');
      }
      setCreating(false);
    }
  }

  // Packs pertinents pour le pays sélectionné : match direct ou générique le couvrant.
  const packsForCountry = useMemo(() => {
    if (!packs) return [];
    return packs.filter(
      (p) =>
        p.pays === country ||
        p.pays_couverts?.includes(country) ||
        p.slug.startsWith('ohada-generic-'),
    );
  }, [packs, country]);

  const orderedTemplates = (templates ?? []).slice().sort((a, b) => {
    if (a.slug === 'hello-world') return 1;
    if (b.slug === 'hello-world') return -1;
    return a.slug.localeCompare(b.slug);
  });

  const selectedPack = packs?.find((p) => p.slug === packSlug);
  const currencyOptions: Array<'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR'> = selectedPack
    ? Array.from(
        new Set(
          [selectedPack.devise_principale, selectedPack.devise_secondaire, 'USD', 'EUR'].filter(
            (v): v is 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR' => Boolean(v),
          ),
        ),
      )
    : ['USD', 'CDF', 'XOF', 'XAF', 'EUR'];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Mes projets</h2>
          <p className="text-sm text-[var(--foreground-muted)]">
            Un projet = un plan financier prévisionnel dans un pays et un cadre fiscal donnés.
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
        className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Nouveau projet</h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            Choisis d&apos;abord le pays et le cadre fiscal, puis le template sectoriel. Les
            hypothèses par défaut sont pré-remplies et modifiables ensuite.
          </p>
        </div>

        {/* Section 1 — Contexte fiscal */}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            1. Contexte fiscal du projet
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Pays</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Cadre fiscal</span>
              <select
                value={packSlug}
                onChange={(e) => {
                  const slug = e.target.value;
                  setPackSlug(slug);
                  const p = packs?.find((x) => x.slug === slug);
                  if (p) setCurrency(p.devise_principale);
                }}
                disabled={!packs}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
              >
                {packsForCountry.length === 0 ? (
                  <option>Chargement…</option>
                ) : (
                  packsForCountry.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.label} · {p.systeme_comptable}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Devise d&apos;affichage</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedPack?.description ? (
            <p className="text-xs italic text-[var(--foreground-muted)]">
              {selectedPack.description}
            </p>
          ) : null}
        </fieldset>

        {/* Section 2 — Template sectoriel */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            2. Template sectoriel
          </legend>
          {templates === null ? (
            <p className="text-xs text-[var(--foreground-muted)]">Chargement des templates…</p>
          ) : orderedTemplates.length === 0 ? (
            <p className="text-xs text-[var(--foreground-muted)]">Aucun template disponible.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {orderedTemplates.map((t) => {
                const meta = templateMeta(t.slug);
                const active = templateSlug === t.slug;
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
                        onChange={() => setTemplateSlug(t.slug)}
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

        {/* Section 3 — Nom + créer */}
        <fieldset className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium">Nom du projet</span>
            <input
              type="text"
              required
              maxLength={200}
              placeholder="Ex : Restaurant du centre-ville 2026"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !newName.trim() || !templateSlug || !packSlug}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Création…' : 'Créer le projet'}
          </button>
        </fieldset>
      </form>

      {planLimit !== null ? (
        <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--surface)] p-3 text-sm">
          Votre offre actuelle est limitée à {planLimit} projet{planLimit > 1 ? 's' : ''}. Passez à
          l&apos;offre Pro pour créer des projets illimités.{' '}
          <Link href="/pricing" className="font-medium text-[var(--accent)] underline">
            Voir les offres
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      {projects === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : projects.length === 0 ? (
        <PremiersPas />
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
                    {templateMeta(p.templateSlug).label} · {p.pays} · {p.deviseAffichage} · mis à
                    jour {new Date(p.updatedAt).toLocaleString('fr-FR')}
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

'use client';

// Dashboard projets. Depuis S9 : la création exige un choix de pays + cadre fiscal
// (ParameterPack) en plus du template sectoriel. L'UI est un formulaire à sections
// clairement séparées, pas un vrai wizard multi-étapes — plus rapide pour un
// utilisateur habitué et lisible pour un nouveau.

import { Modal, PageHeader, buttonClasses } from '@lalanda/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, type ParameterPackSummary, type ProjectView, type TemplateSummary } from '@/lib/api';
import { ideaLabApi } from '@/lib/idea-lab-api';

import { useShell } from '../_components/shell-context';
import { ideeDepuisRecherche } from '../idees/_components/idea-model';

import { aDesCartes, CUSTOM_TEMPLATE_SLUG } from './_components/custom-questionnaire-model';
import { CustomStartModal, type CadrageResultat } from './_components/custom-start-modal';
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
  custom: {
    label: 'Mon secteur n’est pas dans la liste',
    description:
      'Modèle générique, sans hypothèse de métier. Deux façons de démarrer : vos chiffres tout de suite, ou quelques questions sur votre initiative d’abord.',
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
  const { subscription } = useShell();
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
  /** Fenêtre « Nouvelle initiative » ouverte. */
  const [creation, setCreation] = useState(false);

  // (S23b) Modal du modèle générique : deux chemins puis le questionnaire de cadrage.
  const [modalCustom, setModalCustom] = useState(false);
  /**
   * Projet déjà créé par un cadrage dont une écriture ULTÉRIEURE a échoué (Canvas
   * ou drivers). Un « Réessayer » ne doit pas créer un second projet : il reprend
   * là où l'échec s'est produit.
   */
  const projetCadrageRef = useRef<string | null>(null);
  /** Champ « Nom du projet » — le chemin direct y renvoie le curseur. */
  const nomRef = useRef<HTMLInputElement>(null);
  /**
   * ADR-0036 § 3 — création ouverte depuis une idée (`?idee=<id>`). La création
   * reste celle-ci (modèle, pays, devise, limite de l'offre) ; une fois le projet
   * créé, l'idée ajoute ses cartes de texte au Canvas, puis le Canvas s'ouvre.
   */
  const [ideeSource, setIdeeSource] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshTemplates(), refreshPacks()]);
    // `window.location` plutôt que `useSearchParams` : la page reste rendue côté
    // client sans frontière Suspense, et l'identifiant est vérifié (24 hex).
    const ideeId = ideeDepuisRecherche(window.location.search);
    if (ideeId) {
      void ideaLabApi
        .get(ideeId)
        .then((idea) => {
          setIdeeSource({ id: idea.id, title: idea.title });
          setCreation(true);
          setNewName((n) => (n === '' ? idea.title.slice(0, 200) : n));
        })
        .catch(() => undefined);
    }
  }, []);

  /** Après création depuis une idée : cartes de l'idée vers le Canvas, puis le Canvas. */
  async function versCanvasDepuisIdee(projectId: string): Promise<boolean> {
    if (!ideeSource) return false;
    try {
      await ideaLabApi.promote(ideeSource.id, projectId);
    } catch {
      // Le projet existe : on l'ouvre quand même ; la promotion se refait depuis la fiche.
    }
    router.push(`/initiatives/${projectId}/canvas`);
    return true;
  }

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
      if (await versCanvasDepuisIdee(created.id)) return;
      // (S23b) Le modèle générique dépose sur l'assistant de saisie, à l'étape
      // du chiffre d'affaires — c'est le chemin « mon plan financier tout de
      // suite », et la demande est explicite : « il commence à saisir le chiffre
      // d'affaires ». Les modèles sectoriels gardent leur atterrissage habituel
      // sur les résultats, où les valeurs par défaut donnent déjà à lire.
      router.push(
        created.templateSlug === CUSTOM_TEMPLATE_SLUG
          ? `/initiatives/${created.id}/saisie`
          : `/initiatives/${created.id}`,
      );
    } catch (err) {
      // (S16b) L'API impose la limite de projets du plan : message dédié + lien tarifs.
      const detail = (err as { detail?: { code?: string; limit?: number } }).detail;
      if (detail?.code === 'PLAN_LIMIT_PROJECTS') {
        setPlanLimit(detail.limit ?? 1);
      } else {
        setError(err instanceof Error ? err.message : 'Impossible de créer l’initiative');
      }
      setCreating(false);
    }
  }

  /**
   * Sortie du questionnaire de cadrage (S23b) — normale ou anticipée.
   *
   * Trois écritures, dans cet ordre, chacune sautée si elle n'a rien à écrire :
   * créer le projet, poser le Canvas, poser les drivers déjà répondus. En cas
   * d'échec, la promesse est rejetée : le modal reste ouvert avec le message et
   * TOUTES les réponses. `projetCadrageRef` retient le projet déjà créé pour
   * qu'un second essai n'en crée pas un doublon.
   *
   * Ce qui n'est PAS fait ici : deviner un montant. `driverValues` ne contient
   * que des réponses saisies dans des champs numériques (voir
   * `custom-questionnaire-model.ts`).
   */
  async function handleCadrageTermine(resultat: CadrageResultat): Promise<void> {
    setError(null);
    setPlanLimit(null);

    let projectId = projetCadrageRef.current;
    if (!projectId) {
      const created = await api.createProject({
        name: resultat.nom,
        templateSlug: CUSTOM_TEMPLATE_SLUG,
        pays: country,
        parameterPackSlug: packSlug || undefined,
        deviseAffichage: (currency as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR') || undefined,
      });
      projectId = created.id;
      projetCadrageRef.current = projectId;
    }

    if (aDesCartes(resultat.blocs)) {
      await api.putCanvas(projectId, resultat.blocs);
    }
    const idsDrivers = Object.keys(resultat.driverValues);
    if (idsDrivers.length > 0) {
      await api.updateDrivers(projectId, resultat.driverValues);
    }

    // Le récapitulatif de préremplissage est porté par l'URL : l'assistant
    // possède déjà le template, il n'a besoin que de savoir QUOI annoncer.
    // Sans cette annonce, un chiffre posé sans qu'on sache d'où il vient ne
    // serait jamais relu (docs/06 § « une valeur suggérée n'est jamais
    // confondue avec une valeur saisie »).
    const params = new URLSearchParams();
    if (idsDrivers.length > 0) params.set('prerempli', idsDrivers.join(','));
    if (resultat.nbCartes > 0) params.set('cartes', String(resultat.nbCartes));
    const query = params.toString();

    setNewName('');
    projetCadrageRef.current = null;
    setModalCustom(false);
    if (await versCanvasDepuisIdee(projectId)) return;
    router.push(`/initiatives/${projectId}/saisie${query ? `?${query}` : ''}`);
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

  // Les modèles sectoriels d'abord, par ordre alphabétique ; puis le modèle
  // générique — « mon secteur n'est pas dans la liste » n'a de sens qu'APRÈS la
  // liste ; la démo en dernier.
  const RANG_FIN: Record<string, number> = { [CUSTOM_TEMPLATE_SLUG]: 1, 'hello-world': 2 };
  const orderedTemplates = (templates ?? []).slice().sort((a, b) => {
    const ra = RANG_FIN[a.slug] ?? 0;
    const rb = RANG_FIN[b.slug] ?? 0;
    if (ra !== rb) return ra - rb;
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
      <PageHeader
        module="build"
        title="Initiatives"
        description="Une initiative est un plan financier prévisionnel, dans un pays et un cadre fiscal donnés. Vos hypothèses alimentent les prévisions calculées par le moteur ; le réalisé s’y compare, mois par mois."
        actions={
          <>
            {projects ? (
              // ADR-0030 § 3 (audit A10) : la limite de l'offre se voit AVANT de
              // créer, pas seulement au refus. Chiffres servis par l'API.
              <span className="fig text-xs text-[var(--foreground-muted)]">
                {projects.length} initiative{projects.length > 1 ? 's' : ''}
                {subscription && subscription.entitlements.maxProjects !== null
                  ? ` sur ${subscription.entitlements.maxProjects} inclus dans votre offre`
                  : ''}
              </span>
            ) : null}
            <button
              type="button"
              className={buttonClasses('primary', 'md')}
              onClick={() => {
                setError(null);
                setPlanLimit(null);
                setCreation(true);
              }}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouvelle initiative
            </button>
          </>
        }
      />

      <Modal
        open={creation}
        onClose={() => {
          setCreation(false);
          setModalCustom(false);
        }}
        title="Nouvelle initiative"
        description="Choisissez d’abord le pays et le cadre fiscal, puis le template sectoriel. Les hypothèses par défaut sont pré-remplies et modifiables ensuite."
        size="lg"
        busy={creating}
      >
        <form
          onSubmit={handleCreate}
          aria-label="Nouvelle initiative"
          className="flex flex-col gap-6"
        >
          {ideeSource && (
            <p role="status" className="rounded-md border border-[var(--border)] p-3 text-sm">
              Nouvelle initiative à partir de l’idée « {ideeSource.title} » : son problème, sa
              cible, sa solution et son modèle de revenus deviendront des cartes du Canvas. Aucun
              chiffre n’est repris.
            </p>
          )}

          {/* Section 1 — Contexte fiscal */}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
              1. Contexte fiscal de l’initiative
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="font-medium">Pays</span>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full min-w-0 truncate rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
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
                  className="w-full min-w-0 truncate rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
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
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="font-medium">Devise d&apos;affichage</span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full min-w-0 truncate rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
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
                          // (S23b) Le modèle générique ouvre son modal à CHAQUE
                          // clic, y compris quand il est déjà sélectionné :
                          // `onChange` ne se déclenche pas sur un radio déjà
                          // coché, et l'utilisateur qui reclique cherche
                          // précisément à revoir les deux chemins.
                          onClick={() => {
                            if (t.slug === CUSTOM_TEMPLATE_SLUG) setModalCustom(true);
                          }}
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
              <span className="font-medium">Nom de l’initiative</span>
              <input
                ref={nomRef}
                type="text"
                required
                maxLength={200}
                placeholder="Ex : Restaurant du centre-ville 2026"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full min-w-0 truncate rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={creating || !newName.trim() || !templateSlug || !packSlug}
              className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
            >
              {creating ? 'Création…' : 'Créer l’initiative'}
            </button>
          </fieldset>
          {planLimit !== null ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--accent)]/30 bg-[var(--surface)] p-3 text-sm"
            >
              Votre offre actuelle est limitée à {planLimit} initiative{planLimit > 1 ? 's' : ''}.
              Passez à l&apos;offre Pro pour créer des initiatives illimitées.{' '}
              <Link href="/pricing" className="font-medium text-[var(--accent)] underline">
                Voir les offres
              </Link>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
            >
              {error}
            </div>
          ) : null}
        </form>

        {modalCustom ? (
          <CustomStartModal
            nomInitial={newName}
            onFermer={() => setModalCustom(false)}
            onDirect={() => {
              // Chemin direct : rien n'est créé ici. Le formulaire reste maître —
              // le modèle générique est sélectionné, il ne manque que le nom, et
              // « Créer le projet » déposera sur l'assistant de saisie.
              setModalCustom(false);
              setTemplateSlug(CUSTOM_TEMPLATE_SLUG);
              requestAnimationFrame(() => nomRef.current?.focus());
            }}
            onCadrageTermine={handleCadrageTermine}
          />
        ) : null}
      </Modal>

      {error && !creation ? (
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
                href={`/initiatives/${p.id}`}
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

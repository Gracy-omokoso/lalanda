'use client';

// Business Model Canvas — grille des 9 blocs (S18d, docs/05).
//
// Principes :
// - édition inline : chaque carte est un textarea, pas de modale;
// - auto-save au blur : on n'écrit que si le contenu a réellement changé
//   (PUT = remplacement complet des 9 blocs, sémantique de l'API);
// - indicateur de version visible en permanence + historique des révisions;
// - aucun montant ici — le Canvas guide les hypothèses, il ne calcule rien
//   (docs/05 § Relations financières).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  CANVAS_BLOCKS,
  CANVAS_MAX_CARDS_PER_BLOCK,
  CANVAS_MAX_CARD_TEXT,
  type CanvasBlockId,
  type CanvasBlocks,
  type CanvasCard,
  type CanvasRevisionView,
} from '@/lib/api';

/** Libellés et question directrice de chaque bloc (docs/05 § Blocs). */
const BLOCK_META: Record<CanvasBlockId, { label: string; question: string }> = {
  partenaires_cles: {
    label: 'Partenaires clés',
    question: 'Qui sont vos fournisseurs et alliés indispensables ?',
  },
  activites_cles: {
    label: 'Activités clés',
    question: 'Que devez-vous faire pour délivrer votre promesse ?',
  },
  ressources_cles: {
    label: 'Ressources clés',
    question: 'De quoi avez-vous besoin : équipe, matériel, licences ?',
  },
  proposition_valeur: {
    label: 'Propositions de valeur',
    question: 'Quel problème résolvez-vous, pour qui, et mieux que qui ?',
  },
  relations_clients: {
    label: 'Relations clients',
    question: 'Comment gagnez-vous puis fidélisez-vous chaque segment ?',
  },
  canaux: { label: 'Canaux', question: 'Par où passez-vous pour vendre et livrer ?' },
  segments_clients: {
    label: 'Segments de clients',
    question: 'À qui vendez-vous, précisément ?',
  },
  couts: { label: 'Structure des coûts', question: 'Qu’est-ce qui coûte le plus cher ?' },
  revenus: { label: 'Sources de revenus', question: 'Qui paie quoi, à quelle fréquence ?' },
};

/**
 * Placement type « nappe » du BMC sur grand écran (grille de 10 colonnes) :
 * les 7 blocs du haut, puis coûts et revenus sur toute la largeur.
 * Classes écrites en entier — Tailwind ne scanne pas les chaînes construites.
 */
const BLOCK_LAYOUT: Record<CanvasBlockId, string> = {
  partenaires_cles: 'xl:col-start-1 xl:col-span-2 xl:row-start-1 xl:row-span-2',
  activites_cles: 'xl:col-start-3 xl:col-span-2 xl:row-start-1',
  ressources_cles: 'xl:col-start-3 xl:col-span-2 xl:row-start-2',
  proposition_valeur: 'xl:col-start-5 xl:col-span-2 xl:row-start-1 xl:row-span-2',
  relations_clients: 'xl:col-start-7 xl:col-span-2 xl:row-start-1',
  canaux: 'xl:col-start-7 xl:col-span-2 xl:row-start-2',
  segments_clients: 'xl:col-start-9 xl:col-span-2 xl:row-start-1 xl:row-span-2',
  couts: 'xl:col-start-1 xl:col-span-5 xl:row-start-3',
  revenus: 'xl:col-start-6 xl:col-span-5 xl:row-start-3',
};

/** Ordre de rendu (= ordre de tabulation clavier), lecture de gauche à droite. */
const RENDER_ORDER: CanvasBlockId[] = [
  'partenaires_cles',
  'activites_cles',
  'ressources_cles',
  'proposition_valeur',
  'relations_clients',
  'canaux',
  'segments_clients',
  'couts',
  'revenus',
];

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string };

function emptyBlocks(): CanvasBlocks {
  const blocs = {} as CanvasBlocks;
  for (const b of CANVAS_BLOCKS) blocs[b] = [];
  return blocs;
}

function newCardId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Prépare le corps du PUT : cartes vides retirées (l'API exige un texte non
 * vide) et `ordre` renormalisé sur la position affichée.
 */
function sanitize(blocs: CanvasBlocks): CanvasBlocks {
  const out = emptyBlocks();
  for (const bloc of CANVAS_BLOCKS) {
    out[bloc] = blocs[bloc]
      .filter((c) => c.texte.trim().length > 0)
      .map((c, index) => ({ id: c.id, texte: c.texte.trim(), ordre: index }));
  }
  return out;
}

/** Comparaison structurelle — évite un PUT (et une révision) quand rien n'a bougé. */
function sameBlocks(a: CanvasBlocks, b: CanvasBlocks): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function CanvasBoard({ projectId }: { projectId: string }): React.ReactElement {
  const [blocs, setBlocs] = useState<CanvasBlocks>(emptyBlocks);
  const [version, setVersion] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<CanvasRevisionView[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  /** Dernier état CONFIRMÉ par le serveur. */
  const persisted = useRef<CanvasBlocks>(emptyBlocks());
  /**
   * Dernier état qu'on a DÉCIDÉ d'écrire (en vol ou en file d'attente).
   *
   * C'est lui — et non `persisted` — qui sert de base à la déduplication.
   * Comparer à `persisted` pendant qu'un PUT est en vol perd des écritures :
   * ajouter une carte (PUT en vol) puis la supprimer donne un état identique à
   * `persisted`, la suppression était donc ignorée… alors que le serveur, lui,
   * allait recevoir la carte. L'UI affichait « Enregistré » sur un état que le
   * serveur n'avait pas.
   */
  const intended = useRef<CanvasBlocks>(emptyBlocks());
  /** Id de la carte à focaliser après le prochain rendu (ajout de carte). */
  const focusCardId = useRef<string | null>(null);
  /** Sentinelle : un PUT est en vol. Empêche deux écritures concurrentes. */
  const inFlight = useRef(false);
  /** File d'attente d'UN seul élément — seul le dernier état voulu compte. */
  const queued = useRef<CanvasBlocks | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const canvas = await api.getCanvas(projectId);
        if (cancelled) return;
        setBlocs(canvas.blocs);
        persisted.current = canvas.blocs;
        intended.current = canvas.blocs;
        setVersion(canvas.version);
        setUpdatedAt(canvas.updatedAt);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Impossible de charger le canvas');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!focusCardId.current) return;
    const el = document.getElementById(`canvas-card-${focusCardId.current}`);
    focusCardId.current = null;
    if (el instanceof HTMLTextAreaElement) el.focus();
  }, [blocs]);

  /**
   * Auto-save au blur — no-op si le contenu utile est inchangé.
   *
   * Sérialisation stricte (revue CTO S18d, I2) : un seul PUT en vol à la fois.
   * Sans cette garde, `persisted.current` n'étant mis à jour qu'au retour de la
   * réponse, deux blurs rapprochés — ou le blur suivi du clic sur ✕, qui portent
   * deux charges différentes — partaient en parallèle et pouvaient s'écraser
   * l'un l'autre. Les demandes émises pendant un vol sont réduites à une seule :
   * seul le dernier état voulu compte, les intermédiaires n'ont aucune valeur.
   *
   * On NE réinjecte PAS la réponse serveur dans `blocs` (I3) : la frappe en
   * cours dans une autre carte serait écrasée par la version renvoyée. L'état
   * local reste la vérité de l'édition ; le serveur ne pilote que `version`,
   * `updatedAt` et la référence de comparaison.
   */
  const persist = useCallback(
    async (next: CanvasBlocks): Promise<void> => {
      const payload = sanitize(next);
      // Déduplication contre l'état VOULU (cf. `intended`), pas contre l'état
      // confirmé : sinon une modification annulant un PUT encore en vol est
      // silencieusement ignorée, et le serveur garde l'état intermédiaire.
      if (sameBlocks(payload, intended.current)) return;
      intended.current = payload;

      if (inFlight.current) {
        queued.current = payload;
        return;
      }

      inFlight.current = true;
      setSave({ kind: 'saving' });
      try {
        let toSend: CanvasBlocks | null = payload;
        let lastAt = new Date().toISOString();
        while (toSend) {
          const canvas = await api.putCanvas(projectId, toSend);
          persisted.current = canvas.blocs;
          lastAt = canvas.updatedAt ?? lastAt;
          setVersion(canvas.version);
          setUpdatedAt(canvas.updatedAt);
          // Déjà dédupliqué à l'entrée : ce qui est en file diffère forcément.
          toSend = queued.current;
          queued.current = null;
        }
        setSave({ kind: 'saved', at: lastAt });
        // L'historique affiché devient obsolète dès qu'une révision est créée.
        setRevisions(null);
      } catch (err) {
        // Écriture abandonnée : on réaligne `intended` sur le dernier état
        // confirmé, sinon un nouvel essai au contenu identique serait dédupliqué
        // et l'utilisateur resterait bloqué sur « non enregistré ».
        queued.current = null;
        intended.current = persisted.current;
        setSave({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Enregistrement impossible',
        });
      } finally {
        inFlight.current = false;
      }
    },
    [projectId],
  );

  function updateCard(bloc: CanvasBlockId, cardId: string, texte: string): void {
    setBlocs((prev) => ({
      ...prev,
      [bloc]: prev[bloc].map((c) => (c.id === cardId ? { ...c, texte } : c)),
    }));
  }

  function addCard(bloc: CanvasBlockId): void {
    const id = newCardId();
    focusCardId.current = id;
    setBlocs((prev) => ({
      ...prev,
      [bloc]: [...prev[bloc], { id, texte: '', ordre: prev[bloc].length }],
    }));
  }

  // `persist` n'est JAMAIS appelé depuis un updater `setBlocs` : React
  // ré-invoque les updaters (StrictMode en dev, rendu concurrent) et chaque
  // ré-invocation déclencherait un PUT — donc une révision — en double.
  // L'état suivant est calculé ici, à partir de `blocs` du rendu courant.

  function removeCard(bloc: CanvasBlockId, cardId: string): void {
    const next = { ...blocs, [bloc]: blocs[bloc].filter((c) => c.id !== cardId) };
    setBlocs(next);
    void persist(next);
  }

  /**
   * Blur d'une carte : une carte laissée vide est retirée (pas d'écriture),
   * sinon on tente l'enregistrement.
   */
  function handleBlur(bloc: CanvasBlockId, cardId: string): void {
    const card = blocs[bloc].find((c) => c.id === cardId);
    const next =
      card && card.texte.trim().length === 0
        ? { ...blocs, [bloc]: blocs[bloc].filter((c) => c.id !== cardId) }
        : blocs;
    if (next !== blocs) setBlocs(next);
    void persist(next);
  }

  async function toggleHistory(): Promise<void> {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (!opening || revisions !== null) return;
    try {
      const { revisions: list } = await api.listCanvasRevisions(projectId);
      setRevisions(list);
    } catch {
      setRevisions([]);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement du canvas…</p>;
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
        <strong>Erreur :</strong> {loadError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-bold tracking-tight">Business Model Canvas</h2>
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
            Les neuf blocs de votre modèle. Le canvas guide vos hypothèses — il ne produit aucun
            montant : les chiffres restent ceux du plan financier.
          </p>
        </div>
        <VersionIndicator
          version={version}
          updatedAt={updatedAt}
          save={save}
          historyOpen={historyOpen}
          onToggleHistory={() => void toggleHistory()}
        />
      </header>

      {historyOpen ? <RevisionsList revisions={revisions} /> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-10">
        {RENDER_ORDER.map((bloc) => (
          <BlockCard
            key={bloc}
            bloc={bloc}
            cards={blocs[bloc]}
            onAdd={() => addCard(bloc)}
            onChange={(cardId, texte) => updateCard(bloc, cardId, texte)}
            onBlur={(cardId) => handleBlur(bloc, cardId)}
            onRemove={(cardId) => removeCard(bloc, cardId)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Indicateur de version ───────────────────────────────────

function VersionIndicator({
  version,
  updatedAt,
  save,
  historyOpen,
  onToggleHistory,
}: {
  version: number | null;
  updatedAt: string | null;
  save: SaveState;
  historyOpen: boolean;
  onToggleHistory: () => void;
}): React.ReactElement {
  const label = version === null || version === 0 ? 'Jamais enregistré' : `Version ${version}`;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="fig rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold">
          {label}
        </span>
        {version !== null && version > 0 ? (
          <button
            type="button"
            onClick={onToggleHistory}
            aria-expanded={historyOpen}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs transition hover:bg-[var(--surface-muted)]"
          >
            {historyOpen ? 'Masquer l’historique' : 'Historique'}
          </button>
        ) : null}
      </div>
      <span
        aria-live="polite"
        className={
          save.kind === 'error'
            ? 'text-xs text-[var(--danger)]'
            : 'text-xs text-[var(--foreground-muted)]'
        }
      >
        {save.kind === 'saving'
          ? 'Enregistrement…'
          : save.kind === 'error'
            ? `Non enregistré — ${save.message}`
            : save.kind === 'saved'
              ? `Enregistré à ${new Date(save.at).toLocaleTimeString('fr-FR')}`
              : updatedAt
                ? `Dernière écriture le ${new Date(updatedAt).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}`
                : 'Modifications enregistrées automatiquement'}
      </span>
    </div>
  );
}

function RevisionsList({
  revisions,
}: {
  revisions: CanvasRevisionView[] | null;
}): React.ReactElement {
  if (revisions === null) {
    return <p className="text-xs text-[var(--foreground-muted)]">Chargement de l’historique…</p>;
  }
  if (revisions.length === 0) {
    return <p className="text-xs text-[var(--foreground-muted)]">Aucune révision enregistrée.</p>;
  }
  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <h3 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
        Historique — {revisions.length} dernière{revisions.length > 1 ? 's' : ''} révision
        {revisions.length > 1 ? 's' : ''} (20 max)
      </h3>
      <ul className="mt-2 flex flex-col gap-1">
        {revisions.map((r) => (
          <li key={r.version} className="flex items-baseline gap-3 text-xs">
            <span className="fig font-semibold">v{r.version}</span>
            <span className="text-[var(--foreground-muted)]">
              {new Date(r.savedAt).toLocaleString('fr-FR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Bloc du canvas ──────────────────────────────────────────

function BlockCard({
  bloc,
  cards,
  onAdd,
  onChange,
  onBlur,
  onRemove,
}: {
  bloc: CanvasBlockId;
  cards: CanvasCard[];
  onAdd: () => void;
  onChange: (cardId: string, texte: string) => void;
  onBlur: (cardId: string) => void;
  onRemove: (cardId: string) => void;
}): React.ReactElement {
  const meta = BLOCK_META[bloc];
  const full = cards.length >= CANVAS_MAX_CARDS_PER_BLOCK;

  return (
    <section
      aria-labelledby={`canvas-bloc-${bloc}`}
      className={`doc-card flex flex-col gap-2 p-3 ${BLOCK_LAYOUT[bloc]}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3
          id={`canvas-bloc-${bloc}`}
          className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#6c685a]"
        >
          {meta.label}
        </h3>
        <span className="fig text-[0.65rem] text-[#6c685a]">
          {cards.length}/{CANVAS_MAX_CARDS_PER_BLOCK}
        </span>
      </header>

      {cards.length === 0 ? (
        <p className="text-xs italic leading-snug text-[#6c685a]">{meta.question}</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {cards.map((card) => (
          <li key={card.id} className="group relative">
            <textarea
              id={`canvas-card-${card.id}`}
              value={card.texte}
              rows={2}
              maxLength={CANVAS_MAX_CARD_TEXT}
              aria-label={`Carte du bloc ${meta.label}`}
              placeholder="Décrivez en une phrase…"
              onChange={(e) => onChange(card.id, e.target.value)}
              onBlur={() => onBlur(card.id)}
              className="w-full resize-y rounded-md border border-[#d6cdb9] bg-white/70 px-2.5 py-2 pr-7 text-sm leading-snug text-[#14191b] outline-none transition placeholder:text-[#9e947e] focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => onRemove(card.id)}
              aria-label="Supprimer cette carte"
              title="Supprimer cette carte"
              className="absolute right-1.5 top-1.5 rounded px-1 text-xs leading-none text-[#9e947e] opacity-0 transition hover:text-[var(--danger)] focus-visible:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onAdd}
        disabled={full}
        title={full ? `Maximum ${CANVAS_MAX_CARDS_PER_BLOCK} cartes par bloc` : undefined}
        className="self-start rounded-md border border-dashed border-[#b4a98f] px-2 py-1 text-xs text-[#6c685a] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Ajouter une carte
      </button>
    </section>
  );
}

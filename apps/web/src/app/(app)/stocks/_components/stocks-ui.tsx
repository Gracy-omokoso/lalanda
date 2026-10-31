'use client';

// Briques visuelles des stocks (ADR-0046, lot S8) : reprennent celles du CRM, des
// achats et des RH (bandeaux teintés, panneaux, tuiles), plus la phrase d'une route
// pas encore livrée (404, jamais de donnée inventée), les choix d'article et
// d'emplacement, et un champ de quantité qui sélectionne son contenu au focus
// (leçon de R3 : un nombre prérempli se remplace d'un geste, au téléphone aussi).

import { useEffect, useState } from 'react';

import { stockApi, type StockItemView, type StockLocationView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_TYPE_EMPLACEMENT,
  PHRASE_PAS_ENCORE,
  messageStocks,
  statutDe,
} from './stocks-model';

export { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';

/** Échec d'une lecture : la phrase « pas encore disponible » (404), sinon le message. */
export function EchecLecture({
  erreur,
  repli,
  onReessayer,
}: {
  erreur: unknown;
  repli: string;
  onReessayer?: () => void;
}): React.ReactElement {
  if (statutDe(erreur) === 404) return <CarteVide>{PHRASE_PAS_ENCORE}</CarteVide>;
  return (
    <Alerte
      action={
        onReessayer ? (
          <button type="button" className={BOUTON_PETIT} onClick={onReessayer}>
            Réessayer
          </button>
        ) : undefined
      }
    >
      <p>{messageStocks(erreur, repli)}</p>
    </Alerte>
  );
}

export function Chargement({ texte = 'Chargement…' }: { texte?: string }): React.ReactElement {
  return (
    <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
      {texte}
    </p>
  );
}

/** Encadré pointillé d'une liste vide ou d'un écran indisponible. */
export function CarteVide({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
      {children}
    </p>
  );
}

/** Classes d'une carte entièrement cliquable (lien ou bouton). */
export const CARTE =
  'flex h-full w-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]';

/**
 * Champ décimal : clavier numérique au téléphone, contenu sélectionné au focus
 * (une valeur préremplie se remplace sans l'effacer chiffre par chiffre).
 */
export function ChampNombre(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> & {
    grand?: boolean;
  },
): React.ReactElement {
  const { grand, className, onFocus, ...reste } = props;
  return (
    <input
      {...reste}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`${CHAMP} tabular-nums ${grand ? 'py-3 text-lg' : ''} ${className ?? ''}`}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
    />
  );
}

/** Choix d'un emplacement actif (liste du contexte). */
export function ChoixEmplacement({
  id,
  valeur,
  onChange,
  vide,
  exclure,
  aria,
}: {
  id: string;
  valeur: string;
  onChange: (id: string) => void;
  /** Libellé de l'option vide ; absent : pas d'option vide. */
  vide?: string;
  exclure?: string;
  aria?: Record<string, unknown>;
}): React.ReactElement {
  const { emplacements } = useAccesStocks();
  const liste: StockLocationView[] = emplacements?.ok ? emplacements.valeur : [];
  return (
    <select
      id={id}
      className={CHAMP}
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      {...aria}
    >
      {vide !== undefined ? <option value="">{vide}</option> : null}
      {liste
        .filter((l) => l.id !== exclure)
        .map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} — {LIBELLES_TYPE_EMPLACEMENT[l.kind]}
            {l.isDefault ? ' (par défaut)' : ''}
          </option>
        ))}
    </select>
  );
}

/**
 * Choix d'un article actif par recherche (`GET /stock/items?q=`). Rend l'article
 * choisi entier (nom et unité, pour l'affichage) ; seul son identifiant part à l'API.
 */
export function ChoixArticle({
  id,
  valeur,
  onChange,
  nomInitial,
  aria,
}: {
  id: string;
  valeur: string;
  onChange: (article: StockItemView | null) => void;
  nomInitial?: string | null;
  aria?: Record<string, unknown>;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [liste, setListe] = useState<StockItemView[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      stockApi
        .listItems({ active: 'true', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (annule) return;
          setListe(p.items);
          setErreur(null);
        })
        .catch((err: unknown) => {
          if (!annule) setErreur(messageStocks(err, 'Articles illisibles.'));
        });
    }, 200);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="search"
        aria-label="Rechercher un article"
        placeholder="Rechercher un article (nom ou code)…"
        className={CHAMP}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        id={id}
        className={CHAMP}
        value={valeur}
        onChange={(e) => onChange(liste.find((s) => s.id === e.target.value) ?? null)}
        {...aria}
      >
        <option value="">Choisir un article</option>
        {valeur !== '' && !liste.some((s) => s.id === valeur) ? (
          <option value={valeur}>{nomInitial ?? 'Article choisi'}</option>
        ) : null}
        {liste.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code ? `${s.code} — ` : ''}
            {s.name} ({s.unit})
          </option>
        ))}
      </select>
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </div>
  );
}

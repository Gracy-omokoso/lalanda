'use client';

// Briques visuelles des stocks (ADR-0046, lot S8) : reprennent celles du CRM, des
// achats et des RH (bandeaux teintés, panneaux, tuiles), plus la phrase d'une route
// pas encore livrée (404, jamais de donnée inventée), les choix d'article et
// d'emplacement, et un champ de quantité qui sélectionne son contenu au focus
// (leçon de R3 : un nombre prérempli se remplace d'un geste, au téléphone aussi).

import { EntityPicker, Select, TextInput, cn, type SelectOption } from '@lalanda/ui';
import { useCallback, useState } from 'react';

import { stockApi, type StockItemView, type StockLocationView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { ArticleFormulaire } from './article-formulaire';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_TYPE_EMPLACEMENT,
  PHRASE_PAS_ENCORE,
  messageStocks,
  peutGererStocks,
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
 * (une valeur préremplie se remplace sans l'effacer chiffre par chiffre). Relié
 * à son `Field` (ADR-0074) : identifiant, aide et erreur viennent du contexte.
 */
export function ChampNombre(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> & {
    grand?: boolean;
  },
): React.ReactElement {
  const { grand, className, onFocus, ...reste } = props;
  return (
    <TextInput
      {...reste}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('tabular-nums', grand && 'h-12 text-lg max-sm:h-12', className)}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
    />
  );
}

/** Choix d'un emplacement actif (liste du contexte), en `Select` (ADR-0074 § 3). */
export function ChoixEmplacement({
  id,
  valeur,
  onChange,
  vide,
  exclure,
  ariaLabel,
}: {
  /** Identifiant ; sinon celui du `Field` englobant. */
  id?: string;
  valeur: string;
  onChange: (id: string) => void;
  /** Libellé de l'option vide ; absent : pas d'option vide. */
  vide?: string;
  exclure?: string;
  /** Nom accessible hors `Field` (filtre sans libellé visible). */
  ariaLabel?: string;
}): React.ReactElement {
  const { emplacements } = useAccesStocks();
  const liste: StockLocationView[] = emplacements?.ok ? emplacements.valeur : [];
  const options: SelectOption[] = [
    ...(vide !== undefined ? [{ value: '', label: vide }] : []),
    ...liste
      .filter((l) => l.id !== exclure)
      .map((l) => ({
        value: l.id,
        label: `${l.name}${l.isDefault ? ' (par défaut)' : ''}`,
        description: LIBELLES_TYPE_EMPLACEMENT[l.kind],
      })),
  ];
  return (
    <Select
      {...(id !== undefined ? { id } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      value={valeur}
      onChange={onChange}
      options={options}
      placeholder="Choisir un emplacement"
      loading={emplacements === null}
      emptyText="Aucun emplacement actif."
    />
  );
}

/** Article tel que le sélecteur le connaît : la fiche lue, ou son seul identifiant. */
type ArticleChoisi = Pick<StockItemView, 'id' | 'name'> &
  Partial<Pick<StockItemView, 'code' | 'unit'>>;

/**
 * Choix d'un article actif par recherche (`GET /stock/items?active=true&limit=50&q=`,
 * la même qu'avant), en `EntityPicker` (ADR-0074 § 4). Rend l'article choisi
 * entier (nom et unité, pour l'affichage) ; seul son identifiant part à l'API.
 * `creer` : « + » qui ouvre la fiche article complète en fenêtre, seulement avec
 * `stock.manage` (le droit de `POST /stock/items` ; l'API reste juge).
 */
export function ChoixArticle({
  id,
  valeur,
  onChange,
  nomInitial,
  creer = false,
}: {
  /** Identifiant ; sinon celui du `Field` englobant. */
  id?: string;
  valeur: string;
  onChange: (article: StockItemView | null) => void;
  nomInitial?: string | null;
  /** Propose la création rapide (avec `stock.manage`). */
  creer?: boolean;
}): React.ReactElement {
  const { actions } = useAccesStocks();
  const peutCreer = creer && actions !== null && peutGererStocks(actions);
  const [choisi, setChoisi] = useState<ArticleChoisi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Un identifiant reçu sans fiche (préremplissage) garde le nom connu.
  const affiche: ArticleChoisi | null =
    valeur === ''
      ? null
      : choisi?.id === valeur
        ? choisi
        : { id: valeur, name: nomInitial ?? 'Article choisi' };

  const chercher = useCallback(async (q: string): Promise<StockItemView[]> => {
    try {
      const p = await stockApi.listItems({ active: 'true', limit: 50, ...(q ? { q } : {}) });
      setErreur(null);
      return p.items;
    } catch (err) {
      setErreur(messageStocks(err, 'Articles illisibles.'));
      throw err;
    }
  }, []);

  function choisir(a: ArticleChoisi | null): void {
    setChoisi(a);
    // La liste et la création rendent des fiches complètes.
    onChange(a as StockItemView | null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <EntityPicker<ArticleChoisi>
        {...(id !== undefined ? { id } : {})}
        value={affiche}
        onChange={choisir}
        search={chercher}
        getKey={(a) => a.id}
        getLabel={(a) => a.name}
        getDescription={(a) =>
          [a.code, a.unit ? `unité : ${a.unit}` : null].filter(Boolean).join(' · ') || null
        }
        placeholder="Nom ou code de l’article"
        recentKey="stocks.articles"
        emptyText="Aucun article actif ne correspond."
        debounceMs={200}
        createTitle="Nouvel article"
        createButtonLabel="Créer un article"
        createSize="lg"
        {...(peutCreer
          ? {
              createForm: ({ initialText, onCreated }) => (
                <ArticleFormulaire
                  article={null}
                  nomInitial={initialText}
                  onEnregistre={onCreated}
                />
              ),
            }
          : {})}
      />
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </div>
  );
}

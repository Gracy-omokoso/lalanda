// Sélecteur d'entité « tape pour chercher, ou crée » (ADR-0074 § 4).
//
// Pour toute donnée susceptible d'exister déjà (client, article, service,
// manager…) : on tape quelques lettres, la liste propose les fiches qui
// correspondent (recherche asynchrone, anti-rebond, correspondance surlignée,
// sous-texte comme le NIF ou le matricule). Si rien ne convient, le bouton
// « + » (ou la dernière option « Créer « … » ») ouvre une fenêtre de création
// rapide PRÉ-REMPLIE avec le texte tapé ; la fiche créée est choisie d'office
// et le formulaire principal garde sa saisie.
//
// Modèle WAI-ARIA « combobox » éditable avec liste (`aria-autocomplete="list"`).
// Les « récents » ne vivent qu'en mémoire, le temps de la session : des noms
// de clients n'ont rien à faire dans le stockage du navigateur.

import { Loader2, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../utils.js';
import { Modal, type ModalSize } from '../components/modal.js';

import { CONTROL_CLASSES, controlA11y, useField } from './field.js';
import { ajouterRecent, idSur, prochainIndex } from './logic.js';
import { ListboxMessage, ListboxOption, Popover, Surligne, VoileTelephone } from './listbox.js';
import { useAncrage, useAppuiExterieur, useEstTelephone } from './popover.js';

/** Récents par liste (`recentKey`), en mémoire seulement. */
const RECENTS = new Map<string, unknown[]>();

export interface EntityCreateFormProps<T> {
  /** Texte tapé dans le champ : à reprendre comme nom de la nouvelle fiche. */
  initialText: string;
  /** Fiche enregistrée : elle est choisie et la fenêtre se ferme. */
  onCreated: (item: T) => void;
  onCancel: () => void;
}

export interface EntityPickerProps<T> {
  value: T | null;
  onChange: (item: T | null) => void;
  /** Recherche (anti-rebond appliqué) ; `signal` annule une recherche dépassée. */
  search: (query: string, signal: AbortSignal) => Promise<readonly T[]>;
  /**
   * À changer quand la source de la recherche change (liste locale chargée,
   * fiche ajoutée) : la recherche ouverte est relancée.
   */
  refreshKey?: string | number;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** Sous-texte (NIF, matricule, service…). */
  getDescription?: (item: T) => string | null | undefined;
  /** Rendu libre d'une option ; reçoit le libellé déjà surligné. */
  renderItem?: (item: T, parts: { label: React.ReactNode; query: string }) => React.ReactNode;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Lettres avant de chercher ; 0 : liste proposée dès le focus. Défaut 0. */
  minChars?: number;
  debounceMs?: number;
  /** Clé des récents (ex. `clients`) ; sans clé, pas de récents. */
  recentKey?: string;
  maxRecents?: number;
  emptyText?: string;
  /** Formulaire de création rapide ; sans lui, ni « + » ni option « Créer ». */
  createForm?: (props: EntityCreateFormProps<T>) => React.ReactNode;
  /** Titre de la fenêtre de création (ex. « Nouveau client »). */
  createTitle?: string;
  /** Libellé accessible du bouton « + » (ex. « Créer un client »). */
  createButtonLabel?: string;
  createOptionLabel?: (query: string) => string;
  createSize?: ModalSize;
  /** Permet d'effacer le choix (bouton ×). Défaut oui. */
  clearable?: boolean;
  onBlur?: () => void;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

type Ligne<T> = { genre: 'item'; item: T; recent: boolean } | { genre: 'creer' };

export function EntityPicker<T>({
  value,
  onChange,
  search,
  getKey,
  getLabel,
  getDescription,
  renderItem,
  refreshKey: rechercheVersion = 0,
  id: idDonne,
  placeholder = 'Tapez pour rechercher…',
  disabled,
  required,
  minChars = 0,
  debounceMs = 250,
  recentKey,
  maxRecents = 5,
  emptyText = 'Aucune fiche ne correspond.',
  createForm,
  createTitle = 'Création rapide',
  createButtonLabel = 'Créer une nouvelle fiche',
  createOptionLabel = (q) => (q.trim() ? `Créer « ${q.trim()} »` : 'Créer une nouvelle fiche'),
  createSize = 'md',
  clearable = true,
  onBlur,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: EntityPickerProps<T>): React.ReactElement {
  const ctx = useField();
  const base = idSur(useId(), 'ent');
  const a11y = controlA11y(ctx, {
    id: idDonne,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    required,
    disabled,
  });
  const idChamp = a11y.id ?? base;
  const idListe = `${base}-liste`;
  const idOption = (i: number): string => `${base}-o${i}`;
  const idChoix = `${base}-choix`;

  // Fonctions passées en ligne par les écrans : lues par référence, pour ne
  // relancer ni la recherche ni la liste à chaque rendu.
  const fonctions = useRef({ search, getKey });
  fonctions.current = { search, getKey };

  const libelleChoisi = value ? getLabel(value) : '';
  const [texte, setTexte] = useState(libelleChoisi);
  const [edition, setEdition] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const [resultats, setResultats] = useState<readonly T[]>([]);
  const [chargement, setChargement] = useState(false);
  const [echec, setEchec] = useState(false);
  const [actif, setActif] = useState(-1);
  const [creation, setCreation] = useState<string | null>(null);
  const [recents, setRecents] = useState<readonly T[]>(
    () => (recentKey ? (RECENTS.get(recentKey) as T[] | undefined) : undefined) ?? [],
  );
  const enveloppe = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  // Focus rendu après la fenêtre de création : il ne rouvre pas la liste.
  const focusSilencieux = useRef(false);
  const tel = useEstTelephone();
  const style = useAncrage(ouvert && !tel, enveloppe);

  // Le libellé suit la valeur tant qu'on n'est pas en train de taper.
  useEffect(() => {
    if (!edition) setTexte(libelleChoisi);
  }, [libelleChoisi, edition]);

  const requete = edition ? texte : '';
  const avecCreation = Boolean(createForm);
  const assezDeLettres = requete.trim().length >= minChars;

  // Recherche avec anti-rebond ; la précédente est annulée.
  useEffect(() => {
    if (!ouvert || !assezDeLettres) {
      setResultats([]);
      setChargement(false);
      return;
    }
    const ctrl = new AbortController();
    setChargement(true);
    setEchec(false);
    const t = setTimeout(() => {
      fonctions.current
        .search(requete.trim(), ctrl.signal)
        .then((r) => {
          if (!ctrl.signal.aborted) setResultats(r);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setEchec(true);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setChargement(false);
        });
    }, debounceMs);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [ouvert, requete, assezDeLettres, debounceMs, rechercheVersion]);

  const lignes = useMemo<Ligne<T>[]>(() => {
    const getKey = fonctions.current.getKey;
    const out: Ligne<T>[] = [];
    const vus = new Set<string>();
    if (requete.trim() === '' && recents.length > 0) {
      for (const r of recents) {
        vus.add(getKey(r));
        out.push({ genre: 'item', item: r, recent: true });
      }
    }
    for (const r of resultats) {
      if (vus.has(getKey(r))) continue;
      out.push({ genre: 'item', item: r, recent: false });
    }
    if (avecCreation) out.push({ genre: 'creer' });
    return out;
  }, [requete, recents, resultats, avecCreation]);
  const actives = useMemo(() => lignes.map(() => true), [lignes]);

  // Une nouvelle liste : la première fiche active (jamais « Créer » d'office).
  useEffect(() => {
    setActif(lignes.length > 0 && lignes[0]!.genre === 'item' ? 0 : -1);
  }, [lignes]);

  useEffect(() => {
    if (!ouvert || actif < 0) return;
    document.getElementById(idOption(actif))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, actif]);

  const abandonner = useCallback(() => {
    setOuvert(false);
    setEdition(false);
  }, []);
  useAppuiExterieur(ouvert, [enveloppe], abandonner);

  function choisir(item: T | null): void {
    onChange(item);
    if (item && recentKey) {
      const suite = ajouterRecent(recents, item, getKey, maxRecents);
      RECENTS.set(recentKey, suite);
      setRecents(suite);
    }
    setTexte(item ? getLabel(item) : '');
    setEdition(false);
    setOuvert(false);
  }

  function rendreFocus(): void {
    setTimeout(() => {
      focusSilencieux.current = true;
      champ.current?.focus();
    }, 0);
  }

  function ouvrirCreation(): void {
    setCreation(edition ? texte.trim() : '');
    setOuvert(false);
  }

  function surTouche(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' && !ouvert) {
      e.preventDefault();
      setOuvert(true);
      return;
    }
    if (!ouvert) {
      if (e.key === 'Escape' && edition) {
        e.preventDefault();
        e.stopPropagation();
        abandonner();
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(e.key)) {
      const s = prochainIndex(actives, actif, e.key);
      if (s !== null) {
        e.preventDefault();
        setActif(s);
      }
      return;
    }
    if (e.key === 'Enter') {
      const l = lignes[actif];
      if (!l) return;
      // Sinon l'Entrée soumettrait le formulaire principal.
      e.preventDefault();
      if (l.genre === 'creer') ouvrirCreation();
      else choisir(l.item);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      abandonner();
      return;
    }
    if (e.key === 'Tab') abandonner();
  }

  const description = value && getDescription ? getDescription(value) : null;
  let indexItem = -1;

  return (
    <div
      ref={enveloppe}
      className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        if (enveloppe.current?.contains(e.relatedTarget as Node | null)) return;
        abandonner();
        onBlur?.();
      }}
    >
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={champ}
            id={idChamp}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={ouvert}
            aria-controls={ouvert ? idListe : undefined}
            aria-activedescendant={ouvert && actif >= 0 ? idOption(actif) : undefined}
            aria-label={ariaLabel}
            aria-describedby={
              [a11y['aria-describedby'], description ? idChoix : null].filter(Boolean).join(' ') ||
              undefined
            }
            aria-invalid={a11y['aria-invalid']}
            aria-required={a11y['aria-required']}
            disabled={a11y.disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={texte}
            onFocus={() => {
              if (focusSilencieux.current) {
                focusSilencieux.current = false;
                return;
              }
              if (!a11y.disabled) setOuvert(true);
            }}
            onClick={() => {
              if (!a11y.disabled) setOuvert(true);
            }}
            onChange={(e) => {
              setTexte(e.target.value);
              setEdition(true);
              setOuvert(true);
            }}
            onKeyDown={surTouche}
            className={cn(
              CONTROL_CLASSES,
              value && clearable && !a11y.disabled ? 'pr-16' : 'pr-9',
              value && !edition ? 'font-medium' : null,
            )}
          />
          <span className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            {chargement && ouvert ? (
              <Loader2
                aria-hidden="true"
                className="h-4 w-4 animate-spin text-[var(--foreground-muted)] motion-reduce:animate-none"
              />
            ) : null}
            {value && clearable && !a11y.disabled ? (
              <button
                type="button"
                aria-label={`Effacer le choix « ${libelleChoisi} »`}
                onClick={() => {
                  choisir(null);
                  champ.current?.focus();
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] max-sm:h-10 max-sm:w-10"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </span>
        </div>
        {createForm ? (
          <button
            type="button"
            aria-label={createButtonLabel}
            title={createButtonLabel}
            disabled={a11y.disabled}
            onClick={ouvrirCreation}
            className="inline-flex h-[var(--control-h)] w-[var(--control-h)] shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60 max-sm:h-11 max-sm:w-11"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {description ? (
        <p id={idChoix} className="mt-1 truncate text-xs text-[var(--foreground-muted)]">
          {description}
        </p>
      ) : null}

      {ouvert ? (
        <>
          {tel ? <VoileTelephone onFermer={abandonner} /> : null}
          <Popover style={style}>
            <div
              id={idListe}
              role="listbox"
              aria-labelledby={ctx && !ariaLabel ? ctx.labelId : undefined}
              aria-label={ariaLabel}
              aria-busy={chargement || undefined}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
            >
              {!assezDeLettres ? (
                <ListboxMessage>
                  Tapez au moins {minChars} lettre{minChars > 1 ? 's' : ''}.
                </ListboxMessage>
              ) : null}
              {echec ? (
                <ListboxMessage>La recherche n’a pas abouti. Réessayez.</ListboxMessage>
              ) : null}
              {assezDeLettres && chargement && resultats.length === 0 ? (
                <ListboxMessage>Recherche…</ListboxMessage>
              ) : null}
              {assezDeLettres &&
              !chargement &&
              !echec &&
              resultats.length === 0 &&
              !(requete.trim() === '' && recents.length > 0) ? (
                <ListboxMessage>{emptyText}</ListboxMessage>
              ) : null}
              {lignes.map((l, i) => {
                if (l.genre === 'creer') {
                  return (
                    <ListboxOption
                      key="creer"
                      id={idOption(i)}
                      actif={i === actif}
                      selectionne={false}
                      coche={false}
                      onChoisir={ouvrirCreation}
                      onSurvol={() => setActif(i)}
                      className="mt-1 border-t border-[var(--border)] pt-2.5 font-medium text-[var(--accent)]"
                    >
                      <span className="flex items-center gap-2">
                        <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
                        {createOptionLabel(requete)}
                      </span>
                    </ListboxOption>
                  );
                }
                indexItem += 1;
                const label = <Surligne texte={getLabel(l.item)} requete={requete} />;
                const desc = getDescription?.(l.item);
                const premierRecent = l.recent && indexItem === 0;
                return (
                  <div key={`${l.recent ? 'r' : 'i'}-${getKey(l.item)}`} role="presentation">
                    {premierRecent ? (
                      <div
                        role="presentation"
                        className="px-3 pb-1 pt-1.5 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]"
                      >
                        Récents
                      </div>
                    ) : null}
                    <ListboxOption
                      id={idOption(i)}
                      actif={i === actif}
                      selectionne={value !== null && getKey(value) === getKey(l.item)}
                      onChoisir={() => choisir(l.item)}
                      onSurvol={() => setActif(i)}
                    >
                      {renderItem ? (
                        renderItem(l.item, { label, query: requete })
                      ) : (
                        <>
                          <span className="block truncate">{label}</span>
                          {desc ? (
                            <span className="block truncate text-xs text-[var(--foreground-muted)]">
                              {desc}
                            </span>
                          ) : null}
                        </>
                      )}
                    </ListboxOption>
                  </div>
                );
              })}
            </div>
          </Popover>
        </>
      ) : null}

      {createForm && creation !== null && typeof document !== 'undefined'
        ? createPortal(
            // La fenêtre est rendue hors du formulaire principal (pas de
            // `<form>` imbriqué) ; ses événements ne remontent pas jusqu'à lui
            // par l'arbre React (soumission, Échap, détection de saisie).
            <div
              onSubmit={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => e.stopPropagation()}
              onChange={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              // `cancel` (Échap d'un <dialog>) remonte l'arbre React : la
              // fenêtre principale ne doit pas le recevoir.
              {...({
                onCancel: (e: React.SyntheticEvent) => e.stopPropagation(),
              } as React.HTMLAttributes<HTMLDivElement>)}
              onFocus={(e) => e.stopPropagation()}
              onBlur={(e) => e.stopPropagation()}
            >
              <Modal
                open
                title={createTitle}
                size={createSize}
                onClose={() => {
                  setCreation(null);
                  rendreFocus();
                }}
              >
                {createForm({
                  initialText: creation,
                  onCreated: (item) => {
                    setCreation(null);
                    choisir(item);
                    rendreFocus();
                  },
                  onCancel: () => {
                    setCreation(null);
                    rendreFocus();
                  },
                })}
              </Modal>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

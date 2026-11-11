// Liste de choix stylée (ADR-0074 § 3) — remplace le `<select>` natif.
//
// Modèle WAI-ARIA « select-only combobox » : un bouton `role="combobox"` qui
// commande une `listbox` ; l'option active est désignée par
// `aria-activedescendant`, le focus ne quitte pas le champ. Dès 8 options, un
// champ de recherche s'ouvre en tête de liste (et prend le focus). Groupes
// (`role="group"`), options désactivées, description sous le libellé, états
// « Chargement… » et « Aucun résultat ».
//
// Le chevron a son propre espace : 40 px réservés à droite, chevron à 12 px du
// bord — le texte ne le touche jamais. La liste s'ouvre 6 px sous le champ ;
// sur téléphone, en feuille basse.

import { ChevronDown, Search } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { cn } from '../utils.js';

import { CONTROL_CLASSES, controlA11y, useField } from './field.js';
import {
  avecRecherche,
  correspondRecherche,
  idSur,
  indexParLettre,
  prochainIndex,
} from './logic.js';
import { ListboxMessage, ListboxOption, Popover, Surligne, VoileTelephone } from './listbox.js';
import { useAncrage, useAppuiExterieur, useEstTelephone } from './popover.js';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
  /** Libellé du groupe ; les options d'un même groupe doivent se suivre. */
  group?: string | undefined;
  /** Mots supplémentaires trouvés par la recherche (code, sigle…). */
  keywords?: string | undefined;
}

export interface SelectProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  /** Texte quand aucune option ne correspond à `value`. */
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  loading?: boolean;
  /** Message d'une liste vide (sans recherche). */
  emptyText?: string;
  /** Force (ou retire) le champ de recherche ; défaut : dès 8 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  onBlur?: () => void;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder = 'Choisir…',
  id: idDonne,
  name,
  disabled,
  required,
  loading = false,
  emptyText = 'Aucune option disponible.',
  searchable,
  searchPlaceholder = 'Rechercher…',
  className,
  onBlur,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SelectProps<V>): React.ReactElement {
  const ctx = useField();
  const base = idSur(useId(), 'sel');
  const a11y = controlA11y(ctx, {
    id: idDonne,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    required,
    disabled,
  });
  const idBouton = a11y.id ?? base;
  const idListe = `${base}-liste`;
  const idOption = (i: number): string => `${base}-o${i}`;

  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const [actif, setActif] = useState(-1);
  const enveloppe = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const recherche = useRef<HTMLInputElement>(null);
  const lettres = useRef<{ texte: string; t: ReturnType<typeof setTimeout> | null }>({
    texte: '',
    t: null,
  });
  const tel = useEstTelephone();
  const style = useAncrage(ouvert && !tel, bouton);
  const avecChamp = avecRecherche(options.length, searchable);

  const visibles = useMemo(
    () =>
      options.filter((o) => correspondRecherche([o.label, o.description, o.keywords, o.group], q)),
    [options, q],
  );
  const actives = useMemo(() => visibles.map((o) => !o.disabled), [visibles]);
  const courante = options.find((o) => o.value === value);

  const fermer = useCallback((rendreFocus = false) => {
    setOuvert(false);
    setQ('');
    if (rendreFocus) bouton.current?.focus();
  }, []);
  useAppuiExterieur(ouvert, [enveloppe], () => fermer());

  function ouvrir(): void {
    if (a11y.disabled) return;
    const i = visibles.findIndex((o) => o.value === value);
    setActif(i >= 0 ? i : actives.indexOf(true));
    setOuvert(true);
  }

  function choisir(o: SelectOption<V>): void {
    if (o.disabled) return;
    if (o.value !== value) onChange(o.value);
    fermer(true);
  }

  useEffect(() => {
    if (ouvert && avecChamp) recherche.current?.focus();
  }, [ouvert, avecChamp]);

  useEffect(() => {
    if (!ouvert || actif < 0) return;
    document.getElementById(idOption(actif))?.scrollIntoView({ block: 'nearest' });
    // `idOption` ne dépend que de `base`, stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, actif]);

  // Après une recherche, la première option active.
  useEffect(() => {
    if (ouvert && q !== '') setActif(actives.indexOf(true));
  }, [q, ouvert, actives]);

  function surTouche(e: React.KeyboardEvent): void {
    if (!ouvert) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        ouvrir();
      }
      return;
    }
    const suivant = prochainIndex(actives, actif, e.key);
    if (suivant !== null) {
      e.preventDefault();
      setActif(suivant);
      return;
    }
    if (e.key === 'Enter' || (e.key === ' ' && !avecChamp)) {
      e.preventDefault();
      const o = visibles[actif];
      if (o) choisir(o);
      return;
    }
    if (e.key === 'Escape') {
      // Une fenêtre modale autour ne doit pas se fermer avec la liste.
      e.preventDefault();
      e.stopPropagation();
      fermer(true);
      return;
    }
    if (e.key === 'Tab') {
      fermer();
      return;
    }
    if (!avecChamp && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const l = lettres.current;
      if (l.t) clearTimeout(l.t);
      l.texte += e.key;
      l.t = setTimeout(() => (l.texte = ''), 600);
      const i = indexParLettre(
        visibles.map((o) => o.label),
        actives,
        l.texte.length > 1 ? actif - 1 : actif,
        l.texte,
      );
      if (i !== null) setActif(i);
    }
  }

  // Rendu des options, groupes compris.
  const lignes: React.ReactNode[] = [];
  let groupe: { titre: string; enfants: React.ReactNode[] } | null = null;
  const vider = (): void => {
    if (!groupe) return;
    const g = groupe;
    const idG = `${base}-g${lignes.length}`;
    lignes.push(
      <div key={idG} role="group" aria-labelledby={idG} className="py-1">
        <div
          id={idG}
          role="presentation"
          className="px-3 pb-1 pt-1.5 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]"
        >
          {g.titre}
        </div>
        {g.enfants}
      </div>,
    );
    groupe = null;
  };
  visibles.forEach((o, i) => {
    const el = (
      <ListboxOption
        key={`${o.value}-${i}`}
        id={idOption(i)}
        actif={i === actif}
        selectionne={o.value === value}
        desactive={o.disabled}
        onChoisir={() => choisir(o)}
        onSurvol={() => setActif(i)}
      >
        <span className="block">
          <Surligne texte={o.label} requete={q} />
        </span>
        {o.description ? (
          <span className="block text-xs text-[var(--foreground-muted)]">{o.description}</span>
        ) : null}
      </ListboxOption>
    );
    if (o.group) {
      if (groupe && groupe.titre !== o.group) vider();
      if (!groupe) groupe = { titre: o.group, enfants: [] };
      groupe.enfants.push(el);
    } else {
      vider();
      lignes.push(el);
    }
  });
  vider();

  return (
    <div
      ref={enveloppe}
      className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        if (enveloppe.current?.contains(e.relatedTarget as Node | null)) return;
        if (ouvert) fermer();
        onBlur?.();
      }}
    >
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={bouton}
        type="button"
        id={idBouton}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idListe : undefined}
        aria-activedescendant={ouvert && !avecChamp && actif >= 0 ? idOption(actif) : undefined}
        aria-label={ariaLabel}
        aria-describedby={a11y['aria-describedby']}
        aria-invalid={a11y['aria-invalid']}
        aria-required={a11y['aria-required']}
        disabled={a11y.disabled}
        onClick={() => (ouvert ? fermer() : ouvrir())}
        onKeyDown={surTouche}
        className={cn(CONTROL_CLASSES, 'relative flex items-center pr-10 text-left')}
      >
        <span
          className={cn(
            'block min-w-0 flex-1 truncate',
            courante ? null : 'text-[var(--foreground-muted)]',
          )}
        >
          {courante ? courante.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute right-3 h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform duration-[var(--motion-fast)]',
            ouvert && 'rotate-180',
          )}
        />
      </button>
      {ouvert ? (
        <>
          {tel ? <VoileTelephone onFermer={() => fermer(true)} /> : null}
          <Popover style={style}>
            {tel ? (
              <div
                aria-hidden="true"
                className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-[var(--border-strong)]"
              />
            ) : null}
            {avecChamp ? (
              <div className="relative border-b border-[var(--border)] p-2">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-muted)]"
                />
                <input
                  ref={recherche}
                  type="search"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={idListe}
                  aria-autocomplete="list"
                  aria-activedescendant={actif >= 0 ? idOption(actif) : undefined}
                  aria-label="Rechercher dans la liste"
                  value={q}
                  placeholder={searchPlaceholder}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={surTouche}
                  autoComplete="off"
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2 text-sm outline-none focus:border-[var(--accent)] max-sm:h-10 max-sm:text-base"
                />
              </div>
            ) : null}
            <div
              id={idListe}
              role="listbox"
              aria-labelledby={ctx && !ariaLabel ? ctx.labelId : undefined}
              aria-label={ariaLabel}
              aria-busy={loading || undefined}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
            >
              {loading ? (
                <ListboxMessage>Chargement…</ListboxMessage>
              ) : visibles.length === 0 ? (
                <ListboxMessage>{q ? `Aucun résultat pour « ${q} ».` : emptyText}</ListboxMessage>
              ) : (
                lignes
              )}
            </div>
          </Popover>
        </>
      ) : null}
    </div>
  );
}

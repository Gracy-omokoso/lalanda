// Sélecteur de mois maison (ADR-0074 § 6, décision n° 6), de la famille de
// `DatePicker`, sans dépendance.
//
// - Saisie au clavier tolérante (`11/2026`, `nov. 2026`, `novembre 26`,
//   `2026-11`), lue à la sortie du champ ; affichée « nov. 2026 ». Un mois
//   illisible ou hors bornes est signalé, jamais corrigé en silence.
// - Grille des douze mois en fenêtre non modale (`role="dialog"`), feuille
//   basse sur téléphone ; clavier : flèches (mois, trimestre), Début/Fin
//   (janvier, décembre), Page préc./suiv. (année), Entrée, Échap.
// - Bornes `min`/`max` au format `AAAA-MM`.
//
// Valeur : chaîne `AAAA-MM` — exactement celle d'un `<input type="month">` —,
// ou chaîne vide.

import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../utils.js';

import { CONTROL_CLASSES, controlA11y, useField } from './field.js';
import {
  ajouterMoisCivils,
  borner,
  deplacerMoisClavier,
  formatMoisCourt,
  formatMoisLong,
  idSur,
  lireMoisIso,
  lireMoisSaisi,
  moisActuel,
  moisDe,
  MOIS_COURTS_FR,
} from './logic.js';
import { Popover, VoileTelephone } from './listbox.js';
import { useAncrage, useAppuiExterieur, useEstTelephone } from './popover.js';

/** Message d'une saisie illisible ou hors bornes (`null` si elle est bonne). */
export function messageMois(
  texte: string,
  min?: string,
  max?: string,
  reference?: string,
): string | null {
  if (texte.trim() === '') return null;
  const ym = lireMoisSaisi(texte, reference);
  if (!ym) return 'Mois non reconnu : saisissez-le au format MM/AAAA (ou « nov. 2026 »).';
  if (min && ym < min) return `Le mois ne peut pas précéder ${formatMoisLong(min)}.`;
  if (max && ym > max) return `Le mois ne peut pas dépasser ${formatMoisLong(max)}.`;
  return null;
}

interface GrilleMoisProps {
  depart: string;
  valeur: string;
  min?: string | undefined;
  max?: string | undefined;
  onChoisir: (ym: string) => void;
  onFermer: () => void;
  onEffacer?: (() => void) | undefined;
}

function GrilleDesMois({
  depart,
  valeur,
  min,
  max,
  onChoisir,
  onFermer,
  onEffacer,
}: GrilleMoisProps): React.ReactElement {
  const base = idSur(useId(), 'mois');
  const [focus, setFocus] = useState(depart);
  const grille = useRef<HTMLTableElement>(null);
  const actuel = moisActuel();
  const annee = lireMoisIso(focus)!.annee;

  useEffect(() => {
    grille.current?.querySelector<HTMLButtonElement>(`[data-mois="${focus}"]`)?.focus();
  }, [focus]);

  function surTouche(e: React.KeyboardEvent): void {
    const suivant = deplacerMoisClavier(focus, e.key);
    if (suivant) {
      e.preventDefault();
      setFocus(borner(suivant, min, max));
    }
  }

  const rangees = [0, 1, 2, 3].map((r) => [1, 2, 3].map((c) => moisDe(annee, r * 3 + c)));
  const ceMois = actuel;
  const ceMoisPermis = (!min || ceMois >= min) && (!max || ceMois <= max);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Choisir un mois"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onFermer();
        }
      }}
      className="flex w-[17rem] max-w-full flex-col gap-2 p-3 max-sm:w-full"
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label="Année précédente"
          disabled={Boolean(min && moisDe(annee - 1, 12) < min)}
          onClick={() => setFocus(borner(ajouterMoisCivils(focus, -12), min, max))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] disabled:opacity-40 max-sm:h-11 max-sm:w-11"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <p id={`${base}-titre`} aria-live="polite" className="text-sm font-semibold tabular-nums">
          {annee}
        </p>
        <button
          type="button"
          aria-label="Année suivante"
          disabled={Boolean(max && moisDe(annee + 1, 1) > max)}
          onClick={() => setFocus(borner(ajouterMoisCivils(focus, 12), min, max))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] disabled:opacity-40 max-sm:h-11 max-sm:w-11"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <table
        ref={grille}
        role="grid"
        aria-labelledby={`${base}-titre`}
        className="w-full border-collapse text-center text-sm"
        onKeyDown={surTouche}
      >
        <tbody>
          {rangees.map((rangee) => (
            <tr key={rangee[0]}>
              {rangee.map((ym) => {
                const choisi = ym === valeur;
                const permis = (!min || ym >= min) && (!max || ym <= max);
                const mois = lireMoisIso(ym)!.mois;
                return (
                  <td
                    key={ym}
                    role="gridcell"
                    aria-selected={choisi || undefined}
                    className="p-0.5"
                  >
                    <button
                      type="button"
                      data-mois={ym}
                      tabIndex={ym === focus ? 0 : -1}
                      aria-label={`${formatMoisLong(ym)}${ym === actuel ? ', mois en cours' : ''}`}
                      aria-current={ym === actuel ? 'date' : undefined}
                      disabled={!permis}
                      onClick={() => onChoisir(ym)}
                      className={cn(
                        'inline-flex h-9 w-full items-center justify-center rounded-[var(--radius-md)] text-sm capitalize transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent max-sm:h-12',
                        ym === actuel && 'font-semibold ring-1 ring-inset ring-[var(--accent)]',
                        choisi &&
                          'bg-[var(--accent)] font-semibold text-[var(--accent-foreground)] hover:bg-[var(--accent)]',
                      )}
                    >
                      {MOIS_COURTS_FR[mois - 1]}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
        <button
          type="button"
          disabled={!ceMoisPermis}
          onClick={() => onChoisir(ceMois)}
          aria-label={`Ce mois-ci : ${formatMoisLong(ceMois)}`}
          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40 max-sm:min-h-10 max-sm:px-3"
        >
          Ce mois-ci
        </button>
        {onEffacer ? (
          <button
            type="button"
            onClick={onEffacer}
            className="ml-auto rounded-full px-2.5 py-1 text-xs text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] max-sm:min-h-10"
          >
            Effacer
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface MonthPickerProps {
  /** `AAAA-MM`, ou chaîne vide. */
  value: string;
  onChange: (ym: string) => void;
  id?: string;
  /** Borne basse incluse, `AAAA-MM`. */
  min?: string;
  /** Borne haute incluse, `AAAA-MM`. */
  max?: string;
  disabled?: boolean;
  /** Obligatoire : pas de bouton « Effacer ». */
  required?: boolean;
  placeholder?: string;
  onBlur?: () => void;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Choix d'un mois civil ; même valeur que `<input type="month">`. */
export function MonthPicker({
  value,
  onChange,
  id: idDonne,
  min,
  max,
  disabled,
  required,
  placeholder = 'MM/AAAA',
  onBlur,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: MonthPickerProps): React.ReactElement {
  const ctx = useField();
  const base = idSur(useId(), 'mois');
  const [texte, setTexte] = useState(formatMoisCourt(value));
  const [probleme, setProbleme] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const enveloppe = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const tel = useEstTelephone();
  const style = useAncrage(ouvert && !tel, enveloppe, 300, 272);
  const fermer = useCallback(() => setOuvert(false), []);
  useAppuiExterieur(ouvert, [enveloppe], fermer);
  const a11y = controlA11y(
    ctx,
    {
      id: idDonne,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid || probleme !== null,
      required,
      disabled,
    },
    probleme ? `${base}-format` : undefined,
  );

  useEffect(() => {
    setTexte(formatMoisCourt(value));
    setProbleme(null);
  }, [value]);

  function valider(): void {
    const m = messageMois(texte, min, max);
    setProbleme(m);
    if (m) return;
    const ym = texte.trim() === '' ? '' : lireMoisSaisi(texte)!;
    setTexte(formatMoisCourt(ym));
    if (ym !== value) onChange(ym);
  }

  function choisir(ym: string): void {
    setProbleme(null);
    setTexte(formatMoisCourt(ym));
    if (ym !== value) onChange(ym);
    fermer();
    champ.current?.focus();
  }

  const depart = borner(lireMoisSaisi(texte) ?? (value !== '' ? value : moisActuel()), min, max);

  return (
    <div
      ref={enveloppe}
      className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        if (enveloppe.current?.contains(e.relatedTarget as Node | null)) return;
        fermer();
        onBlur?.();
      }}
    >
      <div className="relative flex items-center">
        <input
          ref={champ}
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={ariaLabel}
          {...a11y}
          value={texte}
          onChange={(e) => setTexte(e.target.value.slice(0, 20))}
          onBlur={valider}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Valide la saisie sans soumettre ; une seconde Entrée soumet.
              const m = messageMois(texte, min, max);
              if (m || formatMoisCourt(lireMoisSaisi(texte) ?? '') !== texte) {
                e.preventDefault();
                valider();
              }
            } else if (e.key === 'ArrowDown' && e.altKey) {
              e.preventDefault();
              setOuvert(true);
            }
          }}
          className={cn(CONTROL_CLASSES, 'pr-11 tabular-nums')}
        />
        <button
          ref={bouton}
          type="button"
          aria-label={value ? `Changer le mois, ${formatMoisLong(value)}` : 'Choisir un mois'}
          aria-haspopup="dialog"
          aria-expanded={ouvert}
          disabled={a11y.disabled}
          onClick={() => setOuvert((o) => !o)}
          className="absolute right-1 inline-flex h-8 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:opacity-50 max-sm:h-10 max-sm:w-10"
        >
          <CalendarRange aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {probleme ? (
        <p
          id={`${base}-format`}
          aria-live="polite"
          className="mt-1 text-xs font-medium text-[var(--danger)]"
        >
          {probleme}
        </p>
      ) : null}
      {ouvert ? (
        <>
          {tel ? <VoileTelephone onFermer={fermer} /> : null}
          <Popover style={style} className="w-auto">
            <GrilleDesMois
              depart={depart}
              valeur={value}
              min={min}
              max={max}
              onChoisir={choisir}
              onFermer={() => {
                fermer();
                bouton.current?.focus();
              }}
              onEffacer={required ? undefined : () => choisir('')}
            />
          </Popover>
        </>
      ) : null}
    </div>
  );
}

// Sélecteurs de date maison (ADR-0074 § 6), sans dépendance.
//
// - Saisie au clavier JJ/MM/AAAA, tolérante (`11/11/26`, `11.11.2026`,
//   `11112026`, `11/11`), lue à la sortie du champ ; une date qui n'existe
//   pas est signalée sans être corrigée en silence.
// - Calendrier en français, lundi premier, en fenêtre non modale
//   (`role="dialog"`) : grille WAI-ARIA, flèches (jour, semaine), Début/Fin
//   (semaine), Page préc./suiv. (mois), Maj+Page (année), Entrée, Échap.
// - Titre cliquable : vue des douze mois et changement d'année rapide.
// - Raccourcis (Aujourd'hui, Fin de mois, +30 j…) choisis par l'écran.
// - Bornes min/max ; jours marqués (fériés de l'organisation) fournis par
//   l'écran (`marks`) ou par un `DateMarksProvider` englobant — ce composant
//   n'en invente aucun et n'appelle aucune API. Un jour marqué porte un point
//   discret et son nom en infobulle ; il reste choisissable (jamais bloquant).
//
// Valeur : chaîne ISO `AAAA-MM-JJ`, ou chaîne vide.

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '../utils.js';

import { CONTROL_CLASSES, controlA11y, useField } from './field.js';
import {
  ajouterMois,
  aujourdhuiIso,
  borner,
  choisirDansPlage,
  dansLesBornes,
  dateRaccourci,
  deplacerJour,
  formatDateFr,
  formatDateLongue,
  grilleMois,
  idSur,
  indexerMarques,
  isoDe,
  JOURS_COURTS_FR,
  JOURS_FR,
  LIBELLES_RACCOURCIS,
  lireDateSaisie,
  lireIso,
  MOIS_COURTS_FR,
  MOIS_FR,
  type JourMarque,
  type RaccourciDate,
} from './logic.js';
import { Popover, VoileTelephone } from './listbox.js';
import { useAncrage, useAppuiExterieur, useEstTelephone } from './popover.js';

/** Jour marqué (férié…) ; `recurring` : même jour chaque année. */
export type DateMark = JourMarque;

const MarquesContexte = createContext<readonly DateMark[] | null>(null);

/**
 * Jours marqués de TOUS les sélecteurs de date englobés (fériés de
 * l'organisation, chargés une fois par l'application). Un `marks` passé à un
 * sélecteur l'emporte. `@lalanda/ui` n'appelle jamais l'API lui-même.
 */
export function DateMarksProvider({
  marks,
  children,
}: {
  marks: readonly DateMark[] | null;
  children: React.ReactNode;
}): React.ReactElement {
  return <MarquesContexte.Provider value={marks}>{children}</MarquesContexte.Provider>;
}

/** Jours marqués du `DateMarksProvider` englobant (`null` hors fournisseur). */
export function useDateMarks(): readonly DateMark[] | null {
  return useContext(MarquesContexte);
}

interface CalendrierProps {
  /** Jour actif à l'ouverture. */
  depart: string;
  selection: { start: string; end: string };
  min?: string | undefined;
  max?: string | undefined;
  marks?: readonly DateMark[] | undefined;
  shortcuts?: readonly RaccourciDate[] | undefined;
  onChoisir: (iso: string) => void;
  onFermer: () => void;
  onEffacer?: (() => void) | undefined;
  libelle: string;
}

/** Calendrier d'un mois ; partagé par `DatePicker` et `DateRangePicker`. */
function Calendrier({
  depart,
  selection,
  min,
  max,
  marks,
  shortcuts = ['today'],
  onChoisir,
  onFermer,
  onEffacer,
  libelle,
}: CalendrierProps): React.ReactElement {
  const base = idSur(useId(), 'cal');
  const [focus, setFocus] = useState(depart);
  const [vue, setVue] = useState<'jours' | 'mois'>('jours');
  const grille = useRef<HTMLTableElement>(null);
  const aujourdhui = aujourdhuiIso();
  const d = lireIso(focus)!;
  const nomDuJour = useMemo(() => indexerMarques(marks), [marks]);

  // Le jour actif reçoit le focus (tabindex mobile, une seule cellule à 0).
  useEffect(() => {
    if (vue !== 'jours') return;
    grille.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();
  }, [focus, vue]);

  function surTouche(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onFermer();
      return;
    }
    const suivant = deplacerJour(focus, e.key, e.shiftKey);
    if (suivant) {
      e.preventDefault();
      setFocus(borner(suivant, min, max));
    }
  }

  const titre = `${MOIS_FR[d.mois - 1]} ${d.annee}`;
  const debutPlage = selection.start;
  const finPlage = selection.end;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={libelle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onFermer();
        }
      }}
      className="flex w-[19.5rem] max-w-full flex-col gap-2 p-3 max-sm:w-full"
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={vue === 'jours' ? 'Mois précédent' : 'Année précédente'}
          onClick={() => setFocus(borner(ajouterMois(focus, vue === 'jours' ? -1 : -12), min, max))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] max-sm:h-11 max-sm:w-11"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-live="polite"
          aria-label={
            vue === 'jours' ? `${titre} — choisir le mois et l’année` : `Année ${d.annee}`
          }
          onClick={() => setVue((v) => (v === 'jours' ? 'mois' : 'jours'))}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-sm font-semibold capitalize hover:bg-[var(--surface-muted)] max-sm:min-h-11"
        >
          {vue === 'jours' ? titre : d.annee}
        </button>
        <button
          type="button"
          aria-label={vue === 'jours' ? 'Mois suivant' : 'Année suivante'}
          onClick={() => setFocus(borner(ajouterMois(focus, vue === 'jours' ? 1 : 12), min, max))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] max-sm:h-11 max-sm:w-11"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {vue === 'mois' ? (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`Mois de ${d.annee}`}>
          {MOIS_FR.map((m, i) => {
            const cible = isoDe(d.annee, i + 1, 1);
            const finCible = isoDe(d.annee, i + 1, 28);
            const horsBornes = (max && cible > max) || (min && finCible < min);
            return (
              <button
                key={m}
                type="button"
                disabled={Boolean(horsBornes)}
                aria-pressed={i + 1 === d.mois}
                onClick={() => {
                  setFocus(borner(isoDe(d.annee, i + 1, Math.min(d.jour, 28)), min, max));
                  setVue('jours');
                }}
                className={cn(
                  'rounded-[var(--radius-sm)] px-2 py-2 text-sm capitalize hover:bg-[var(--surface-muted)] disabled:opacity-40 max-sm:min-h-11',
                  i + 1 === d.mois &&
                    'bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent)]',
                )}
              >
                {MOIS_COURTS_FR[i]}
              </button>
            );
          })}
        </div>
      ) : (
        <table
          ref={grille}
          role="grid"
          aria-labelledby={`${base}-titre`}
          className="w-full border-collapse text-center text-sm"
          onKeyDown={surTouche}
        >
          <caption id={`${base}-titre`} className="sr-only">
            {titre}
          </caption>
          <thead>
            <tr>
              {JOURS_COURTS_FR.map((j, i) => (
                <th
                  key={j}
                  scope="col"
                  abbr={JOURS_FR[i]}
                  className="pb-1 text-[0.7rem] font-medium uppercase text-[var(--foreground-muted)]"
                >
                  {j.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grilleMois(d.annee, d.mois).map((semaine) => (
              <tr key={semaine[0]!.iso}>
                {semaine.map((jour) => {
                  const choisi = jour.iso === debutPlage || jour.iso === finPlage;
                  const dansPlage =
                    debutPlage !== '' &&
                    finPlage !== '' &&
                    jour.iso > debutPlage &&
                    jour.iso < finPlage;
                  const permis = dansLesBornes(jour.iso, min, max);
                  const marque = nomDuJour(jour.iso);
                  const nom = `${formatDateLongue(jour.iso)}${marque ? `, ${marque}` : ''}${jour.iso === aujourdhui ? ', aujourd’hui' : ''}`;
                  return (
                    <td
                      key={jour.iso}
                      role="gridcell"
                      aria-selected={choisi || dansPlage || undefined}
                      className={cn('p-0.5', dansPlage && 'bg-[var(--accent-soft)]')}
                    >
                      <button
                        type="button"
                        data-iso={jour.iso}
                        tabIndex={jour.iso === focus ? 0 : -1}
                        aria-label={nom}
                        aria-current={jour.iso === aujourdhui ? 'date' : undefined}
                        disabled={!permis}
                        title={marque}
                        onClick={() => onChoisir(jour.iso)}
                        className={cn(
                          'relative inline-flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent max-sm:h-11 max-sm:w-full max-sm:rounded-[var(--radius-md)]',
                          !jour.duMois && 'text-[var(--foreground-muted)] opacity-60',
                          jour.iso === aujourdhui &&
                            'font-semibold ring-1 ring-inset ring-[var(--accent)]',
                          choisi &&
                            'bg-[var(--accent)] font-semibold text-[var(--accent-foreground)] hover:bg-[var(--accent)]',
                        )}
                      >
                        {jour.jour}
                        {marque ? (
                          <span
                            aria-hidden="true"
                            className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--warn)]"
                          />
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
        {shortcuts.map((r) => {
          const iso = dateRaccourci(r, aujourdhui);
          return (
            <button
              key={r}
              type="button"
              disabled={!dansLesBornes(iso, min, max)}
              onClick={() => onChoisir(iso)}
              aria-label={`${LIBELLES_RACCOURCIS[r]} : ${formatDateLongue(iso)}`}
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40 max-sm:min-h-10 max-sm:px-3"
            >
              {LIBELLES_RACCOURCIS[r]}
            </button>
          );
        })}
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

export interface DatePickerProps {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  /** Raccourcis proposés sous le calendrier (défaut : Aujourd'hui). */
  shortcuts?: readonly RaccourciDate[];
  /** Jours marqués (fériés de l'organisation…), fournis par l'écran. */
  marks?: readonly DateMark[];
  placeholder?: string;
  onBlur?: () => void;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Message d'une saisie illisible ou hors bornes (`null` si elle est bonne). */
export function messageDate(
  texte: string,
  min?: string,
  max?: string,
  reference?: string,
): string | null {
  if (texte.trim() === '') return null;
  const iso = lireDateSaisie(texte, reference);
  if (!iso) return 'Date non reconnue : saisissez-la au format JJ/MM/AAAA.';
  if (min && iso < min) return `La date ne peut pas précéder le ${formatDateFr(min)}.`;
  if (max && iso > max) return `La date ne peut pas dépasser le ${formatDateFr(max)}.`;
  return null;
}

function useCalendrier(): {
  ouvert: boolean;
  ouvrir: () => void;
  fermer: () => void;
  enveloppe: React.RefObject<HTMLDivElement | null>;
  style: React.CSSProperties | undefined;
  tel: boolean;
} {
  const [ouvert, setOuvert] = useState(false);
  const enveloppe = useRef<HTMLDivElement>(null);
  const tel = useEstTelephone();
  const style = useAncrage(ouvert && !tel, enveloppe, 400, 312);
  const fermer = useCallback(() => setOuvert(false), []);
  useAppuiExterieur(ouvert, [enveloppe], fermer);
  return { ouvert, ouvrir: () => setOuvert(true), fermer, enveloppe, style, tel };
}

export function DatePicker({
  value,
  onChange,
  id: idDonne,
  min,
  max,
  disabled,
  required,
  shortcuts,
  marks,
  placeholder = 'JJ/MM/AAAA',
  onBlur,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: DatePickerProps): React.ReactElement {
  const ctx = useField();
  const marquesFournies = useDateMarks();
  const base = idSur(useId(), 'date');
  const [texte, setTexte] = useState(formatDateFr(value));
  const [probleme, setProbleme] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const cal = useCalendrier();
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
    setTexte(formatDateFr(value));
    setProbleme(null);
  }, [value]);

  function valider(): void {
    const m = messageDate(texte, min, max);
    setProbleme(m);
    if (m) return;
    const iso = texte.trim() === '' ? '' : lireDateSaisie(texte)!;
    setTexte(formatDateFr(iso));
    if (iso !== value) onChange(iso);
  }

  function choisir(iso: string): void {
    setProbleme(null);
    setTexte(formatDateFr(iso));
    if (iso !== value) onChange(iso);
    cal.fermer();
    champ.current?.focus();
  }

  const depart = borner(
    lireDateSaisie(texte) ?? (value !== '' ? value : aujourdhuiIso()),
    min,
    max,
  );

  return (
    <div
      ref={cal.enveloppe}
      className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        if (cal.enveloppe.current?.contains(e.relatedTarget as Node | null)) return;
        cal.fermer();
        onBlur?.();
      }}
    >
      <div className="relative flex items-center">
        <input
          ref={champ}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={ariaLabel}
          {...a11y}
          value={texte}
          onChange={(e) => setTexte(e.target.value.replace(/[^\d/.\-\s]/g, '').slice(0, 10))}
          onBlur={valider}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Valide la saisie sans soumettre ; une seconde Entrée soumet.
              const m = messageDate(texte, min, max);
              if (m || formatDateFr(lireDateSaisie(texte) ?? '') !== texte) {
                e.preventDefault();
                valider();
              }
            } else if (e.key === 'ArrowDown' && e.altKey) {
              e.preventDefault();
              cal.ouvrir();
            }
          }}
          className={cn(CONTROL_CLASSES, 'pr-11 tabular-nums')}
        />
        <button
          ref={bouton}
          type="button"
          aria-label={value ? `Changer la date, ${formatDateLongue(value)}` : 'Choisir une date'}
          aria-haspopup="dialog"
          aria-expanded={cal.ouvert}
          disabled={a11y.disabled}
          onClick={() => (cal.ouvert ? cal.fermer() : cal.ouvrir())}
          className="absolute right-1 inline-flex h-8 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:opacity-50 max-sm:h-10 max-sm:w-10"
        >
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
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
      {cal.ouvert ? (
        <>
          {cal.tel ? <VoileTelephone onFermer={cal.fermer} /> : null}
          <Popover style={cal.style} className="w-auto">
            <Calendrier
              depart={depart}
              selection={{ start: value, end: '' }}
              min={min}
              max={max}
              marks={marks ?? marquesFournies ?? undefined}
              shortcuts={shortcuts}
              libelle="Choisir une date"
              onChoisir={choisir}
              onFermer={() => {
                cal.fermer();
                bouton.current?.focus();
              }}
              onEffacer={
                required
                  ? undefined
                  : () => {
                      choisir('');
                    }
              }
            />
          </Popover>
        </>
      ) : null}
    </div>
  );
}

export interface DateRange {
  start: string;
  end: string;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  shortcuts?: readonly RaccourciDate[];
  marks?: readonly DateMark[];
  startLabel?: string;
  endLabel?: string;
  className?: string;
  onBlur?: () => void;
}

/**
 * Plage de dates : deux saisies (« Du », « Au ») et un seul calendrier — premier
 * clic = début, second = fin, dans l'ordre que l'on veut.
 */
export function DateRangePicker({
  value,
  onChange,
  id: idDonne,
  min,
  max,
  disabled,
  required,
  shortcuts,
  marks,
  startLabel = 'Du',
  endLabel = 'Au',
  className,
  onBlur,
}: DateRangePickerProps): React.ReactElement {
  const ctx = useField();
  const marquesFournies = useDateMarks();
  const base = idSur(useId(), 'plage');
  const a11y = controlA11y(ctx, { id: idDonne, required, disabled });
  const idDebut = a11y.id ?? `${base}-du`;
  const [debut, setDebut] = useState(formatDateFr(value.start));
  const [fin, setFin] = useState(formatDateFr(value.end));
  const [probleme, setProbleme] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<DateRange>(value);
  const cal = useCalendrier();

  useEffect(() => {
    setDebut(formatDateFr(value.start));
    setFin(formatDateFr(value.end));
    setEnCours(value);
  }, [value]);

  function valider(): void {
    const m = messageDate(debut, min, max) ?? messageDate(fin, min, max);
    if (m) {
      setProbleme(m);
      return;
    }
    const start = debut.trim() === '' ? '' : lireDateSaisie(debut)!;
    const end = fin.trim() === '' ? '' : lireDateSaisie(fin)!;
    if (start && end && end < start) {
      setProbleme('La fin de la période précède son début.');
      return;
    }
    setProbleme(null);
    if (start !== value.start || end !== value.end) onChange({ start, end });
  }

  const describe = [a11y['aria-describedby'], probleme ? `${base}-format` : null]
    .filter(Boolean)
    .join(' ');
  const champClasses = cn(CONTROL_CLASSES, 'tabular-nums');

  return (
    <div
      ref={cal.enveloppe}
      className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        if (cal.enveloppe.current?.contains(e.relatedTarget as Node | null)) return;
        cal.fermer();
        onBlur?.();
      }}
    >
      <div className="flex items-center gap-2" role="group" aria-labelledby={ctx?.labelId}>
        <input
          id={idDebut}
          type="text"
          inputMode="numeric"
          placeholder="JJ/MM/AAAA"
          aria-label={startLabel}
          aria-describedby={describe || undefined}
          aria-invalid={a11y['aria-invalid'] || (probleme ? true : undefined)}
          disabled={a11y.disabled}
          value={debut}
          onChange={(e) => setDebut(e.target.value.slice(0, 10))}
          onBlur={valider}
          className={champClasses}
        />
        <span aria-hidden="true" className="text-[var(--foreground-muted)]">
          →
        </span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="JJ/MM/AAAA"
          aria-label={endLabel}
          aria-describedby={describe || undefined}
          aria-invalid={a11y['aria-invalid'] || (probleme ? true : undefined)}
          disabled={a11y.disabled}
          value={fin}
          onChange={(e) => setFin(e.target.value.slice(0, 10))}
          onBlur={valider}
          className={champClasses}
        />
        <button
          type="button"
          aria-label="Choisir la période dans le calendrier"
          aria-haspopup="dialog"
          aria-expanded={cal.ouvert}
          disabled={a11y.disabled}
          onClick={() => {
            setEnCours(value);
            if (cal.ouvert) cal.fermer();
            else cal.ouvrir();
          }}
          className="inline-flex h-[var(--control-h)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 max-sm:h-11 max-sm:w-11"
        >
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
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
      {cal.ouvert ? (
        <>
          {cal.tel ? <VoileTelephone onFermer={cal.fermer} /> : null}
          <Popover style={cal.style} className="w-auto">
            <p className="px-3 pt-3 text-xs text-[var(--foreground-muted)]" aria-live="polite">
              {enCours.start === '' || enCours.end !== ''
                ? 'Choisissez le premier jour.'
                : `Du ${formatDateFr(enCours.start)} — choisissez le dernier jour.`}
            </p>
            <Calendrier
              depart={borner(enCours.start || aujourdhuiIso(), min, max)}
              selection={enCours}
              min={min}
              max={max}
              marks={marks ?? marquesFournies ?? undefined}
              shortcuts={shortcuts}
              libelle="Choisir une période"
              onChoisir={(iso) => {
                const suite = choisirDansPlage(enCours, iso);
                setEnCours(suite);
                if (suite.end !== '') {
                  setProbleme(null);
                  onChange(suite);
                  cal.fermer();
                }
              }}
              onFermer={cal.fermer}
              onEffacer={
                required
                  ? undefined
                  : () => {
                      onChange({ start: '', end: '' });
                      cal.fermer();
                    }
              }
            />
          </Popover>
        </>
      ) : null}
    </div>
  );
}

'use client';

// Calendrier des tâches (ADR-0039 § 8, lot L3b) — composant d'affichage
// réutilisable (onglet Calendrier d'un projet ; plus tard « Mes tâches »). Les
// décisions vivent dans `calendar-model.ts` ; ce fichier assemble.
//
// - Mois ou semaine. Une tâche est posée sur son échéance, ou étendue de sa
//   date de début à son échéance ; un jalon est un losange ◆ (forme, pas
//   seulement couleur). Une relance du CRM (ADR-0040 — C4) porte une étiquette
//   (« Relance ») et le signe ↻ au lieu d'un numéro de tâche.
// - Glisser une tâche vers un autre jour déplace son échéance (une tâche datée
//   glisse en bloc). Équivalents : au clavier, flèches sur la tâche puis Entrée
//   (Échap annule) ; menu « Déplacer l'échéance… » dans la vue liste.
// - Téléphone (< 768 px) : vue liste par jour (agenda) au lieu de la grille.
//   Sur bureau, la même liste est proposée par le bouton « Liste ».

import { addDays } from '@lalanda/shared/work';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BOUTON_PETIT } from './elements';
import {
  JOURS_COURTS,
  agenda,
  appliquerCorps,
  corpsDeplacement,
  decalageClavier,
  decaler,
  ecartJours,
  libelleEtendue,
  libelleJour,
  nomElement,
  optionsEcheance,
  periode,
  placerSemaines,
  sansEcheance,
  type Segment,
  type TacheDeplacable,
  type VueCalendrier,
} from './calendar-model';
import { LIBELLES_ECHEANCE, etatEcheance, formatJour } from './projets-model';

export interface TacheCalendrierUI extends TacheDeplacable {
  number: number;
  title: string;
  /** ADR-0040 — C4 : élément qui n'est pas une tâche (« Relance ») ; pas de numéro. */
  etiquette?: string;
}

/** Numéro de tâche, ou signe de la relance (forme, pas seulement couleur). */
function Repere({ t, className }: { t: TacheCalendrierUI; className: string }): React.ReactElement {
  return t.etiquette ? (
    <span aria-hidden="true" className={className}>
      ↻
    </span>
  ) : (
    <span className={className}>#{t.number}</span>
  );
}

const TYPE_GLISSE = 'application/x-lalanda-tache-calendrier';
const LIGNES_MOIS = 3;
const HAUTEUR_PUCE = 24; // px, une ligne de tâche dans la grille
const HAUTEUR_NUMERO = 26; // px, numéro du jour en tête de case

interface Attente {
  taskId: string;
  delta: number;
}

export function CalendrierTaches<T extends TacheCalendrierUI>({
  taches,
  today,
  dueSoonDays,
  peutDeplacer,
  onOuvrir,
  onDeplacer,
  sousTitre,
  idPrefixe,
}: {
  taches: readonly T[];
  today: string;
  dueSoonDays: number;
  peutDeplacer: boolean;
  onOuvrir: (t: T) => void;
  /** Reçoit le corps du PATCH déjà calculé (`corpsDeplacement`). */
  onDeplacer: (t: T, corps: NonNullable<ReturnType<typeof corpsDeplacement>>) => void;
  /** Ligne secondaire d'une tâche (par exemple le nom du projet). */
  sousTitre?: (t: T) => string | null;
  idPrefixe: string;
}): React.ReactElement {
  const [vue, setVue] = useState<VueCalendrier>('mois');
  const [liste, setListe] = useState(false);
  const [ancre, setAncre] = useState(today);
  const [glisse, setGlisse] = useState<{ taskId: string; jourSaisi: string } | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [attente, setAttente] = useState<Attente | null>(null);
  const [annonce, setAnnonce] = useState('');
  const racine = useRef<HTMLDivElement>(null);

  const p = useMemo(() => periode(vue, ancre), [vue, ancre]);
  const parId = useMemo(() => new Map(taches.map((t) => [t.id, t])), [taches]);

  // Aperçu du geste clavier en attente : la tâche est dessinée à sa future place.
  const affichees = useMemo(() => {
    if (attente === null) return taches;
    return taches.map((t) => {
      if (t.id !== attente.taskId || t.dueDate === null) return t;
      const c = corpsDeplacement(t, addDays(t.dueDate, attente.delta));
      return c ? appliquerCorps(t, c) : t;
    });
  }, [taches, attente]);

  const semaines = useMemo(
    () => placerSemaines(affichees, p.semaines, vue === 'mois' ? LIGNES_MOIS : undefined),
    [affichees, p.semaines, vue],
  );
  const jours = useMemo(() => agenda(affichees, p.debut, p.fin), [affichees, p.debut, p.fin]);
  const nonPlacees = useMemo(() => sansEcheance(taches), [taches]);

  // Le geste clavier suit la tâche : on garde le focus, et la période suit.
  useEffect(() => {
    if (attente === null) return;
    const t = affichees.find((x) => x.id === attente.taskId);
    if (!t?.dueDate) return;
    if (t.dueDate < p.debut || t.dueDate > p.fin) {
      setAncre(t.dueDate);
      return;
    }
    const el = racine.current?.querySelector<HTMLElement>(
      `[data-puce="${attente.taskId}"][data-echeance="1"]`,
    );
    if (el && document.activeElement !== el) el.focus();
  }, [attente, affichees, p.debut, p.fin]);

  function valider(): void {
    if (attente === null) return;
    const t = parId.get(attente.taskId);
    setAttente(null);
    if (!t?.dueDate) return;
    const cible = addDays(t.dueDate, attente.delta);
    const corps = corpsDeplacement(t, cible);
    if (corps === null) return;
    setAnnonce(`Échéance de ${nomElement(t)} déplacée au ${libelleJour(cible)}.`);
    onDeplacer(t, corps);
  }

  function deplacerVers(t: T, cible: string): void {
    const corps = corpsDeplacement(t, cible);
    if (corps === null) return;
    setAnnonce(`Échéance de ${nomElement(t)} déplacée au ${libelleJour(cible)}.`);
    onDeplacer(t, corps);
  }

  function toucheSurPuce(e: React.KeyboardEvent, t: T): void {
    if (e.key === 'Escape' && attente?.taskId === t.id) {
      e.preventDefault();
      setAttente(null);
      setAnnonce('Déplacement annulé.');
      return;
    }
    if (e.key === 'Enter' && attente?.taskId === t.id) {
      e.preventDefault();
      valider();
      return;
    }
    if (!peutDeplacer || t.dueDate === null) return;
    const d = decalageClavier(e.key);
    if (d === null) return;
    e.preventDefault();
    const delta = (attente?.taskId === t.id ? attente.delta : 0) + d;
    setAttente(delta === 0 ? null : { taskId: t.id, delta });
    setAnnonce(
      delta === 0
        ? 'Échéance inchangée.'
        : `Nouvelle échéance : ${libelleJour(addDays(t.dueDate, delta))}. Entrée pour valider, Échap pour annuler.`,
    );
  }

  function deposer(e: React.DragEvent, jour: string): void {
    e.preventDefault();
    const g = glisse;
    setGlisse(null);
    setSurvol(null);
    if (g === null) return;
    const t = parId.get(e.dataTransfer.getData(TYPE_GLISSE) || g.taskId);
    if (!t?.dueDate) return;
    // Le jour saisi (sous le pointeur) arrive sur le jour de dépôt.
    deplacerVers(t, addDays(t.dueDate, ecartJours(g.jourSaisi, jour)));
  }

  const id = (s: string) => `${idPrefixe}-${s}`;

  return (
    <div ref={racine} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={BOUTON_PETIT}
            onClick={() => setAncre(decaler(vue, ancre, -1))}
          >
            <span aria-hidden="true">‹ </span>
            {vue === 'mois' ? 'Mois précédent' : 'Semaine précédente'}
          </button>
          <button type="button" className={BOUTON_PETIT} onClick={() => setAncre(today)}>
            Aujourd’hui
          </button>
          <button
            type="button"
            className={BOUTON_PETIT}
            onClick={() => setAncre(decaler(vue, ancre, 1))}
          >
            {vue === 'mois' ? 'Mois suivant' : 'Semaine suivante'}
            <span aria-hidden="true"> ›</span>
          </button>
        </div>
        <h2
          id={id('titre')}
          className="text-base font-semibold first-letter:uppercase"
          aria-live="polite"
        >
          {p.titre}
        </h2>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label="Période affichée" className="flex">
            {(['mois', 'semaine'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vue === v}
                onClick={() => setVue(v)}
                className={`${BOUTON_PETIT} ${v === 'mois' ? 'rounded-r-none' : '-ml-px rounded-l-none'} aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent)]`}
              >
                {v === 'mois' ? 'Mois' : 'Semaine'}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={liste}
            onClick={() => setListe(!liste)}
            className={`${BOUTON_PETIT} hidden md:inline-flex aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent)]`}
          >
            Liste
          </button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {annonce}
      </p>
      {peutDeplacer ? (
        <p className="hidden text-xs text-[var(--foreground-muted)] md:block">
          {liste
            ? 'Chaque tâche a un menu « Déplacer l’échéance ».'
            : 'Glissez une tâche vers un autre jour pour changer son échéance. Au clavier : flèches sur la tâche (← → un jour, ↑ ↓ une semaine), puis Entrée ; Échap annule.'}
        </p>
      ) : null}

      {/* Grille : bureau seulement, et seulement hors vue liste. */}
      <div
        className={liste ? 'hidden' : 'hidden md:block'}
        aria-labelledby={id('titre')}
        role="region"
      >
        <div className="grid grid-cols-7 border-b border-[var(--border)] pb-1 text-xs font-medium text-[var(--foreground-muted)]">
          {JOURS_COURTS.map((j) => (
            <div key={j} className="px-1.5" aria-hidden="true">
              {j}
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          {semaines.map((s) => {
            const lignes = vue === 'mois' ? LIGNES_MOIS : Math.max(4, s.lignes);
            const hauteur = HAUTEUR_NUMERO + lignes * HAUTEUR_PUCE + (vue === 'mois' ? 22 : 8);
            return (
              <div key={s.jours[0]} className="relative" style={{ minHeight: hauteur }}>
                {/* Fond : les cases-jours (cibles du dépôt). */}
                <div className="absolute inset-0 grid grid-cols-7">
                  {s.jours.map((jour, col) => {
                    const horsMois = vue === 'mois' && jour.slice(0, 7) !== p.mois;
                    const estAujourdhui = jour === today;
                    const n = s.masquees[col] ?? 0;
                    return (
                      <div
                        key={jour}
                        onDragOver={(e) => {
                          if (glisse === null) return;
                          e.preventDefault();
                          if (survol !== jour) setSurvol(jour);
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                            setSurvol(null);
                        }}
                        onDrop={(e) => deposer(e, jour)}
                        className={`relative border-b border-r border-[var(--border)] first:border-l ${horsMois ? 'bg-[var(--surface-muted)]' : 'bg-[var(--surface)]'} ${survol === jour ? 'outline outline-2 -outline-offset-2 outline-[var(--accent)]' : ''}`}
                      >
                        <span
                          className={`absolute left-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${estAujourdhui ? 'bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]' : horsMois ? 'text-[var(--foreground-muted)]' : ''}`}
                        >
                          <span aria-hidden="true">{Number(jour.slice(8))}</span>
                          <span className="sr-only">
                            {libelleJour(jour)}
                            {estAujourdhui ? ', aujourd’hui' : ''}
                          </span>
                        </span>
                        {estAujourdhui ? (
                          <span
                            className="absolute right-1 top-1 text-[0.65rem] font-medium text-[var(--accent)]"
                            aria-hidden="true"
                          >
                            Aujourd’hui
                          </span>
                        ) : null}
                        {n > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setVue('semaine');
                              setAncre(jour);
                            }}
                            className="absolute bottom-0.5 left-1 text-[0.7rem] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                          >
                            +{n} autre{n > 1 ? 's' : ''}
                            <span className="sr-only">
                              {' '}
                              le {libelleJour(jour)}, voir la semaine
                            </span>
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {/* Avant-plan : les tâches, placées sur la grille des jours. */}
                <ul
                  className={`relative grid grid-cols-7 gap-y-0.5 px-0.5 ${glisse !== null ? 'pointer-events-none' : ''}`}
                  style={{
                    paddingTop: HAUTEUR_NUMERO,
                    gridTemplateRows: `repeat(${Math.max(1, s.lignes)}, ${HAUTEUR_PUCE - 2}px)`,
                  }}
                >
                  {s.segments.map((seg) => {
                    const t = parId.get(seg.taskId);
                    if (!t) return null;
                    return (
                      <Puce
                        key={`${seg.taskId}-${seg.colDebut}`}
                        t={affichees.find((x) => x.id === t.id) ?? t}
                        seg={seg}
                        today={today}
                        dueSoonDays={dueSoonDays}
                        peutDeplacer={peutDeplacer}
                        enAttente={attente?.taskId === t.id}
                        glissee={glisse?.taskId === t.id}
                        onOuvrir={() => onOuvrir(t)}
                        onKeyDown={(e) => toucheSurPuce(e, t)}
                        onDragStart={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          const span = seg.colFin - seg.colDebut + 1;
                          const col = Math.min(
                            span - 1,
                            Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * span)),
                          );
                          e.dataTransfer.setData(TYPE_GLISSE, t.id);
                          e.dataTransfer.effectAllowed = 'move';
                          const jourSaisi = s.jours[seg.colDebut + col]!;
                          // Après le départ du glisser : modifier le DOM pendant
                          // `dragstart` l'annule dans certains navigateurs.
                          setTimeout(() => setGlisse({ taskId: t.id, jourSaisi }), 0);
                        }}
                        onDragEnd={() => {
                          setGlisse(null);
                          setSurvol(null);
                        }}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Liste par jour (agenda) : toujours sur téléphone, sur demande sur bureau. */}
      <section className={liste ? '' : 'md:hidden'} aria-label={`Échéances, ${p.titre}`}>
        {jours.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucune échéance sur cette période.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {jours.map((j) => (
              <li key={j.jour} className="flex flex-col gap-1.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold first-letter:uppercase">
                  {libelleJour(j.jour, false)}
                  {j.jour === today ? (
                    <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[0.7rem] font-medium text-[var(--accent)]">
                      Aujourd’hui
                    </span>
                  ) : null}
                </h3>
                <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                  {j.taches.map((t) => (
                    <LigneAgenda
                      key={t.id}
                      t={t}
                      today={today}
                      dueSoonDays={dueSoonDays}
                      peutDeplacer={peutDeplacer}
                      sousTitre={sousTitre?.(t) ?? null}
                      onOuvrir={() => onOuvrir(parId.get(t.id) ?? t)}
                      onDeplacer={(jour) => {
                        const orig = parId.get(t.id);
                        if (orig) deplacerVers(orig, jour);
                      }}
                      idMenu={id(`deplacer-${t.id}`)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {nonPlacees.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--foreground-muted)]">
            {nonPlacees.length} tâche{nonPlacees.length > 1 ? 's' : ''} sans échéance (absente
            {nonPlacees.length > 1 ? 's' : ''} du calendrier)
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {nonPlacees.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOuvrir(t)}
                  className="text-left underline-offset-2 hover:underline"
                >
                  <Repere t={t} className="text-[var(--foreground-muted)]" /> {t.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Puce({
  t,
  seg,
  today,
  dueSoonDays,
  peutDeplacer,
  enAttente,
  glissee,
  onOuvrir,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: {
  t: TacheCalendrierUI;
  seg: Segment;
  today: string;
  dueSoonDays: number;
  peutDeplacer: boolean;
  enAttente: boolean;
  glissee: boolean;
  onOuvrir: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}): React.ReactElement {
  const etat = etatEcheance(t, today, dueSoonDays);
  const enRetard = etat === 'en_retard';
  const jalon = seg.forme === 'jalon';
  const bords = `${seg.continueAvant ? 'rounded-l-none border-l-0' : ''} ${seg.continueApres ? 'rounded-r-none border-r-0' : ''}`;
  const ton = t.done
    ? 'border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-muted)]'
    : enRetard
      ? 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
      : jalon
        ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--foreground)]'
        : 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--foreground)]';
  const libelle = [
    jalon ? 'Jalon' : (t.etiquette ?? 'Tâche'),
    t.etiquette ? t.title : `#${t.number} ${t.title}`,
    libelleEtendue(t),
    t.done ? 'terminée' : null,
    etat ? LIBELLES_ECHEANCE[etat] : null,
    enAttente ? 'déplacement en attente : Entrée pour valider, Échap pour annuler' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li
      className="min-w-0"
      style={{ gridColumn: `${seg.colDebut + 1} / ${seg.colFin + 2}`, gridRow: seg.ligne + 1 }}
    >
      <button
        type="button"
        data-puce={t.id}
        data-echeance={seg.porteEcheance ? '1' : '0'}
        draggable={peutDeplacer}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onOuvrir}
        onKeyDown={onKeyDown}
        aria-label={libelle}
        title={libelle}
        className={`flex h-full w-full min-w-0 items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 text-left text-xs ${ton} ${bords} ${glissee ? 'opacity-50' : ''} ${enAttente ? 'ring-2 ring-[var(--focus)] ring-offset-1' : ''} ${peutDeplacer ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {seg.continueAvant ? <span aria-hidden="true">◂</span> : null}
        {jalon ? (
          <span aria-hidden="true" className="text-[var(--accent)]">
            ◆
          </span>
        ) : null}
        {enRetard && !t.done ? <span aria-hidden="true">⚠</span> : null}
        {t.done ? <span aria-hidden="true">✓</span> : null}
        <span className={`truncate ${t.done ? 'line-through' : ''}`} aria-hidden="true">
          <Repere t={t} className="opacity-70" /> {t.title}
        </span>
        {seg.continueApres ? (
          <span aria-hidden="true" className="ml-auto">
            ▸
          </span>
        ) : null}
      </button>
    </li>
  );
}

function LigneAgenda({
  t,
  today,
  dueSoonDays,
  peutDeplacer,
  sousTitre,
  onOuvrir,
  onDeplacer,
  idMenu,
}: {
  t: TacheCalendrierUI;
  today: string;
  dueSoonDays: number;
  peutDeplacer: boolean;
  sousTitre: string | null;
  onOuvrir: () => void;
  onDeplacer: (jour: string) => void;
  idMenu: string;
}): React.ReactElement {
  const etat = etatEcheance(t, today, dueSoonDays);
  const options = peutDeplacer ? optionsEcheance(t, today) : [];
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onOuvrir}
        className="flex min-w-0 flex-col items-start text-left"
      >
        <span
          className={`text-sm font-medium ${t.done ? 'text-[var(--foreground-muted)] line-through' : ''}`}
        >
          {t.isMilestone ? (
            <>
              <span aria-hidden="true" className="text-[var(--accent)]">
                ◆{' '}
              </span>
              <span className="sr-only">Jalon : </span>
            </>
          ) : null}
          {t.etiquette ? <span className="sr-only">{t.etiquette} : </span> : null}
          <Repere t={t} className="text-[var(--foreground-muted)]" /> {t.title}
          {t.done ? <span className="sr-only"> (terminée)</span> : null}
        </span>
        <span className="text-xs text-[var(--foreground-muted)]">
          {t.isMilestone
            ? 'Jalon'
            : t.etiquette
              ? `${t.etiquette} · ${libelleEtendue(t)}`
              : libelleEtendue(t)}
          {etat ? (
            <span className={etat === 'en_retard' ? 'font-medium text-[var(--danger)]' : ''}>
              {' '}
              · {etat === 'en_retard' ? '⚠ ' : ''}
              {LIBELLES_ECHEANCE[etat]}
            </span>
          ) : null}
          {sousTitre ? ` · ${sousTitre}` : null}
        </span>
      </button>
      {options.length > 0 ? (
        <span className="shrink-0">
          <label htmlFor={idMenu} className="sr-only">
            Déplacer l’échéance de {nomElement(t)} (actuellement {formatJour(t.dueDate)})
          </label>
          <select
            id={idMenu}
            value=""
            onChange={(e) => {
              const o = options.find((x) => x.id === e.target.value);
              if (o) onDeplacer(o.jour);
            }}
            className="max-w-[14rem] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs"
          >
            <option value="">Déplacer l’échéance…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      ) : null}
    </li>
  );
}

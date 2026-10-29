'use client';

// Onglet « Chronologie » (Gantt) d'un projet (ADR-0039 § 8, lot L3b). Rendu SVG
// maison, aucune bibliothèque. Les décisions (lignes, conflits, échelle,
// géométrie, gestes) vivent dans `gantt-model.ts` et `ganttRows` (partagé).
//
// - Barres début → échéance, losanges pour les jalons, flèches fin → début.
// - Conflit de dates : barre et flèche en rouge ET pointillées, mention
//   « ⚠ Conflit » et phrase sous le graphique. Rien n'est décalé tout seul.
// - Déplacer (barre) ou étirer (poignées) change les dates ; au clavier, sur
//   une barre : ← → déplacent, Maj + ← → étirent l'échéance, Alt + ← → le
//   début, Entrée valide, Échap annule. Un clic ouvre le panneau de la tâche.
// - Seule la zone du graphique défile horizontalement ; les noms restent fixes.
// - Lecture seule sous 768 px (§ 8) : un toucher ouvre la tâche.

import { ganttRows, type GanttRow, type WorkTaskView } from '@lalanda/shared/work';
import { Skeleton } from '@lalanda/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { BOUTON_PETIT } from './elements';
import {
  ECHELLES,
  HAUTEUR_BARRE,
  HAUTEUR_ENTETE,
  HAUTEUR_LIGNE,
  POIGNEE,
  barres,
  bornes,
  corpsDates,
  descriptionBarre,
  domaine,
  fleches,
  gesteClavier,
  graduations,
  hauteurGraphique,
  joursDepuisPixels,
  largeurGraphique,
  libelleGeste,
  nouvellesDates,
  phrasesConflits,
  pointsLosange,
  xAujourdhui,
  type Echelle,
  type ModeGeste,
} from './gantt-model';
import { useProjet } from './project-context';
import { formatJour } from './projets-model';

interface Geste {
  taskId: string;
  mode: ModeGeste;
  delta: number;
}

interface Pointeur extends Geste {
  pointerId: number;
  x0: number;
  /** Le pointeur a bougé au-delà du seuil : ce n'est plus un clic. */
  bouge: boolean;
}

const SEUIL_CLIC = 4;

/** Vrai à partir de 768 px (faux au premier rendu : lecture seule par défaut). */
function useBureau(): boolean {
  const [bureau, setBureau] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const maj = () => setBureau(mq.matches);
    maj();
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return bureau;
}

export function VueChronologie(): React.ReactElement {
  const {
    project,
    tasks,
    today,
    chargement,
    travailler,
    ouvrirTache,
    setTasks,
    appliquerEcriture,
    signalerErreur,
    recharger,
  } = useProjet();
  const bureau = useBureau();
  const editable = travailler && bureau;
  const [echelle, setEchelle] = useState<Echelle>('jour');
  const [pointeur, setPointeur] = useState<Pointeur | null>(null);
  const [clavier, setClavier] = useState<Geste | null>(null);
  const [annonce, setAnnonce] = useState('');
  const defile = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  const parId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const layout = useMemo(() => ganttRows(tasks), [tasks]);
  const dom = useMemo(() => domaine(layout.rows, today, echelle), [layout.rows, today, echelle]);
  const conflits = useMemo(() => phrasesConflits(tasks), [tasks]);

  // Aperçu du geste en cours : l'ordre des lignes ne bouge pas pendant le geste.
  const geste: Geste | null = pointeur ?? clavier;
  const rows = useMemo<GanttRow[]>(() => {
    if (geste === null) return layout.rows;
    return layout.rows.map((r) => {
      const t = parId.get(r.taskId);
      if (r.taskId !== geste.taskId || !t) return r;
      const b = bornes({
        ...nouvellesDates(t, geste.mode, geste.delta),
        isMilestone: t.isMilestone,
      });
      return b ? { ...r, ...b } : r;
    });
  }, [layout.rows, geste, parId]);

  const geo = useMemo(() => barres(rows, dom, echelle), [rows, dom, echelle]);
  const traits = useMemo(() => fleches(rows, geo), [rows, geo]);
  const grad = useMemo(() => graduations(dom, echelle), [dom, echelle]);
  const largeur = largeurGraphique(dom, echelle);
  const hauteur = hauteurGraphique(rows.length);
  const xAuj = xAujourdhui(today, dom, echelle);

  // Ouvre la zone sur aujourd'hui (au premier rendu et à chaque changement d'échelle).
  useEffect(() => {
    const el = defile.current;
    if (el === null || xAuj === null) return;
    el.scrollLeft = Math.max(0, xAuj - el.clientWidth / 3);
    // Seulement quand l'échelle ou le domaine changent, pas pendant un geste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echelle, dom.debut]);

  if (project === null) {
    return chargement ? <Skeleton className="h-96 w-full" /> : <></>;
  }

  function enregistrer(g: Geste): void {
    const t = parId.get(g.taskId);
    if (!t) return;
    const dates = nouvellesDates(t, g.mode, g.delta);
    const corps = corpsDates(t, dates);
    if (corps === null) return;
    setTasks((liste) => liste.map((x) => (x.id === t.id ? { ...x, ...dates } : x)));
    setAnnonce(`#${t.number} : ${datesEnMots(dates.startDate, dates.dueDate)}.`);
    workApi
      .patchTask(t.id, corps)
      .then(appliquerEcriture)
      .catch((err: unknown) => {
        signalerErreur(err, 'Impossible de modifier les dates.');
        recharger();
      });
  }

  function debutPointeur(e: React.PointerEvent, t: WorkTaskView, mode: ModeGeste): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!editable) return; // lecture seule : le clic ouvrira la tâche
    svg.current?.setPointerCapture(e.pointerId);
    setClavier(null);
    setPointeur({
      taskId: t.id,
      mode,
      delta: 0,
      pointerId: e.pointerId,
      x0: e.clientX,
      bouge: false,
    });
  }

  function mouvement(e: React.PointerEvent): void {
    if (pointeur === null || e.pointerId !== pointeur.pointerId) return;
    const dx = e.clientX - pointeur.x0;
    const bouge = pointeur.bouge || Math.abs(dx) >= SEUIL_CLIC;
    const delta = joursDepuisPixels(dx, echelle);
    if (bouge !== pointeur.bouge || delta !== pointeur.delta)
      setPointeur({ ...pointeur, bouge, delta });
  }

  function finPointeur(e: React.PointerEvent): void {
    if (pointeur === null || e.pointerId !== pointeur.pointerId) return;
    const p = pointeur;
    setPointeur(null);
    if (!p.bouge) ouvrirTache(p.taskId);
    else if (p.delta !== 0) enregistrer(p);
  }

  function touche(e: React.KeyboardEvent, t: WorkTaskView): void {
    const enCours = clavier?.taskId === t.id ? clavier : null;
    if (e.key === 'Escape' && enCours) {
      e.preventDefault();
      setClavier(null);
      setAnnonce('Modification annulée.');
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (enCours) {
        setClavier(null);
        enregistrer(enCours);
      } else {
        ouvrirTache(t.id);
      }
      return;
    }
    if (!editable) return;
    const g = gesteClavier(e.key, { shift: e.shiftKey, alt: e.altKey }, t.isMilestone);
    if (g === null) return;
    e.preventDefault();
    const delta = (enCours && enCours.mode === g.mode ? enCours.delta : 0) + g.delta;
    if (delta === 0) {
      setClavier(null);
      setAnnonce('Dates inchangées.');
      return;
    }
    const suivant = { taskId: t.id, mode: g.mode, delta };
    setClavier(suivant);
    const d = nouvellesDates(t, g.mode, delta);
    setAnnonce(
      `${libelleGeste(g.mode, delta)} — ${datesEnMots(d.startDate, d.dueDate)}. Entrée pour valider, Échap pour annuler.`,
    );
  }

  const px = largeur / dom.jours;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Échelle" className="flex">
          {ECHELLES.map((e, i) => (
            <button
              key={e.cle}
              type="button"
              aria-pressed={echelle === e.cle}
              onClick={() => setEchelle(e.cle)}
              className={`${BOUTON_PETIT} ${i === 0 ? 'rounded-r-none' : i === ECHELLES.length - 1 ? '-ml-px rounded-l-none' : '-ml-px rounded-none'} aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent)]`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={BOUTON_PETIT}
          onClick={() => {
            const el = defile.current;
            if (el && xAuj !== null) el.scrollTo({ left: Math.max(0, xAuj - el.clientWidth / 3) });
          }}
        >
          Aller à aujourd’hui
        </button>
      </div>

      <p className="text-xs text-[var(--foreground-muted)]">
        {!bureau
          ? 'Lecture seule sur téléphone : touchez une tâche pour l’ouvrir et changer ses dates.'
          : editable
            ? 'Glissez une barre pour la déplacer, ses bords pour l’étirer. Au clavier, sur une barre : ← → déplacent, Maj + ← → étirent l’échéance, Alt + ← → le début ; Entrée valide, Échap annule.'
            : 'Cliquez une barre pour ouvrir la tâche.'}
      </p>
      <p className="sr-only" aria-live="polite">
        {annonce}
      </p>

      {layout.rows.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-sm text-[var(--foreground-muted)]">
          Aucune tâche datée. Donnez une date de début ou une échéance à une tâche (onglet Liste ou
          panneau de tâche) pour la voir sur la chronologie.
        </p>
      ) : (
        <div className="flex min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {/* Noms des tâches : fixes, hors de la zone qui défile. */}
          <ul
            className="w-32 shrink-0 border-r border-[var(--border)] sm:w-56"
            aria-label="Tâches planifiées"
          >
            <li
              aria-hidden="true"
              style={{ height: HAUTEUR_ENTETE }}
              className="flex items-end border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 pb-1 text-xs font-medium text-[var(--foreground-muted)]"
            >
              Tâche
            </li>
            {rows.map((r) => {
              const t = parId.get(r.taskId);
              if (!t) return null;
              return (
                <li
                  key={r.taskId}
                  style={{ height: HAUTEUR_LIGNE }}
                  className="flex items-center border-b border-[var(--border)] last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => ouvrirTache(t.id)}
                    className={`flex min-w-0 flex-1 items-center gap-1 px-2 text-left text-xs ${r.depth === 1 ? 'pl-5' : ''}`}
                    title={descriptionBarre(t, r)}
                  >
                    {r.shape === 'milestone' ? (
                      <span aria-hidden="true" className="text-[var(--accent)]">
                        ◆
                      </span>
                    ) : null}
                    <span
                      className={`truncate ${t.done ? 'text-[var(--foreground-muted)] line-through' : ''}`}
                    >
                      <span className="text-[var(--foreground-muted)]">#{t.number}</span> {t.title}
                    </span>
                    {r.conflict ? (
                      <span className="ml-auto shrink-0 font-medium text-[var(--danger)]">
                        <span aria-hidden="true">⚠</span>
                        <span className="sr-only"> conflit de dates</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Zone du graphique : seul endroit qui défile horizontalement. */}
          <div
            ref={defile}
            className="relative min-w-0 flex-1 overflow-x-auto"
            role="region"
            aria-label="Chronologie du projet (défilement horizontal)"
            tabIndex={0}
          >
            <svg
              ref={svg}
              width={largeur}
              height={hauteur}
              className="block select-none"
              style={{ touchAction: pointeur ? 'none' : 'pan-x pan-y' }}
              onPointerMove={mouvement}
              onPointerUp={finPointeur}
              onPointerCancel={() => setPointeur(null)}
            >
              <title>Chronologie du projet {project.name}</title>
              <defs>
                <marker
                  id="gantt-fleche"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" style={{ fill: 'var(--foreground-muted)' }} />
                </marker>
                <marker
                  id="gantt-fleche-conflit"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" style={{ fill: 'var(--danger)' }} />
                </marker>
              </defs>

              {/* Fond : bandes de lignes, week-ends, graduations. */}
              <rect
                x={0}
                y={0}
                width={largeur}
                height={HAUTEUR_ENTETE}
                style={{ fill: 'var(--surface-muted)' }}
              />
              {rows.map((r, i) =>
                i % 2 === 1 ? (
                  <rect
                    key={`bande-${r.taskId}`}
                    x={0}
                    y={HAUTEUR_ENTETE + i * HAUTEUR_LIGNE}
                    width={largeur}
                    height={HAUTEUR_LIGNE}
                    style={{ fill: 'var(--surface-muted)', opacity: 0.5 }}
                  />
                ) : null,
              )}
              {grad.mineures.map((g) => (
                <g key={`min-${g.jour}`} aria-hidden="true">
                  {g.weekend ? (
                    <rect
                      x={g.x}
                      y={HAUTEUR_ENTETE}
                      width={px}
                      height={hauteur - HAUTEUR_ENTETE}
                      style={{ fill: 'var(--surface-muted)' }}
                    />
                  ) : null}
                  <line
                    x1={g.x}
                    x2={g.x}
                    y1={22}
                    y2={hauteur}
                    style={{ stroke: 'var(--border)' }}
                  />
                  <text
                    x={g.x + 3}
                    y={37}
                    fontSize={10}
                    style={{ fill: 'var(--foreground-muted)' }}
                  >
                    {g.label}
                  </text>
                </g>
              ))}
              {grad.majeures.map((g) => (
                <g key={`maj-${g.jour}`} aria-hidden="true">
                  <line
                    x1={g.x}
                    x2={g.x}
                    y1={0}
                    y2={HAUTEUR_ENTETE}
                    style={{ stroke: 'var(--border-strong)' }}
                  />
                  <text
                    x={g.x + 4}
                    y={15}
                    fontSize={11}
                    fontWeight={600}
                    style={{ fill: 'var(--foreground)' }}
                  >
                    {g.label}
                  </text>
                </g>
              ))}
              <line
                x1={0}
                x2={largeur}
                y1={HAUTEUR_ENTETE}
                y2={HAUTEUR_ENTETE}
                style={{ stroke: 'var(--border)' }}
              />

              {/* Aujourd'hui : trait ET libellé. */}
              {xAuj !== null ? (
                <g aria-hidden="true">
                  <line
                    x1={xAuj}
                    x2={xAuj}
                    y1={20}
                    y2={hauteur}
                    strokeWidth={2}
                    style={{ stroke: 'var(--accent)' }}
                  />
                  {/* Pastille dans l'étage des mois : ne chevauche pas les numéros de jour. */}
                  <rect
                    x={xAuj - 33}
                    y={3}
                    width={66}
                    height={16}
                    rx={8}
                    style={{ fill: 'var(--accent)' }}
                  />
                  <text
                    x={xAuj}
                    y={14.5}
                    fontSize={10}
                    fontWeight={600}
                    textAnchor="middle"
                    style={{ fill: 'var(--accent-foreground)' }}
                  >
                    Aujourd’hui
                  </text>
                </g>
              ) : null}

              {/* Flèches de dépendance (fin → début). */}
              <g aria-hidden="true" fill="none">
                {traits.map((f) => (
                  <path
                    key={`${f.de}-${f.vers}`}
                    d={f.d}
                    strokeWidth={f.conflit ? 2 : 1.25}
                    strokeDasharray={f.conflit ? '4 3' : undefined}
                    markerEnd={`url(#${f.conflit ? 'gantt-fleche-conflit' : 'gantt-fleche'})`}
                    style={{ stroke: f.conflit ? 'var(--danger)' : 'var(--foreground-muted)' }}
                  />
                ))}
              </g>

              {/* Barres et jalons. */}
              {geo.map((b) => {
                const t = parId.get(b.taskId);
                if (!t) return null;
                const row = rows[b.index]!;
                const enCours = geste?.taskId === t.id;
                const remplissage = t.done
                  ? 'var(--surface-muted)'
                  : b.depth === 1
                    ? 'var(--accent-soft)'
                    : 'var(--accent)';
                const contour = b.conflit
                  ? 'var(--danger)'
                  : t.done
                    ? 'var(--border-strong)'
                    : 'var(--accent)';
                const yBarre = b.yLigne + (HAUTEUR_LIGNE - HAUTEUR_BARRE) / 2;
                const libelle = `${descriptionBarre(t, row)}${editable ? '. Flèches pour modifier les dates, Entrée pour valider ou ouvrir.' : '. Entrée pour ouvrir.'}`;
                return (
                  <g
                    key={b.taskId}
                    role="button"
                    tabIndex={0}
                    aria-label={libelle}
                    onKeyDown={(e) => touche(e, t)}
                    onBlur={() => {
                      if (clavier?.taskId === t.id) setClavier(null);
                    }}
                    onPointerDown={(e) => debutPointeur(e, t, 'deplacer')}
                    onClick={() => {
                      if (!editable) ouvrirTache(t.id);
                    }}
                    className="outline-none focus-visible:[&>.focus]:opacity-100"
                    style={{ cursor: editable ? 'grab' : 'pointer' }}
                  >
                    <title>{descriptionBarre(t, row)}</title>
                    {/* Anneau de focus visible (le `outline` ne s'applique pas au SVG partout). */}
                    <rect
                      className="focus opacity-0"
                      x={b.x - 3}
                      y={b.yLigne + 3}
                      width={b.largeur + 6}
                      height={HAUTEUR_LIGNE - 6}
                      rx={6}
                      fill="none"
                      strokeWidth={2}
                      style={{ stroke: 'var(--focus)' }}
                    />
                    {b.forme === 'milestone' ? (
                      <polygon
                        points={pointsLosange(b)}
                        strokeWidth={b.conflit ? 2 : 1.5}
                        strokeDasharray={b.conflit ? '3 2' : undefined}
                        style={{
                          fill: t.done ? 'var(--surface-muted)' : 'var(--surface)',
                          stroke: contour,
                        }}
                      />
                    ) : (
                      <>
                        <rect
                          x={b.x + 1}
                          y={yBarre}
                          width={Math.max(2, b.largeur - 2)}
                          height={HAUTEUR_BARRE}
                          rx={4}
                          strokeWidth={b.conflit ? 2 : 1}
                          strokeDasharray={b.conflit ? '4 2' : undefined}
                          style={{
                            fill: remplissage,
                            stroke: contour,
                            opacity: enCours ? 0.75 : 1,
                          }}
                        />
                        {editable ? (
                          <>
                            <rect
                              x={b.x}
                              y={yBarre}
                              width={POIGNEE}
                              height={HAUTEUR_BARRE}
                              fill="transparent"
                              style={{ cursor: 'ew-resize' }}
                              onPointerDown={(e) => debutPointeur(e, t, 'debut')}
                            />
                            <rect
                              x={b.x + b.largeur - POIGNEE}
                              y={yBarre}
                              width={POIGNEE}
                              height={HAUTEUR_BARRE}
                              fill="transparent"
                              style={{ cursor: 'ew-resize' }}
                              onPointerDown={(e) => debutPointeur(e, t, 'fin')}
                            />
                          </>
                        ) : null}
                      </>
                    )}
                    {t.done ? (
                      <text
                        x={b.xSortie + 4}
                        y={b.yMilieu + 4}
                        fontSize={10}
                        aria-hidden="true"
                        style={{ fill: 'var(--foreground-muted)' }}
                      >
                        ✓ terminée
                      </text>
                    ) : null}
                    {b.conflit ? (
                      <text
                        x={b.xSortie + (t.done ? 64 : 4)}
                        y={b.yMilieu + 4}
                        fontSize={10}
                        fontWeight={600}
                        aria-hidden="true"
                        style={{ fill: 'var(--danger)' }}
                      >
                        ⚠ Conflit
                      </text>
                    ) : null}
                    {enCours && geste.delta !== 0 ? (
                      <text
                        x={b.x}
                        y={b.yLigne + 9}
                        fontSize={10}
                        fontWeight={600}
                        aria-hidden="true"
                        style={{ fill: 'var(--foreground)' }}
                      >
                        {libelleGeste(geste.mode, geste.delta)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-muted)]"
        aria-label="Légende"
      >
        <li>
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-2.5 w-5 rounded-sm bg-[var(--accent)] align-middle"
          />
          Tâche (début → échéance)
        </li>
        <li>
          <span aria-hidden="true" className="mr-1 text-[var(--accent)]">
            ◆
          </span>
          Jalon
        </li>
        <li>
          <span aria-hidden="true" className="mr-1">
            ─▸
          </span>
          Dépendance (fin → début)
        </li>
        <li className="text-[var(--danger)]">
          <span aria-hidden="true" className="mr-1">
            ┄▸ ⚠
          </span>
          Conflit de dates (pointillé)
        </li>
        <li>
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-3 w-0.5 bg-[var(--accent)] align-middle"
          />
          Aujourd’hui ({formatJour(today)})
        </li>
      </ul>

      {conflits.length > 0 ? (
        <section
          aria-labelledby="gantt-conflits"
          className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-3 text-sm"
        >
          <h3 id="gantt-conflits" className="font-semibold text-[var(--danger)]">
            <span aria-hidden="true">⚠ </span>
            {conflits.length} conflit{conflits.length > 1 ? 's' : ''} de dates
          </h3>
          <p className="text-xs">
            Une tâche commence avant la fin de la tâche qu’elle attend. Rien n’est décalé
            automatiquement : ajustez les dates si besoin.
          </p>
          <ul className="flex flex-col gap-1">
            {conflits.map((c, i) => (
              <li key={`${c.taskId}-${i}`}>
                <button
                  type="button"
                  onClick={() => ouvrirTache(c.taskId)}
                  className="text-left underline-offset-2 hover:underline"
                >
                  {c.texte}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {layout.unscheduled.length > 0 ? (
        <section aria-labelledby="gantt-non-planifiees" className="flex flex-col gap-1.5 text-sm">
          <h3 id="gantt-non-planifiees" className="font-semibold">
            Non planifiées ({layout.unscheduled.length})
          </h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            Ces tâches n’ont ni date de début ni échéance.
          </p>
          <ul className="flex flex-col gap-1">
            {layout.unscheduled.map((taskId) => {
              const t = parId.get(taskId);
              if (!t) return null;
              return (
                <li key={taskId}>
                  <button
                    type="button"
                    onClick={() => ouvrirTache(taskId)}
                    className="text-left underline-offset-2 hover:underline"
                  >
                    <span className="text-[var(--foreground-muted)]">#{t.number}</span> {t.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function datesEnMots(startDate: string | null, dueDate: string | null): string {
  if (startDate && dueDate && startDate !== dueDate) {
    return `du ${formatJour(startDate)} au ${formatJour(dueDate)}`;
  }
  if (dueDate) return `échéance le ${formatJour(dueDate)}`;
  return startDate ? `début le ${formatJour(startDate)}` : 'sans date';
}

'use client';

// Modal d'entrée du modèle générique (S23b) — deux chemins, puis le questionnaire
// de cadrage.
//
// ── Les deux titres ────────────────────────────────────────────
// « Commencer directement » et « En savoir plus » ne disent rien de ce que
// l'utilisateur obtient : l'un décrit un geste, l'autre une promesse vague. Les
// deux titres retenus nomment chacun le LIVRABLE avec lequel on repart — un plan
// financier, ou un Business Model Canvas suivi du plan. C'est la seule chose qui
// permet de choisir sans avoir essayé.
//
// ── On reste dans le modal ─────────────────────────────────────
// Explicite dans la demande. Le questionnaire ne navigue nulle part : il remplace
// le contenu du même dialogue, garde son propre état, et ne crée le projet qu'à
// la sortie — quelle que soit la sortie.
//
// ── Aucun piège ────────────────────────────────────────────────
// Trois échappatoires, à toutes les étapes : « Passer cette question » (avance
// sans rien écrire), « Passer à la saisie » (termine tout de suite avec ce qui a
// été répondu), et le retour aux deux choix (garde les réponses). Un
// questionnaire de quinze écrans dont on ne peut pas sortir est un piège, et
// personne ne revient d'un piège.
//
// ── Ce que ce fichier NE fait pas ──────────────────────────────
// Il ne dérive aucun montant d'une phrase. Les champs numériques sont rendus par
// `WizardField`, le composant de l'assistant, avec la validation, les bornes,
// l'unité et le badge « Valeur suggérée » du driver. Voir la note en tête de
// `custom-questionnaire-model.ts`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Infobulle } from '@/components/infobulle';
import { api, type CanvasBlocks, type TemplateDriverMeta, type TemplateMeta } from '@/lib/api';

import {
  buildCanvasBlocks,
  buildDriverValues,
  compterCartes,
  nomProjet,
  questionsAffichables,
  type QuestionCadrage,
  type Reponses,
} from './custom-questionnaire-model';
import { WizardField } from './wizard-field';
import { toDisplayString } from './wizard-model';

/** Ce que le questionnaire remet à la page de création, à sa sortie. */
export interface CadrageResultat {
  nom: string;
  blocs: CanvasBlocks;
  driverValues: Record<string, number>;
  nbCartes: number;
}

interface CustomStartModalProps {
  /** Nom déjà tapé dans le formulaire de création — sert d'amorce à la question 1. */
  nomInitial: string;
  /** Fermeture sans rien créer (croix, Échap, clic sur le fond). */
  onFermer: () => void;
  /** Choix « plan financier tout de suite » : la page reprend la main. */
  onDirect: () => void;
  /**
   * Sortie du questionnaire — fin normale ou anticipée. La page crée le projet,
   * écrit le Canvas, pose les drivers et navigue. Une promesse rejetée laisse le
   * modal ouvert avec le message d'erreur et TOUTES les réponses intactes.
   */
  onCadrageTermine: (resultat: CadrageResultat) => Promise<void>;
}

type Mode = 'choix' | 'questionnaire';

export function CustomStartModal({
  nomInitial,
  onFermer,
  onDirect,
  onCadrageTermine,
}: CustomStartModalProps): React.ReactElement {
  const [mode, setMode] = useState<Mode>('choix');
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [chargementTemplate, setChargementTemplate] = useState(false);
  const [index, setIndex] = useState(0);
  const [reponses, setReponses] = useState<Record<string, string>>(
    nomInitial.trim() ? { nom_projet: nomInitial.trim() } : {},
  );
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const titreRef = useRef<HTMLHeadingElement>(null);

  // Échap ferme le dialogue — jamais au milieu d'un envoi, qui a déjà commencé
  // à écrire côté serveur.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !envoi) onFermer();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFermer, envoi]);

  // Le modèle générique est chargé une seule fois, à l'entrée du questionnaire :
  // ce sont SES drivers qui donnent aux questions numériques leur libellé, leur
  // unité et leurs bornes. Rien n'est recopié ici.
  const chargerTemplate = useCallback(async (): Promise<void> => {
    if (template || chargementTemplate) return;
    setChargementTemplate(true);
    try {
      const { template: t } = await api.getTemplate('custom');
      setTemplate(t);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Impossible de charger le modèle.');
    } finally {
      setChargementTemplate(false);
    }
  }, [template, chargementTemplate]);

  const drivers: TemplateDriverMeta[] = useMemo(() => template?.drivers ?? [], [template]);
  const questions = useMemo(() => questionsAffichables(drivers), [drivers]);
  const question = questions[index];
  const total = questions.length;
  const derniere = index === total - 1;

  // Focus sur le titre de l'étape à chaque changement : le lecteur d'écran annonce
  // la nouvelle question, et le clavier repart du haut du dialogue.
  useEffect(() => {
    if (mode === 'questionnaire') titreRef.current?.focus();
  }, [mode, index]);

  const nom = nomProjet(reponses);
  const blocs = useMemo(() => buildCanvasBlocks(reponses), [reponses]);
  const driverValues = useMemo(() => buildDriverValues(reponses, drivers), [reponses, drivers]);
  const nbCartes = compterCartes(blocs);

  function repondre(id: string, valeur: string): void {
    setReponses((r) => ({ ...r, [id]: valeur }));
  }

  /** Avance sans écrire : la question passée ne produit ni carte ni driver. */
  function passer(): void {
    if (derniere) void terminer();
    else setIndex((i) => Math.min(i + 1, total - 1));
  }

  async function terminer(): Promise<void> {
    if (!nom) {
      setErreur('Donnez d’abord un nom à votre projet — c’est le seul champ obligatoire.');
      setIndex(0);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await onCadrageTermine({ nom, blocs, driverValues, nbCartes });
      // Succès : la page navigue. On ne remet pas `envoi` à false, pour ne pas
      // rendre les boutons cliquables une seconde fois pendant la transition.
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'La création du projet a échoué.');
      setEnvoi(false);
    }
  }

  return (
    <div
      // `w-[100vw]` et non `inset-0` : mesuré à 375 px, la page de création
      // déborde horizontalement (le menu de compte de l'en-tête sort de 16 px).
      // Un `inset-0` s'étire alors sur la zone de débordement — 391 px — et la
      // croix de fermeture du dialogue passe HORS ÉCRAN, sur l'écran même où
      // elle est vitale. `100vw` vaut la fenêtre, débordement ou pas.
      className="fixed left-0 top-0 z-50 flex h-[100dvh] w-[100vw] items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        // Uniquement le fond : un glissé commencé DANS le dialogue et relâché
        // dehors ne doit pas le fermer (sélection de texte).
        if (e.target === e.currentTarget && !envoi) onFermer();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Démarrer un projet dans un secteur personnalisé"
        className={[
          'flex w-full flex-col bg-[var(--surface)] shadow-2xl',
          // Sous 640 px : plein écran, `dvh` et non `vh` — la barre d'adresse
          // mobile mangerait sinon les boutons de navigation, qui sont
          // précisément ce qui permet de sortir.
          'h-[100dvh] rounded-none border-0',
          'sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-[var(--border)]',
        ].join(' ')}
      >
        {mode === 'choix' ? (
          <EcranChoix
            enCours={chargementTemplate}
            onFermer={onFermer}
            onDirect={onDirect}
            onQuestionnaire={() => {
              setErreur(null);
              void chargerTemplate();
              setMode('questionnaire');
            }}
            erreur={erreur}
            dejaRepondu={nbCartes > 0 || Object.keys(driverValues).length > 0}
          />
        ) : (
          <EcranQuestionnaire
            titreRef={titreRef}
            question={question}
            index={index}
            total={total}
            reponses={reponses}
            drivers={drivers}
            chargement={chargementTemplate || questions.length === 0}
            envoi={envoi}
            erreur={erreur}
            nom={nom}
            nbCartes={nbCartes}
            nbDrivers={Object.keys(driverValues).length}
            onRepondre={repondre}
            onPrecedent={() => setIndex((i) => Math.max(i - 1, 0))}
            onSuivant={() => (derniere ? void terminer() : setIndex((i) => i + 1))}
            onPasser={passer}
            onTerminer={() => void terminer()}
            onRetourChoix={() => {
              setErreur(null);
              setMode('choix');
            }}
            derniere={derniere}
          />
        )}
      </div>
    </div>
  );
}

// ─── Écran 1 — les deux chemins ──────────────────────────────

function EcranChoix({
  onFermer,
  onDirect,
  onQuestionnaire,
  enCours,
  erreur,
  dejaRepondu,
}: {
  onFermer: () => void;
  onDirect: () => void;
  onQuestionnaire: () => void;
  enCours: boolean;
  erreur: string | null;
  dejaRepondu: boolean;
}): React.ReactElement {
  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Votre secteur n’est pas dans la liste
          </h2>
          <p className="text-sm text-[var(--foreground-muted)]">Par quoi voulez-vous commencer ?</p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          className="-mr-1 -mt-1 rounded-md p-1.5 text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)]"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-col gap-3 overflow-y-auto px-5 py-5">
        {erreur ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
          >
            {erreur}
          </p>
        ) : null}

        <CarteChoix
          titre="Mon plan financier, tout de suite"
          description="Vous connaissez déjà votre chiffre d’affaires et vos charges. Vous entrez dans l’assistant de saisie et commencez par le chiffre d’affaires, comme sur les modèles sectoriels."
          onClick={onDirect}
        />
        <CarteChoix
          titre="Mon Business Model Canvas d’abord"
          description="Une quinzaine de questions sur votre projet, une par écran. À la fin, votre Canvas est rempli et votre plan financier part avec les chiffres que vous aurez donnés. Vous pouvez sortir à tout moment."
          badge={dejaRepondu ? 'Reprendre' : undefined}
          onClick={onQuestionnaire}
          enCours={enCours}
        />
      </div>
    </>
  );
}

function CarteChoix({
  titre,
  description,
  onClick,
  badge,
  enCours = false,
}: {
  titre: string;
  description: string;
  onClick: () => void;
  badge?: string;
  enCours?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={enCours}
      className="group flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-left transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-base font-semibold tracking-tight">{titre}</span>
        {badge ? (
          <span className="shrink-0 rounded-full border border-[var(--accent)]/40 px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] text-[var(--accent)]">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-sm leading-snug text-[var(--foreground-muted)]">{description}</span>
      <span
        aria-hidden="true"
        className="mt-1 text-sm font-medium text-[var(--accent)] transition group-hover:translate-x-0.5"
      >
        {enCours ? 'Chargement…' : 'Choisir →'}
      </span>
    </button>
  );
}

// ─── Écran 2 — le questionnaire, un champ par étape ──────────

function EcranQuestionnaire({
  titreRef,
  question,
  index,
  total,
  reponses,
  drivers,
  chargement,
  envoi,
  erreur,
  nom,
  nbCartes,
  nbDrivers,
  onRepondre,
  onPrecedent,
  onSuivant,
  onPasser,
  onTerminer,
  onRetourChoix,
  derniere,
}: {
  titreRef: React.RefObject<HTMLHeadingElement | null>;
  question: QuestionCadrage | undefined;
  index: number;
  total: number;
  reponses: Reponses;
  drivers: TemplateDriverMeta[];
  chargement: boolean;
  envoi: boolean;
  erreur: string | null;
  nom: string;
  nbCartes: number;
  nbDrivers: number;
  onRepondre: (id: string, valeur: string) => void;
  onPrecedent: () => void;
  onSuivant: () => void;
  onPasser: () => void;
  onTerminer: () => void;
  onRetourChoix: () => void;
  derniere: boolean;
}): React.ReactElement {
  if (chargement || !question) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-[var(--foreground-muted)]">Chargement des questions…</p>
      </div>
    );
  }

  // Le nom du projet est la seule réponse obligatoire : sans lui, aucun projet ne
  // peut être créé, donc aucune sortie n'est possible. Toutes les autres peuvent
  // être passées.
  const nomManquant = question.kind === 'nom_projet' && nom === '';
  const pourcentage = Math.round(((index + 1) / total) * 100);

  return (
    <>
      <header className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
            Étape <span className="fig text-[var(--foreground)]">{index + 1}</span> sur{' '}
            <span className="fig text-[var(--foreground)]">{total}</span>
          </p>
          <button
            type="button"
            onClick={onRetourChoix}
            disabled={envoi}
            className="text-xs text-[var(--foreground-muted)] underline underline-offset-2 transition hover:text-[var(--accent)] disabled:opacity-40"
          >
            Revenir aux deux choix
          </button>
        </div>
        {/* Progression : barre + compteur textuel. Le pourcentage n'est jamais la
            seule information — il est doublé par « Étape n sur N » ci-dessus. */}
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-label="Progression du questionnaire"
          className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]"
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
            style={{ width: `${pourcentage}%` }}
          />
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        <div className="flex flex-col gap-1">
          <h2
            ref={titreRef}
            tabIndex={-1}
            className="font-display text-lg font-semibold leading-snug tracking-tight outline-none"
          >
            {question.question}
          </h2>
          {question.kind !== 'nombre' ? (
            <p className="text-sm leading-snug text-[var(--foreground-muted)]">{question.aide}</p>
          ) : null}
        </div>

        {erreur ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
          >
            {erreur}
          </p>
        ) : null}

        <ChampQuestion
          question={question}
          reponses={reponses}
          drivers={drivers}
          onRepondre={onRepondre}
        />

        <RecapPreremplissage nbCartes={nbCartes} nbDrivers={nbDrivers} />
      </div>

      <footer className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onPrecedent}
            disabled={index === 0 || envoi}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
          >
            ← Précédent
          </button>
          <div className="flex items-center gap-2">
            {/* Passer n'est pas offert sur le nom : sans nom, pas de projet. */}
            {question.kind !== 'nom_projet' ? (
              <button
                type="button"
                onClick={onPasser}
                disabled={envoi}
                className="rounded-md px-2.5 py-2.5 text-sm text-[var(--foreground-muted)] underline underline-offset-2 transition hover:text-[var(--foreground)] disabled:opacity-40"
              >
                Passer
              </button>
            ) : null}
            <button
              type="button"
              onClick={derniere ? onTerminer : onSuivant}
              disabled={nomManquant || envoi}
              className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
            >
              {envoi ? 'Création…' : derniere ? 'Terminer →' : 'Suivant →'}
            </button>
          </div>
        </div>

        {/* Échappatoire permanente. Elle ne jette rien : tout ce qui a été
            répondu part avec le projet. */}
        <button
          type="button"
          onClick={onTerminer}
          disabled={nom === '' || envoi}
          className="text-xs text-[var(--foreground-muted)] underline underline-offset-2 transition hover:text-[var(--accent)] disabled:opacity-40"
        >
          Arrêter ici et passer à la saisie — vos réponses sont conservées →
        </button>
      </footer>
    </>
  );
}

/**
 * Le champ d'une question. Une question numérique est rendue par `WizardField`,
 * le composant de l'assistant : mêmes bornes, même unité, même validation, même
 * badge « Valeur suggérée ». C'est ce qui garantit qu'un chiffre saisi ici est
 * un chiffre saisi comme les autres, et pas une valeur d'une autre nature.
 */
function ChampQuestion({
  question,
  reponses,
  drivers,
  onRepondre,
}: {
  question: QuestionCadrage;
  reponses: Reponses;
  drivers: TemplateDriverMeta[];
  onRepondre: (id: string, valeur: string) => void;
}): React.ReactElement {
  if (question.kind === 'nombre') {
    const driver = drivers.find((d) => d.id === question.driverId);
    if (!driver) return <></>;
    // Tant que l'utilisateur n'a pas touché au champ, il affiche le défaut du
    // modèle et `reponses` reste VIDE pour cette question : rien ne sera posé.
    // Sans cette distinction, passer l'étape reviendrait à saisir le défaut.
    const touche = Object.prototype.hasOwnProperty.call(reponses, question.id);
    const raw = touche ? reponses[question.id]! : toDisplayString(driver, driver.defaut ?? 0);
    return (
      <WizardField
        driver={driver}
        raw={raw}
        provenance={touche ? 'saisi' : 'defaut'}
        onChange={(texte) => onRepondre(question.id, texte)}
        autoFocus
      />
    );
  }

  if (question.kind === 'choix') {
    const valeur = reponses[question.id] ?? '';
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{question.question}</legend>
        {question.options.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm transition ${
              valeur === option
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] hover:border-[var(--accent)]/40'
            }`}
          >
            <input
              type="radio"
              name={question.id}
              value={option}
              checked={valeur === option}
              onChange={() => onRepondre(question.id, option)}
              className="accent-[var(--accent)]"
            />
            <span className="font-medium">{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  const champId = `cadrage-${question.id}`;
  const valeur = reponses[question.id] ?? '';

  if (question.kind === 'nom_projet') {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={champId} className="sr-only">
          {question.question}
        </label>
        <input
          id={champId}
          type="text"
          autoFocus
          maxLength={200}
          placeholder={question.placeholder}
          value={valeur}
          onChange={(e) => onRepondre(question.id, e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2">
        <label htmlFor={champId} className="text-sm font-medium">
          Votre réponse
        </label>
        <Infobulle
          id={`${champId}-aide`}
          texte="Cette réponse rejoint votre Business Model Canvas. Elle ne produit aucun montant : les chiffres se saisissent dans des champs numériques."
          libelle="Où va cette réponse"
        />
      </span>
      <textarea
        id={champId}
        rows={4}
        autoFocus
        maxLength={500}
        placeholder={question.placeholder}
        value={valeur}
        onChange={(e) => onRepondre(question.id, e.target.value)}
        aria-describedby={`${champId}-aide`}
        className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm leading-snug outline-none transition focus:border-[var(--accent)]"
      />
    </div>
  );
}

/** Ce qui sera prérempli si l'on sort maintenant — jamais un chiffre sorti de nulle part. */
function RecapPreremplissage({
  nbCartes,
  nbDrivers,
}: {
  nbCartes: number;
  nbDrivers: number;
}): React.ReactElement | null {
  if (nbCartes === 0 && nbDrivers === 0) return null;
  const parts: string[] = [];
  if (nbCartes > 0) parts.push(`${nbCartes} carte${nbCartes > 1 ? 's' : ''} de Canvas`);
  if (nbDrivers > 0)
    parts.push(
      `${nbDrivers} hypothèse${nbDrivers > 1 ? 's' : ''} financière${nbDrivers > 1 ? 's' : ''}`,
    );
  return (
    <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
      Prêt à être prérempli : {parts.join(' et ')}.
    </p>
  );
}

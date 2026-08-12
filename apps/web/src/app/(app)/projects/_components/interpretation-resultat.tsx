'use client';

// Bulle d'interprétation d'un résultat + accès au chat Lala (S24a).
//
// ── Pourquoi ce n'est PAS le composant `Infobulle` ───────────────────────────
//
// `Infobulle` (saisie) est une bulle FLOTTANTE qui s'ouvre au survol et se ferme
// au `pointerleave` et au `blur`. Elle est parfaite pour une phrase d'aide, et
// structurellement inadaptée ici, pour trois raisons constatées :
//
//  1. **Elle doit contenir un bouton.** Le décideur demande un « Discuter avec
//     Lala » sous chaque interprétation. Une bulle qui se ferme quand le
//     pointeur la quitte, ou quand le déclencheur perd le focus, rend ce bouton
//     inatteignable : on le vise à la souris et la bulle disparaît en route; on
//     tabule vers lui et le `blur` du déclencheur la referme.
//  2. **Le texte est trois à cinq fois plus long.** Une bulle flottante de
//     17 rem posée en `position: absolute` sous une ligne de tableau recouvre
//     les résultats suivants — exactement ce qu'un lecteur de bilan est en train
//     de comparer.
//  3. **Elle sortirait de l'écran.** `Infobulle` corrige déjà l'axe horizontal
//     (`decalageInfobulle`), mais rien ne corrige le débordement VERTICAL d'un
//     paragraphe long ouvert sur la dernière ligne d'une feuille, à 375 px.
//
// D'où le choix : un **panneau dépliant en flux** (`aria-expanded` +
// `aria-controls`), qui pousse le contenu au lieu de le couvrir, ne peut pas
// sortir du cadre, reste ouvert jusqu'à fermeture explicite, et porte donc sans
// difficulté un bouton. Le décideur voulait « des bulles » : la forme visuelle
// reste celle d'une bulle — fond distinct, coin en pointe vers le déclencheur —
// c'est le comportement qui change.
//
// ── Pourquoi les interprétations sont chargées À L'OUVERTURE ─────────────────
//
// Une feuille de résultats porte jusqu'à trente lignes. Les interpréter toutes
// au chargement tronquerait la réponse (plafond de 1024 jetons, S22h) et
// consommerait l'IA pour vingt-huit textes que personne n'ouvrira. On charge
// donc à la demande, et on garde en cache pour la session — la clé inclut la
// valeur, donc un recalcul invalide la lecture d'avant.

import { useCallback, useMemo, useState } from 'react';

import { api, type InterpretationsView, type LineResult } from '@/lib/api';

import { cleInterpretation, etiquetteSource } from './interpretation-model';

/** Contexte moteur commun à toutes les interprétations d'une feuille. */
export interface ContexteInterpretation {
  templateSlug: string;
  sheetId: string;
  sheetLabel: string;
  devise?: string;
  lines: LineResult[];
}

/** Interprétation d'une ligne, telle que l'écran la détient. */
interface Lecture {
  texte: string;
  source: 'llm' | 'fallback';
  avertissementFeuille: string | null;
  mention: string;
}

export interface EtatInterpretations {
  /** Ligne dont la bulle est ouverte, ou `null`. */
  ouvertId: string | null;
  /** Ligne dont le chat est ouvert, ou `null`. */
  chatLigne: LineResult | null;
  basculer: (ligne: LineResult) => void;
  fermer: () => void;
  ouvrirChat: (ligne: LineResult) => void;
  fermerChat: () => void;
  lecture: (ligne: LineResult) => Lecture | undefined;
  enChargement: (ligne: LineResult) => boolean;
  erreur: (ligne: LineResult) => string | undefined;
}

export function useInterpretations(ctx: ContexteInterpretation): EtatInterpretations {
  const [ouvertId, setOuvertId] = useState<string | null>(null);
  const [chatLigne, setChatLigne] = useState<LineResult | null>(null);
  const [lectures, setLectures] = useState<Record<string, Lecture>>({});
  const [chargements, setChargements] = useState<Record<string, boolean>>({});
  const [erreurs, setErreurs] = useState<Record<string, string>>({});

  const cle = useCallback(
    (ligne: LineResult) => cleInterpretation(ctx.sheetId, ligne.lineId, ligne.value),
    [ctx.sheetId],
  );

  const charger = useCallback(
    async (ligne: LineResult) => {
      const k = cle(ligne);
      setChargements((c) => ({ ...c, [k]: true }));
      // Une nouvelle tentative efface l'erreur précédente : sans ça, le panneau
      // afficherait « Réessayer » et le message de l'échec d'avant pendant que
      // l'appel suivant est déjà en route.
      setErreurs((e) => {
        if (e[k] === undefined) return e;
        const reste = { ...e };
        delete reste[k];
        return reste;
      });
      try {
        const res: InterpretationsView = await api.interpretResults({
          templateSlug: ctx.templateSlug,
          sheetId: ctx.sheetId,
          sheetLabel: ctx.sheetLabel,
          devise: ctx.devise,
          lines: ctx.lines,
          lineIds: [ligne.lineId],
        });
        const trouvee = res.interpretations.find((i) => i.lineId === ligne.lineId);
        if (!trouvee) throw new Error('Aucune interprétation renvoyée pour cette ligne.');
        setLectures((l) => ({
          ...l,
          [k]: {
            texte: trouvee.texte,
            source: trouvee.source,
            avertissementFeuille: res.avertissementFeuille,
            mention: res.mention,
          },
        }));
      } catch (err) {
        setErreurs((e) => ({
          ...e,
          [k]: err instanceof Error ? err.message : 'Interprétation indisponible.',
        }));
      } finally {
        setChargements((c) => ({ ...c, [k]: false }));
      }
    },
    [cle, ctx.devise, ctx.lines, ctx.sheetId, ctx.sheetLabel, ctx.templateSlug],
  );

  const basculer = useCallback(
    (ligne: LineResult) => {
      const k = cle(ligne);
      if (ouvertId === ligne.lineId) {
        setOuvertId(null);
        return;
      }
      setOuvertId(ligne.lineId);
      // Une lecture déjà en cache s'affiche sans nouvel appel : rouvrir une
      // bulle ne doit pas reconsommer l'IA.
      if (lectures[k] === undefined && chargements[k] !== true) void charger(ligne);
    },
    [charger, chargements, cle, lectures, ouvertId],
  );

  return useMemo(
    () => ({
      ouvertId,
      chatLigne,
      basculer,
      fermer: () => setOuvertId(null),
      ouvrirChat: (ligne: LineResult) => setChatLigne(ligne),
      fermerChat: () => setChatLigne(null),
      lecture: (ligne: LineResult) => lectures[cle(ligne)],
      enChargement: (ligne: LineResult) => chargements[cle(ligne)] === true,
      erreur: (ligne: LineResult) => erreurs[cle(ligne)],
    }),
    [basculer, chargements, chatLigne, cle, erreurs, lectures, ouvertId],
  );
}

/** Identifiant du panneau — cité par `aria-controls` du déclencheur. */
function idPanneau(sheetId: string, lineId: string): string {
  return `interpretation-${sheetId}-${lineId}`;
}

/**
 * Déclencheur de la bulle, posé à côté du libellé du résultat.
 *
 * C'est un `<button>` et non un `<span title>` : au clavier comme au doigt, une
 * infobulle de survol n'existe pas (même raisonnement que `Infobulle`).
 */
export function BoutonInterpretation({
  ligne,
  sheetId,
  etat,
}: {
  ligne: LineResult;
  sheetId: string;
  etat: EtatInterpretations;
}): React.ReactElement {
  const ouvert = etat.ouvertId === ligne.lineId;
  return (
    <button
      type="button"
      aria-expanded={ouvert}
      aria-controls={idPanneau(sheetId, ligne.lineId)}
      onClick={() => etat.basculer(ligne)}
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[0.63rem] font-medium uppercase tracking-wider transition',
        ouvert
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]'
          : 'border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
      ].join(' ')}
    >
      <span aria-hidden="true">{ouvert ? '−' : '?'}</span>
      Lire
      <span className="sr-only">
        {ouvert ? 'Masquer' : 'Afficher'} l’interprétation de « {ligne.label} »
      </span>
    </button>
  );
}

/**
 * Panneau d'interprétation. Rendu par l'appelant à l'endroit où il ne masque
 * rien : sous la ligne du tableau, ou dans la carte du ratio.
 *
 * Il reste dans le DOM quand il est fermé (`hidden`) pour que `aria-controls`
 * pointe toujours vers un élément existant, comme le fait `Infobulle`.
 */
export function PanneauInterpretation({
  ligne,
  valeurAffichee,
  sheetId,
  etat,
}: {
  ligne: LineResult;
  valeurAffichee: string;
  sheetId: string;
  etat: EtatInterpretations;
}): React.ReactElement {
  const ouvert = etat.ouvertId === ligne.lineId;
  const lecture = etat.lecture(ligne);
  const chargement = etat.enChargement(ligne);
  const erreur = etat.erreur(ligne);
  const etiquette = lecture ? etiquetteSource(lecture.source) : null;

  return (
    <div
      id={idPanneau(sheetId, ligne.lineId)}
      hidden={!ouvert}
      className={[
        // Bulle en FLUX : elle pousse le contenu suivant, elle ne le couvre pas.
        // `relative` porte le bec ci-dessous.
        'relative mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3',
        'text-left text-[0.78rem] leading-relaxed text-[var(--foreground)]',
      ].join(' ')}
    >
      {/* Bec de la bulle : purement décoratif, il rattache visuellement le
          panneau à sa ligne sans qu'aucun positionnement absolu ne porte le
          contenu lui-même. */}
      <span
        aria-hidden="true"
        className="absolute -top-1.5 left-4 h-3 w-3 rotate-45 border-l border-t border-[var(--border)] bg-[var(--surface-muted)]"
      />

      {chargement ? (
        <p aria-live="polite" className="text-[var(--foreground-muted)]">
          Lecture de ce résultat…
        </p>
      ) : erreur ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-[var(--danger)]">{erreur}</p>
          <button
            type="button"
            onClick={() => etat.basculer(ligne)}
            className="self-start rounded-md border border-[var(--border)] px-2.5 py-1 text-[0.72rem] font-medium transition hover:bg-[var(--surface)]"
          >
            Réessayer
          </button>
        </div>
      ) : lecture ? (
        <div className="flex flex-col gap-2.5">
          <p>{lecture.texte}</p>

          {etiquette ? (
            <p
              title={etiquette.titre}
              className="text-[0.63rem] uppercase tracking-wider text-[var(--foreground-muted)]"
            >
              {etiquette.texte}
            </p>
          ) : null}

          {/* Le bouton demandé par le décideur : « une fois que l'utilisateur
              clique, ça veut dire qu'il veut plus d'éclairage ». */}
          <button
            type="button"
            onClick={() => etat.ouvrirChat(ligne)}
            className="self-start rounded-md border border-[var(--accent)] px-3 py-1.5 text-[0.75rem] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
          >
            Discuter avec Lala
            <span className="sr-only"> à propos de « {ligne.label} », {valeurAffichee}</span>
          </button>

          <p className="border-t border-[var(--border)] pt-2 text-[0.63rem] leading-snug text-[var(--foreground-muted)]">
            {lecture.mention}
          </p>
        </div>
      ) : null}
    </div>
  );
}

'use client';

// Chat avec « Lala », assistante IA experte financière (S24a).
//
// ── Ce que ce composant est ──────────────────────────────────────────────────
//
// Le second niveau de l'explication. Le premier — l'interprétation — est déjà
// sous les yeux de l'utilisateur; ici il demande « plus d'éclairage » sur CETTE
// lecture. Le panneau garde donc en tête le résultat d'origine et
// l'interprétation déjà lue : sans ce rappel, l'utilisateur ouvre un chat
// générique et doit réexpliquer de quoi il parle.
//
// ── Trois choses ne sont pas négociables à l'écran ───────────────────────────
//
//  1. **La réserve de portée reste visible**, en haut du fil, pendant toute la
//     conversation. Pour la trésorerie mensuelle (docs/07 § Limites connues),
//     c'est ce qui empêche l'échange de se dérouler comme si cette vue était la
//     trésorerie de référence du projet. Elle vient de l'API, pas du composant.
//  2. **L'origine de chaque réponse est dite** : « Rédigé par Lala » ou
//     « Explication automatique ». Une réponse de repli qui se présenterait comme
//     une réponse d'IA serait un mensonge d'interface.
//  3. **La mention anti-conseil est en pied de panneau**, tout le temps, pas
//     dans un pli. Ce produit sert à monter des dossiers bancaires.
//
// ── Forme ────────────────────────────────────────────────────────────────────
//
// Plein écran sous 640 px (le fil a besoin de toute la hauteur pour être
// lisible), panneau ancré en bas à droite au-delà. `Échap` ferme, le focus part
// dans le champ de saisie à l'ouverture et revient au déclencheur à la
// fermeture — sinon on se retrouve en haut de page après avoir fermé le chat.

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type LalaMessage, type LineResult, type TexteIaSource } from '@/lib/api';

import {
  etiquetteSource,
  messagesAEnvoyer,
  peutEnvoyer,
} from '@/app/(app)/projects/_components/interpretation-model';

/** Un tour de parole affiché, avec la provenance de la réponse. */
interface TourAffiche extends LalaMessage {
  source?: TexteIaSource;
}

export interface LalaChatProps {
  /** Contexte moteur — transmis tel quel, jamais recomposé. */
  templateSlug: string;
  sheetId: string;
  sheetLabel: string;
  devise?: string;
  lines: LineResult[];
  /** Résultat d'où part la conversation. */
  ligne: LineResult;
  valeurAffichee: string;
  /** Interprétation déjà lue, que l'échange prolonge. */
  interpretation: string;
  /** Réserve de portée de la feuille, si elle en porte une. */
  avertissementFeuille: string | null;
  mention: string;
  onClose: () => void;
}

export function LalaChat({
  templateSlug,
  sheetId,
  sheetLabel,
  devise,
  lines,
  ligne,
  valeurAffichee,
  interpretation,
  avertissementFeuille,
  mention,
  onClose,
}: LalaChatProps): React.ReactElement {
  const [tours, setTours] = useState<TourAffiche[]>([]);
  const [question, setQuestion] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reserveVue, setReserveVue] = useState<string | null>(avertissementFeuille);
  const [mentionVue, setMentionVue] = useState(mention);

  const champRef = useRef<HTMLTextAreaElement>(null);
  const filRef = useRef<HTMLDivElement>(null);

  // Le focus entre dans le champ : un panneau qui s'ouvre sans donner le focus
  // oblige l'utilisateur au clavier à traverser toute la page pour y arriver.
  useEffect(() => {
    champRef.current?.focus();
  }, []);

  // `Échap` au niveau du document : la touche doit fermer le panneau même quand
  // le focus est sorti de lui (clic dans le fil, par exemple).
  useEffect(() => {
    const surTouche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [onClose]);

  // Le fil défile vers le bas à chaque nouveau tour : sans ça, la réponse
  // arrive hors champ et l'utilisateur croit que rien ne s'est passé.
  useEffect(() => {
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
  }, [tours, enCours]);

  const envoyer = useCallback(async () => {
    const messages = messagesAEnvoyer(
      tours.map(({ role, content }) => ({ role, content })),
      question,
    );
    if (!messages || enCours) return;

    const posee = messages[messages.length - 1];
    if (!posee) return;

    setTours((t) => [...t, posee]);
    setQuestion('');
    setEnCours(true);
    setErreur(null);

    try {
      const res = await api.askLala({
        templateSlug,
        sheetId,
        sheetLabel,
        lineId: ligne.lineId,
        devise,
        lines,
        interpretation,
        messages,
      });
      setTours((t) => [...t, { role: 'assistant', content: res.reply, source: res.source }]);
      // L'API reste l'autorité sur la réserve et la mention : si elle en change
      // le texte, l'écran suit sans redéploiement du composant.
      setReserveVue(res.avertissementFeuille);
      setMentionVue(res.mention);
    } catch (err) {
      // Une panne réseau n'est PAS présentée comme une réponse de Lala : elle
      // sort du fil, dans une zone d'erreur explicite.
      setErreur(err instanceof Error ? err.message : 'Impossible de joindre l’assistante.');
    } finally {
      setEnCours(false);
    }
  }, [
    devise,
    enCours,
    interpretation,
    ligne.lineId,
    lines,
    question,
    sheetId,
    sheetLabel,
    templateSlug,
    tours,
  ]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Échanger avec Lala à propos de « ${ligne.label} »`}
      className={[
        'fixed z-50 flex flex-col bg-[var(--surface)] shadow-2xl',
        // Sous 640 px : plein écran. `dvh` et non `vh` — la barre d'adresse
        // mobile mange sinon le champ de saisie.
        'inset-0 h-[100dvh] rounded-none border-0',
        'sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(34rem,calc(100dvh-2rem))] sm:w-[min(26rem,calc(100vw-2rem))]',
        'sm:rounded-lg sm:border sm:border-[var(--border)]',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            Lala — assistante financière
          </h2>
          <p className="text-[0.7rem] leading-snug text-[var(--foreground-muted)]">
            À propos de « {ligne.label} » — {valeurAffichee} · {sheetLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-md px-2 py-1 text-lg leading-none text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Fermer l’échange</span>
        </button>
      </header>

      <div ref={filRef} className="flex-1 overflow-y-auto px-4 py-3">
        {/* La réserve de portée ouvre le fil et n'en sort jamais. */}
        {reserveVue ? (
          <p className="mb-3 rounded-md border border-[var(--warn)]/40 bg-[var(--surface-muted)] p-2.5 text-[0.7rem] leading-relaxed text-[var(--foreground-muted)]">
            <strong className="text-[var(--warn)]">Portée de cette feuille.</strong> {reserveVue}
          </p>
        ) : null}

        {/* Le point de départ : la lecture que l'utilisateur veut approfondir. */}
        <blockquote className="mb-3 border-l-2 border-[var(--border-strong)] pl-3 text-[0.78rem] leading-relaxed text-[var(--foreground-muted)]">
          {interpretation}
        </blockquote>

        {tours.length === 0 ? (
          <p className="text-[0.78rem] leading-relaxed text-[var(--foreground-muted)]">
            Posez votre question sur ce résultat. Lala explique les chiffres calculés par le moteur
            — elle n’en produit aucun et ne modifiera pas votre plan.
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {tours.map((tour, i) => {
            const etiquette = tour.source ? etiquetteSource(tour.source) : null;
            return (
              <li
                key={`${tour.role}-${i}`}
                className={tour.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={[
                    'max-w-[85%] rounded-lg px-3 py-2 text-[0.82rem] leading-relaxed',
                    tour.role === 'user'
                      ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                      : 'border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)]',
                  ].join(' ')}
                >
                  <p className="whitespace-pre-wrap">{tour.content}</p>
                  {etiquette ? (
                    <p
                      title={etiquette.titre}
                      className="mt-1.5 text-[0.63rem] uppercase tracking-wider text-[var(--foreground-muted)]"
                    >
                      {etiquette.texte}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {enCours ? (
          <p aria-live="polite" className="mt-3 text-[0.78rem] text-[var(--foreground-muted)]">
            Lala rédige…
          </p>
        ) : null}

        {erreur ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-2.5 text-[0.75rem] text-[var(--danger)]"
          >
            {erreur}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
        className="flex flex-col gap-2 border-t border-[var(--border)] px-4 py-3"
      >
        <label htmlFor="lala-question" className="sr-only">
          Votre question à Lala
        </label>
        <textarea
          id="lala-question"
          ref={champRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Entrée envoie, Maj+Entrée passe à la ligne : la convention des
            // messageries. Sans ça, un utilisateur presse Entrée et croit que
            // rien ne fonctionne.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void envoyer();
            }
          }}
          rows={2}
          placeholder="Pourquoi ce chiffre est-il à ce niveau ?"
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.63rem] leading-snug text-[var(--foreground-muted)]">{mentionVue}</p>
          <button
            type="submit"
            disabled={!peutEnvoyer(question, enCours)}
            className="shrink-0 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-40"
          >
            {enCours ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </form>
    </div>
  );
}

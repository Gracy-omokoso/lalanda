'use client';

// Appel vocal avec « Lala » — agent conversationnel ElevenLabs.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CE COMPOSANT NE CONNAÎT AUCUN CHIFFRE DU PROJET, ET C'EST VOULU.         ║
// ║                                                                          ║
// ║ Ses props ne portent ni `lines`, ni `sheetId`, ni `devise`, ni valeur.   ║
// ║ Comparer avec `LalaChat`, qui reçoit tout cela : le chat écrit en a      ║
// ║ besoin parce que l'API relit sa réponse et rejette tout nombre absent du  ║
// ║ moteur (`lala-nombres.ts`). En conversation vocale temps réel, ce        ║
// ║ contrôle est impossible — la parole part avant qu'on puisse la relire.   ║
// ║ Ne rien transmettre est donc la seule protection qui tienne.             ║
// ║                                                                          ║
// ║ Conséquence à l'écran, assumée : l'agent vocal répond à « c'est quoi un  ║
// ║ DSCR ? » et RENVOIE VERS l'explication affichée pour « mon DSCR est-il   ║
// ║ bon ? ». Le bandeau au-dessus du fil le dit avant qu'on le découvre.     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ── L'authentification, et pourquoi elle passe par l'API ────────────────────
//
// La clé ElevenLabs n'atteint JAMAIS ce fichier. `api.ouvrirAppelVocal()`
// demande au serveur une URL signée — le serveur lit la clé dans le coffre
// chiffré, appelle `GET /v1/convai/conversation/get-signed-url` avec l'en-tête
// `xi-api-key`, et ne rend que le jeton. C'est ce jeton, à durée de vie courte,
// que `Conversation.startSession({ signedUrl })` consomme.
//
// ── Pourquoi le SDK est chargé au clic et pas à l'import ────────────────────
//
// `@elevenlabs/react` tire `livekit-client` : environ trois mégaoctets qui ne
// servent qu'à ceux qui appellent. Un `import` en tête de fichier les mettrait
// dans le lot de la page résultats, chargé par tout le monde. L'import
// dynamique dans le gestionnaire de clic les réserve à l'usage réel.

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type EtatVocalView, type QuotaVocalView } from '@/lib/api';

/** Instance de conversation du SDK, réduite à ce qu'on en utilise. */
interface ConversationVivante {
  endSession: () => Promise<void>;
}

type EtatAppel =
  | { nom: 'verification' }
  | { nom: 'indisponible'; message: string }
  | { nom: 'pret'; quota: QuotaVocalView | null }
  | { nom: 'connexion' }
  | { nom: 'en_ligne' }
  | { nom: 'erreur'; message: string };

/** Un tour de parole transcrit pendant l'appel. */
interface TourVocal {
  role: 'user' | 'agent';
  texte: string;
}

/**
 * Panneau d'appel, sans props.
 *
 * L'absence de props n'est pas une simplification : c'est la frontière rendue
 * visible dans la signature. Un composant qui recevrait `lines` ou `ligne`
 * pourrait, un jour, les faire suivre. Celui-ci n'a rien à faire suivre. Le
 * raccrochage propre au démontage est géré ici même, pas confié à un parent.
 */
export function LalaAppelVocal(): React.ReactElement {
  const [etat, setEtat] = useState<EtatAppel>({ nom: 'verification' });
  const [mention, setMention] = useState<string | null>(null);
  const [tours, setTours] = useState<TourVocal[]>([]);
  const [parle, setParle] = useState(false);
  const [secondesRestantes, setSecondesRestantes] = useState<number | null>(null);

  // Refs et non état : ces valeurs sont lues dans des fermetures (minuterie,
  // démontage) qui ne doivent PAS provoquer de rendu ni voir une valeur périmée.
  const conversationRef = useRef<ConversationVivante | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const debutRef = useRef<number | null>(null);
  const filRef = useRef<HTMLDivElement>(null);

  /**
   * Rapporte la durée réelle au serveur, puis oublie la session.
   *
   * Ne lève jamais et n'attend pas : le serveur a DÉJÀ débité le plafond de
   * session à l'ouverture, et cet appel ne peut que corriger à la baisse. Le
   * perdre coûte à l'utilisateur quelques minutes de trop — jamais une erreur
   * affichée alors qu'il vient simplement de raccrocher.
   */
  const rapporterDuree = useCallback((): void => {
    const sessionId = sessionIdRef.current;
    const debut = debutRef.current;
    sessionIdRef.current = null;
    debutRef.current = null;
    if (!sessionId || debut === null) return;
    const minutes = (Date.now() - debut) / 60_000;
    void api.cloturerAppelVocal({ sessionId, minutes }).catch(() => {
      /* la correction est un confort, pas une obligation — voir ci-dessus */
    });
  }, []);

  const raccrocher = useCallback(async (): Promise<void> => {
    const conversation = conversationRef.current;
    conversationRef.current = null;
    setSecondesRestantes(null);
    setParle(false);
    if (conversation) {
      try {
        await conversation.endSession();
      } catch {
        /* la session peut déjà être tombée : raccrocher deux fois n'est pas une erreur */
      }
    }
    rapporterDuree();
    const etatFrais = await api.etatAppelVocal().catch(() => null);
    setEtat(
      etatFrais && !etatFrais.disponible
        ? { nom: 'indisponible', message: etatFrais.message ?? 'Appel vocal indisponible.' }
        : { nom: 'pret', quota: etatFrais?.quota ?? null },
    );
  }, [rapporterDuree]);

  // ── État initial du bouton ─────────────────────────────────────────────────
  useEffect(() => {
    let vivant = true;
    api
      .etatAppelVocal()
      .then((vue: EtatVocalView) => {
        if (!vivant) return;
        setEtat(
          vue.disponible
            ? { nom: 'pret', quota: vue.quota }
            : { nom: 'indisponible', message: vue.message ?? 'Appel vocal indisponible.' },
        );
      })
      .catch(() => {
        if (vivant) setEtat({ nom: 'indisponible', message: 'Appel vocal indisponible.' });
      });
    return () => {
      vivant = false;
    };
  }, []);

  // ── Filet de démontage ─────────────────────────────────────────────────────
  //
  // Fermer l'onglet ou quitter la page ne doit pas laisser un micro ouvert.
  // Le rapport de durée part sans être attendu : à ce stade, React ne rendra
  // plus rien et le serveur a déjà son débit plafond.
  useEffect(() => {
    return () => {
      const conversation = conversationRef.current;
      conversationRef.current = null;
      if (conversation) void conversation.endSession().catch(() => undefined);
      rapporterDuree();
    };
  }, [rapporterDuree]);

  // ── Minuterie de session ───────────────────────────────────────────────────
  //
  // Le plafond vient du serveur, jamais d'une constante d'interface : c'est lui
  // qui a débité les minutes correspondantes. Un compte à rebours d'affichage
  // qui divergerait du débit mentirait sur ce qui est facturé.
  useEffect(() => {
    if (etat.nom !== 'en_ligne' || secondesRestantes === null) return;
    if (secondesRestantes <= 0) {
      void raccrocher();
      return;
    }
    const t = setTimeout(() => setSecondesRestantes((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [etat.nom, secondesRestantes, raccrocher]);

  // Le fil de transcription suit la conversation : sans ça, la dernière phrase
  // de Lala arrive hors champ pendant qu'elle la prononce.
  useEffect(() => {
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
  }, [tours]);

  const appeler = useCallback(async (): Promise<void> => {
    setEtat({ nom: 'connexion' });
    setTours([]);
    try {
      // 1. Le serveur signe. La clé ElevenLabs reste chez lui.
      const session = await api.ouvrirAppelVocal();
      setMention(session.mention);
      sessionIdRef.current = session.sessionId;

      // 2. Le SDK n'est chargé que maintenant — voir l'encadré en tête.
      const { Conversation } = await import('@elevenlabs/react');

      // 3. `signedUrl` SEUL. Aucun `overrides`, aucune `dynamicVariables` :
      //    ce sont les deux canaux par lesquels une donnée de projet pourrait
      //    partir du navigateur vers ElevenLabs. Ils restent fermés.
      const conversation = (await Conversation.startSession({
        signedUrl: session.signedUrl,
        onMessage: ({ message, source }) =>
          setTours((t) => [...t, { role: source === 'user' ? 'user' : 'agent', texte: message }]),
        onModeChange: ({ mode }) => setParle(mode === 'speaking'),
        onDisconnect: () => {
          if (conversationRef.current) void raccrocher();
        },
        onError: (message: string) => {
          conversationRef.current = null;
          rapporterDuree();
          setEtat({ nom: 'erreur', message });
        },
      })) as unknown as ConversationVivante;

      conversationRef.current = conversation;
      debutRef.current = Date.now();
      setSecondesRestantes(session.dureeMaxSecondes);
      setEtat({ nom: 'en_ligne' });
    } catch (err) {
      sessionIdRef.current = null;
      // Le refus de micro est le cas le plus fréquent et le seul que
      // l'utilisateur puisse corriger lui-même : il mérite sa propre phrase
      // plutôt que « impossible d'ouvrir la session ».
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Votre navigateur a refusé l’accès au microphone. Autorisez-le pour parler à Lala.'
          : err instanceof Error
            ? err.message
            : 'Impossible d’ouvrir l’appel.';
      setEtat({ nom: 'erreur', message });
    }
  }, [raccrocher, rapporterDuree]);

  const enLigne = etat.nom === 'en_ligne';

  return (
    <section
      aria-label="Appel vocal avec Lala"
      className="border-t border-[var(--border)] bg-[var(--surface-muted)]/40 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex items-center gap-2 text-[0.78rem] font-medium">
            <span aria-hidden="true">🎙️</span>
            <span className="truncate">Parler à Lala</span>
            {enLigne ? (
              <span
                aria-live="polite"
                className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-[var(--accent-foreground)]"
              >
                {parle ? 'Lala parle' : 'à vous'}
              </span>
            ) : null}
          </p>
          <p className="text-[0.68rem] leading-snug text-[var(--foreground-muted)]">
            {legende(etat, secondesRestantes)}
          </p>
        </div>

        {enLigne ? (
          <button
            type="button"
            onClick={() => void raccrocher()}
            className="shrink-0 rounded-md bg-[var(--danger)] px-3 py-2 text-[0.78rem] font-medium text-white transition hover:opacity-90"
          >
            Raccrocher
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void appeler()}
            disabled={
              etat.nom === 'verification' || etat.nom === 'connexion' || etat.nom === 'indisponible'
            }
            title={etat.nom === 'indisponible' ? etat.message : undefined}
            className="shrink-0 rounded-md border border-[var(--border-strong)] px-3 py-2 text-[0.78rem] font-medium transition hover:bg-[var(--surface)] disabled:opacity-40"
          >
            {etat.nom === 'connexion' ? 'Connexion…' : 'Appeler'}
          </button>
        )}
      </div>

      {/* La frontière est ANNONCÉE, pas découverte. Un utilisateur qui demande
          « mon ratio est-il bon ? » et s'entend renvoyer à l'écran doit avoir
          lu pourquoi avant, sinon il conclut que l'assistante est défaillante. */}
      {etat.nom === 'pret' || enLigne || etat.nom === 'connexion' ? (
        <p className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[0.66rem] leading-relaxed text-[var(--foreground-muted)]">
          Lala vocale explique des <strong>notions</strong> — « qu’est-ce qu’un DSCR ? », « à quoi
          sert le BFR ? ». Elle n’a <strong>aucun chiffre de votre projet</strong> : pour la lecture
          de vos résultats, l’explication affichée à l’écran fait foi.
        </p>
      ) : null}

      {etat.nom === 'indisponible' ? (
        <p className="mt-2 text-[0.68rem] leading-relaxed text-[var(--foreground-muted)]">
          {etat.message}
        </p>
      ) : null}

      {etat.nom === 'erreur' ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-2 text-[0.7rem] text-[var(--danger)]"
        >
          {etat.message}
        </p>
      ) : null}

      {/* Transcription : mêmes bulles que le chat écrit, de part et d'autre.
          Elle sert à suivre l'échange dans un lieu bruyant, et rend l'appel
          utilisable par une personne malentendante. */}
      {tours.length > 0 ? (
        <div ref={filRef} className="mt-2 max-h-40 overflow-y-auto">
          <ul className="flex flex-col gap-1.5">
            {tours.map((tour, i) => (
              <li
                key={`${tour.role}-${i}`}
                className={tour.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <p
                  className={[
                    'max-w-[85%] rounded-lg px-2.5 py-1.5 text-[0.72rem] leading-relaxed',
                    tour.role === 'user'
                      ? 'bg-[var(--accent)]/85 text-[var(--accent-foreground)]'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]',
                  ].join(' ')}
                >
                  {tour.texte}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* La mention vient de l'API, comme celle du chat écrit : si elle change,
          l'écran suit sans redéploiement du composant. */}
      {mention ? (
        <p className="mt-2 text-[0.6rem] leading-snug text-[var(--foreground-muted)]">{mention}</p>
      ) : null}
    </section>
  );
}

/** Ligne d'état sous le titre — dit toujours ce qui se passe, jamais rien. */
function legende(etat: EtatAppel, secondesRestantes: number | null): string {
  switch (etat.nom) {
    case 'verification':
      return 'Vérification…';
    case 'indisponible':
      return 'Indisponible';
    case 'connexion':
      return 'Ouverture de la ligne…';
    case 'erreur':
      return 'Appel interrompu';
    case 'en_ligne':
      return secondesRestantes === null
        ? 'En ligne'
        : `En ligne — ${mmss(secondesRestantes)} restantes`;
    case 'pret':
      return legendeQuota(etat.quota);
  }
}

/** Minutes restantes du mois, en clair. `null` = offre négociée au contrat. */
export function legendeQuota(quota: QuotaVocalView | null): string {
  if (!quota) return 'Questions de notions, en voix';
  if (quota.minutesRestantes === null) return 'Minutes incluses selon votre contrat';
  const restantes = Math.floor(quota.minutesRestantes);
  return restantes <= 1
    ? `${restantes} minute restante ce mois-ci`
    : `${restantes} minutes restantes ce mois-ci`;
}

/** Compte à rebours lisible. Exporté pour être vérifiable sans monter React. */
export function mmss(secondes: number): string {
  const s = Math.max(Math.floor(secondes), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

'use client';

// Bannière et panneau de consentement aux cookies (S22c).
//
// Ce fichier ne contient AUCUNE règle : elles vivent toutes dans
// `lib/cookie-consent.ts`, testé en logique pure. Ici, uniquement du rendu et
// deux écritures de `document.cookie`.
//
// ── Les deux points qui font la différence entre un consentement et un bandeau ──
//
// 1. REFUS PAR DÉFAUT. Rien n'est déposé ni activé tant qu'aucun choix n'est
//    exprimé. Fermer la bannière sans répondre ne vaut pas acceptation — il n'y a
//    d'ailleurs pas de croix de fermeture, précisément pour que « fermer » ne
//    puisse pas être interprété comme un accord.
// 2. « REFUSER » EXACTEMENT AUSSI VISIBLE QU'« ACCEPTER ». Les deux boutons
//    partagent la même classe (`CHOICE_BUTTON`), donc la même taille, la même
//    typographie et le même poids visuel. C'est la contrainte la plus facile à
//    perdre lors d'un futur ajustement de style : rendre « Refuser » plus discret
//    est le dark pattern le plus répandu du web, et il se produit en changeant
//    une seule classe. Les deux boutons doivent rester stylés par la MÊME
//    constante — ne pas les séparer.
//
// Aucun outil de mesure n'est installé à ce jour (cf. `lib/cookie-consent.ts`) :
// la bannière existe pour que le choix soit connu AVANT qu'un tel outil arrive.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  CATEGORY_DESCRIPTIONS,
  DEFAULT_CONSENT,
  FULL_CONSENT,
  buildConsentClearCookie,
  buildConsentCookie,
  hasDecided,
  readConsent,
  type ConsentState,
  type StoredConsent,
} from '@/lib/cookie-consent';

/**
 * Style PARTAGÉ par « Refuser » et « Accepter ».
 *
 * Une seule constante pour les deux : c'est ce qui rend impossible de rendre le
 * refus plus discret que l'acceptation sans le faire exprès.
 */
const CHOICE_BUTTON =
  'flex-1 rounded-md border border-[var(--border-strong)] px-4 py-2.5 text-sm font-semibold ' +
  'transition hover:brightness-95 sm:flex-none sm:min-w-[9.5rem]';

/** Lit le choix courant côté navigateur. `null` = aucun choix exprimé. */
function readCurrentConsent(): StoredConsent | null {
  if (typeof document === 'undefined') return null;
  return readConsent(document.cookie);
}

/** Écrit un choix. `secure` suit le protocole réel — sinon rejet en http local. */
function writeConsent(state: ConsentState): void {
  document.cookie = buildConsentCookie(state, new Date(), window.location.protocol === 'https:');
}

/**
 * Bannière affichée tant qu'aucun choix n'a été exprimé.
 *
 * Montée dans le layout racine : elle doit apparaître aussi bien sur les pages
 * publiques que dans l'application — un visiteur peut arriver directement sur
 * `/login` sans jamais voir la page d'accueil.
 */
export function CookieBanner(): React.ReactElement | null {
  // `null` = état encore inconnu (rendu serveur, avant lecture du cookie). On
  // n'affiche rien dans cet état : afficher puis masquer produirait un
  // clignotement de la bannière pour un utilisateur ayant déjà répondu.
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    setVisible(!hasDecided(readCurrentConsent()));
  }, []);

  const decide = useCallback((state: ConsentState) => {
    writeConsent(state);
    setVisible(false);
  }, []);

  if (visible !== true) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1 text-sm leading-6">
          <p id="cookie-banner-title" className="font-semibold">
            Cookies non essentiels
          </p>
          <p className="mt-1 text-[var(--foreground-muted)]">
            Lalanda dépose les cookies nécessaires à votre connexion, qui ne se refusent pas. Pour
            tout le reste — la mesure d&apos;audience — nous vous demandons votre accord. Aucun
            outil de mesure n&apos;est installé à ce jour&nbsp;: votre choix sera appliqué le jour
            où il le sera.{' '}
            <Link href="/cookies" className="underline underline-offset-4">
              En savoir plus
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          {/* Refuser en premier : l'ordre de lecture ne doit pas non plus
              privilégier l'acceptation. */}
          <button type="button" onClick={() => decide(DEFAULT_CONSENT)} className={CHOICE_BUTTON}>
            Refuser
          </button>
          <button type="button" onClick={() => decide(FULL_CONSENT)} className={CHOICE_BUTTON}>
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Panneau « votre choix actuel », affiché sur la page /cookies.
 *
 * Un consentement qu'on ne peut pas retirer aussi facilement qu'il a été donné
 * n'en est pas un : ce panneau expose l'état enregistré et permet de le changer
 * ou de l'effacer, sans quitter la page qui l'explique.
 */
export function CookieChoicePanel(): React.ReactElement {
  const [stored, setStored] = useState<StoredConsent | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setStored(readCurrentConsent());
    setReady(true);
  }, []);

  const apply = useCallback((state: ConsentState) => {
    writeConsent(state);
    setStored(readCurrentConsent());
  }, []);

  const reset = useCallback(() => {
    document.cookie = buildConsentClearCookie();
    setStored(null);
  }, []);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-5">
      <p className="font-mono text-xs font-medium tracking-[0.14em] text-[var(--foreground-muted)]">
        VOTRE CHOIX
      </p>

      {!ready ? (
        // Avant lecture du cookie, on n'affirme rien : annoncer « refusé » puis
        // corriger en « accepté » serait une information fausse le temps d'un
        // rendu, sur la page même qui promet la transparence.
        <p className="mt-3 text-sm text-[var(--foreground-muted)]">Lecture de votre choix…</p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6">
            {stored
              ? `Choix enregistré le ${new Date(stored.decidedAt).toLocaleDateString('fr-FR')}.`
              : 'Vous n’avez pas encore répondu. Tant que c’est le cas, les cookies non essentiels sont refusés.'}
          </p>

          <ul className="mt-4 flex flex-col gap-3">
            {CATEGORY_DESCRIPTIONS.map((c) => (
              <li key={c.category} className="text-sm leading-6">
                <span className="font-semibold">{c.label}</span> —{' '}
                <span
                  className={
                    stored?.state[c.category]
                      ? 'text-[var(--foreground)]'
                      : 'text-[var(--foreground-muted)]'
                  }
                >
                  {stored?.state[c.category] ? 'accepté' : 'refusé'}
                </span>
                <p className="text-[var(--foreground-muted)]">{c.description}</p>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => apply(DEFAULT_CONSENT)} className={CHOICE_BUTTON}>
              Refuser
            </button>
            <button type="button" onClick={() => apply(FULL_CONSENT)} className={CHOICE_BUTTON}>
              Accepter
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-4 py-2.5 text-sm underline underline-offset-4 text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
            >
              Effacer mon choix
            </button>
          </div>
        </>
      )}
    </div>
  );
}

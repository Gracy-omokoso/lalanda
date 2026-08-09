'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MOYENS DE PAIEMENT RÉELLEMENT DISPONIBLES (S22b)
//
// La version précédente de cette page affichait une phrase en dur : « Modes de
// paiement disponibles au lancement : carte bancaire et mobile money (RDC, CI,
// SN). » Elle était fausse dès qu'une clé manquait, et personne ne pouvait le
// savoir depuis la page.
//
// Ce composant demande à l'API ce qui marche VRAIMENT
// (`GET /payments/methods`, publique) et n'annonce que cela.
//
// ── Les trois états, et pourquoi aucun n'est un écran d'erreur ───────────────
//
//   chargement  → rien de définitif n'est affirmé;
//   réponse     → la liste réelle, avec la mention « confirmation manuelle »
//                 pour les moyens qui n'ont pas d'encaissement en ligne;
//   échec       → un repli honnête (« contactez-nous ») plutôt qu'une promesse.
//
// Un échec de cet appel ne doit PAS masquer la grille tarifaire : la page reste
// entièrement lisible, seule cette ligne change. C'est pourquoi le composant est
// client et isolé, plutôt qu'un `await` dans la page serveur qui ferait échouer
// le rendu complet si l'API est indisponible.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

import { api, type PaymentMethod } from '@/lib/api';

import { MANUAL_METHODS, PAYMENT_METHOD_LABELS } from './pricing-model';

type Etat =
  | { phase: 'chargement' }
  | { phase: 'ok'; disponibles: PaymentMethod[] }
  | { phase: 'indisponible' };

export function PaymentMethods(): React.ReactElement {
  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const { methods } = await api.getPaymentMethods();
        if (annule) return;
        setEtat({
          phase: 'ok',
          disponibles: methods.filter((m) => m.available).map((m) => m.method),
        });
      } catch {
        // Aucun détail n'est montré : « API injoignable » n'aide pas un
        // prospect, et le motif exact est une information d'exploitation.
        if (!annule) setEtat({ phase: 'indisponible' });
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  if (etat.phase === 'chargement') {
    return (
      <p className="text-center text-sm text-[var(--foreground-muted)]">
        Facturation en USD, hors taxes.
      </p>
    );
  }

  if (etat.phase === 'indisponible' || etat.disponibles.length === 0) {
    return (
      <p className="text-center text-sm text-[var(--foreground-muted)]">
        Facturation en USD, hors taxes. Les moyens de paiement disponibles vous sont confirmés à la
        souscription.
      </p>
    );
  }

  const enLigne = etat.disponibles.filter((m) => !MANUAL_METHODS.includes(m));
  const manuels = etat.disponibles.filter((m) => MANUAL_METHODS.includes(m));

  return (
    <div className="text-center text-sm text-[var(--foreground-muted)]">
      <p>Facturation en USD, hors taxes.</p>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {etat.disponibles.map((method) => (
          <li
            key={method}
            className="font-mono rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs tracking-wide text-[var(--foreground)]"
          >
            {PAYMENT_METHOD_LABELS[method] ?? method}
          </li>
        ))}
      </ul>
      {manuels.length > 0 ? (
        <p className="mt-3">
          {enLigne.length > 0 ? `${labels(enLigne)} : paiement en ligne immédiat. ` : null}
          {labels(manuels)} : vous recevez des instructions de dépôt avec une référence, et
          l&apos;abonnement est activé après vérification du versement — sous 24 heures ouvrées.
        </p>
      ) : null}
    </div>
  );
}

/** « Carte bancaire et PayPal » — énumération française, sans virgule finale. */
function labels(methods: PaymentMethod[]): string {
  const noms = methods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m);
  if (noms.length <= 1) return noms[0] ?? '';
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

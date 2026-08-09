// `/souscription/retour` — retour d'un fournisseur de paiement (S22b).
//
// URL déclarée à Stripe et PayPal par `payments.controller.ts` (`successUrl` /
// `cancelUrl`). Elle est construite côté API à partir de `WEB_URL` et jamais
// depuis la requête : une URL de retour fournie par le client permettrait de
// rediriger un payeur vers un site tiers après une transaction réelle.
//
// `Suspense` est obligatoire : `useSearchParams` force le rendu client du
// sous-arbre, et sans limite explicite Next fait échouer le build statique de
// la page entière.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PaymentReturn } from './_components/payment-return';

export const metadata: Metadata = { title: 'Retour de paiement — Lalanda' };

export default function PaymentReturnPage(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Retour de paiement</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          L’état affiché ici vient de nos serveurs, pas de l’adresse de retour.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}>
        <PaymentReturn />
      </Suspense>
    </section>
  );
}

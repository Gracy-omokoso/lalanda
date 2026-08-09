// `/souscription` — tunnel de souscription (S22b, docs/13).
//
// ROUTE AUTONOME, et non un onglet de `/organisation`. On y arrive par trois
// chemins qui n'ont rien à voir entre eux : la page tarifs publique, une
// bannière d'essai qui expire, et le retour d'un fournisseur de paiement. Les
// faire tous traverser un écran d'organisation ajouterait une étape à une
// décision déjà prise.
//
// La page est un point de montage : la logique vit dans
// `_components/subscription-funnel.tsx`, les règles d'affichage dans
// `_components/subscription-model.ts` (testé).

import type { Metadata } from 'next';

import { SubscriptionFunnel } from './_components/subscription-funnel';

export const metadata: Metadata = { title: 'Abonnement — Lalanda' };

export default function SubscriptionPage(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Abonnement</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          L’état de votre abonnement, le montant exact d’un changement d’offre, et les moyens de
          paiement réellement disponibles.
        </p>
      </header>
      <SubscriptionFunnel />
    </section>
  );
}

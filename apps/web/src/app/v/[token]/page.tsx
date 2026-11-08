// `/v/[token]` — vérification publique d'une carte de service (ADR-0069 § 4).
//
// Hors de l'application : ni coquille, ni session (`lib/routes.ts` la déclare
// publique). Non indexée : on y arrive en scannant le QR d'une carte. Le contenu
// vient de l'API par le jeton seulement ; jeton inconnu, révoqué ou fiche
// anonymisée : « Carte non valide », sans autre détail.

import type { Metadata } from 'next';

import { VerificationCarte } from './_components/verification-carte';

export const metadata: Metadata = {
  title: 'Vérification d’une carte de service',
  robots: { index: false, follow: false },
};

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  return <VerificationCarte token={token} />;
}

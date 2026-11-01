// `/f/[token]` — formulaire public de prospects d'une organisation (ADR-0048 § 9).
//
// Hors de l'application : ni coquille, ni session (`lib/routes.ts` le déclare
// public). Non indexé : le lien est donné par l'organisation, pas trouvé par un
// moteur de recherche. Le contenu vient de l'API par le jeton seulement.

import type { Metadata } from 'next';

import { FormulairePublic } from './_components/formulaire-public';

export const metadata: Metadata = {
  title: 'Formulaire de contact',
  robots: { index: false, follow: false },
};

export default async function FormulairePublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  return <FormulairePublic token={token} />;
}

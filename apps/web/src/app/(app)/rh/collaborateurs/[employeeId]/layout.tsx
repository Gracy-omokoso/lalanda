// `/rh/collaborateurs/[employeeId]` — fiche collaborateur (ADR-0045 § 8). La
// coquille (en-tête, onglets, lecture de la fiche) est commune aux onglets ;
// ceux du lot H7 (données sensibles, documents, entrées et sorties) s'y
// ajouteront par `ONGLETS_FICHE`.

import { FicheChrome } from '../../_components/fiche-chrome';

export default async function FicheLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ employeeId: string }>;
}): Promise<React.ReactElement> {
  const { employeeId } = await params;
  return <FicheChrome employeeId={employeeId}>{children}</FicheChrome>;
}

import { AchatsChrome } from './_components/achats-access';
import { AchatsHeader } from './_components/achats-header';

/**
 * Application Achats (module RUN) — ADR-0044 § 8, lot P7.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3) : vue d'ensemble, demandes et
 * commandes, approbations et fournisseurs sont dans la colonne de gauche.
 * L'en-tête et la frontière d'accès (`purchase.read`) sont communs à tous les
 * écrans, y compris ceux du lot P8 (réceptions, factures, à payer), qui
 * utilisent cette coquille sans l'écrire.
 *
 * ADR-0071 : Factures fournisseurs, À payer et Commandes portent leur propre
 * en-tête compact (`AchatsHeader`).
 */
export default function AchatsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <AchatsHeader />
      <AchatsChrome>{children}</AchatsChrome>
    </section>
  );
}

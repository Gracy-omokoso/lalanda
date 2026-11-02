// Frais refacturables sur la fiche projet — ADR-0051 § 7.3 et § 10 (lot H16).
//
// La liste des lignes de frais `rebillable` remboursées attend la route
// `GET /work/projects/:id/rebillable-expenses` (lot H14), pas encore livrée : le panneau
// le dit, sans rien inventer. Les frais remboursés imputés au projet entrent déjà dans
// la marge par leur dépense de remboursement, sans code nouveau.

export const PHRASE_REFACTURABLES_BIENTOT =
  'Bientôt disponible : la liste des frais du personnel marqués « à refacturer » sur ce projet arrive avec une prochaine livraison. Les frais remboursés imputés au projet comptent déjà dans la marge ci-dessus ; aucune facture n’est jamais créée seule.';

export function FraisRefacturables(): React.ReactElement {
  return (
    <section
      aria-labelledby="frais-refacturables"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-4 sm:p-5"
    >
      <h3 id="frais-refacturables" className="text-sm font-semibold">
        Frais à refacturer
      </h3>
      <p className="text-sm text-[var(--foreground-muted)]">{PHRASE_REFACTURABLES_BIENTOT}</p>
    </section>
  );
}

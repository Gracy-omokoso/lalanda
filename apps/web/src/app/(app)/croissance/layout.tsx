import { GrowChrome } from './_components/grow-chrome';

/**
 * Espace Croissance — GROW, premier lot (ADR-0032) : santé de l'entreprise,
 * indicateurs investisseurs, parcours. Exige une organisation active ; lecture
 * ouverte à tous les rôles (`analytics.read`), santé et indicateurs selon l'offre.
 */
export default function CroissanceLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Croissance</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          La santé de votre entreprise, vos indicateurs pour un investisseur et votre parcours,
          calculés sur vos données réelles — jamais complétés par une estimation.
        </p>
      </header>
      <GrowChrome>{children}</GrowChrome>
    </section>
  );
}

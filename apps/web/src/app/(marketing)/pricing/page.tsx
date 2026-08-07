// Page tarifs publique — 3 offres : Free, Pro, Business.
// Publique via le middleware (voir src/middleware.ts).

import Link from 'next/link';

export const metadata = {
  title: 'Tarifs — Lalanda',
  description:
    'Trois offres pour générer votre plan financier bancable : Free, Pro (9 USD/mois) et Business (49 USD/mois).',
};

type Tier = {
  name: string;
  price: string;
  priceSuffix?: string;
  altPrice?: string;
  tagline: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '0 USD',
    tagline: 'Pour tester Lalanda sur un premier projet.',
    features: [
      '1 projet',
      '1 scénario',
      'Export PDF avec filigrane',
      'Accès à tous les templates sectoriels',
      'Packs pays RDC, CI, SN, OHADA',
    ],
    cta: "S'inscrire",
  },
  {
    name: 'Pro',
    price: '9 USD',
    priceSuffix: '/ mois',
    altPrice: 'ou 90 USD / an',
    tagline: 'Pour un entrepreneur qui monte plusieurs dossiers.',
    features: [
      'Projets illimités',
      'Jusqu’à 3 scénarios par projet',
      'Export PDF sans filigrane',
      'Historique des versions',
      'Support par email',
    ],
    cta: "S'inscrire",
    highlighted: true,
  },
  {
    name: 'Business',
    price: '49 USD',
    priceSuffix: '/ mois',
    tagline: 'Pour cabinets, incubateurs et institutions financières.',
    features: [
      'Tout Pro, plus :',
      'White-label (logo et couleurs)',
      '20 sièges inclus',
      'Accès API',
      'Support prioritaire',
    ],
    cta: "S'inscrire",
  },
];

export default function PricingPage(): React.ReactElement {
  return (
    <>
      <section className="bg-ink ink-ruled">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="font-mono mb-4 text-xs font-medium tracking-[0.18em] text-[var(--stamp)]">
              TARIFS
            </p>
            <h1 className="font-display text-4xl font-black tracking-tight text-[var(--on-ink)] sm:text-5xl">
              Trois offres, un même moteur financier.
            </h1>
            <p className="mt-5 text-lg text-[var(--on-ink-muted)]">
              Tous les calculs et exports fonctionnent dès l&apos;offre gratuite. Vous ne payez que
              pour lever la limite de projets, retirer le filigrane et débloquer les fonctions
              collaboratives.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-6 lg:grid-cols-3">
            {TIERS.map((tier) => (
              <TierCard key={tier.name} tier={tier} />
            ))}
          </div>
          <p className="mt-10 text-center text-sm text-[var(--foreground-muted)]">
            Facturation en USD. Modes de paiement disponibles au lancement : carte bancaire et
            mobile money (RDC, CI, SN).
          </p>
        </div>
      </section>
    </>
  );
}

function TierCard({ tier }: { tier: Tier }): React.ReactElement {
  const borderClass = tier.highlighted ? 'border-[var(--accent)]' : 'border-[var(--border)]';

  return (
    <div
      className={`flex flex-col rounded-lg border ${borderClass} bg-[var(--surface)] p-8 ${
        tier.highlighted ? 'shadow-[0_16px_48px_-20px_rgba(11,31,26,0.35)]' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight">{tier.name}</h2>
        {tier.highlighted ? (
          <span className="font-mono rounded border-2 border-[var(--stamp)] px-2 py-0.5 text-[0.62rem] font-semibold tracking-[0.12em] text-[var(--stamp-strong)]">
            POPULAIRE
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-[var(--foreground-muted)]">{tier.tagline}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="fig text-4xl font-semibold tracking-tight">{tier.price}</span>
        {tier.priceSuffix ? (
          <span className="text-sm text-[var(--foreground-muted)]">{tier.priceSuffix}</span>
        ) : null}
      </div>
      {tier.altPrice ? (
        <p className="fig mt-1 text-xs text-[var(--foreground-muted)]">{tier.altPrice}</p>
      ) : null}

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/register"
        className={`mt-8 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition ${
          tier.highlighted
            ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90'
            : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]'
        }`}
      >
        {tier.cta}
      </Link>
    </div>
  );
}

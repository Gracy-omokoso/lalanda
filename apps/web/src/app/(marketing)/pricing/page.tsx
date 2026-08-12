// ─────────────────────────────────────────────────────────────────────────────
// PAGE TARIFS PUBLIQUE (S16b → S22b)
//
// Publique via le middleware (voir `src/middleware.ts`).
//
// Ce que S22b y change, et pourquoi :
//
//   1. L'ESSAI EST MIS EN AVANT. C'est la seule chose qu'un visiteur peut faire
//      sans sortir sa carte, et docs/13 en fait le point d'entrée du tunnel.
//      L'enterrer sous trois cartes de prix, c'est demander une décision d'achat
//      à quelqu'un qui n'a encore rien essayé.
//   2. UN COMPARATIF. Trois listes de puces côte à côte ne se comparent pas :
//      le lecteur doit retenir la ligne « export PDF » d'une colonne à l'autre.
//      Un tableau le fait pour lui.
//   3. UNE FAQ. Les objections d'un tunnel de paiement (carte exigée ? données
//      perdues ? prorata ? taxes ?) trouvent leur réponse ici, pas au support.
//   4. LES MOYENS DE PAIEMENT VIENNENT DE L'API. Voir `payment-methods.tsx` :
//      la phrase codée en dur promettait ce que la configuration ne garantissait
//      pas.
//
// Le contenu est dans `_components/pricing-model.ts`, confronté au catalogue de
// l'API par son test. Cette page n'est que de la mise en page.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';

import { ToComplete } from '../_components/legal-page';
import { PaymentMethods } from './_components/payment-methods';
import {
  annualSavingPercent,
  COMPARISON,
  FAQ,
  formatPrice,
  PLANS,
  TIERS,
  TRIAL_DAYS,
  type Tier,
} from './_components/pricing-model';

/**
 * Offres présentées en grille : celles qui ont un tarif publié.
 *
 * Le partage n'est pas cosmétique. Une offre sans montant ne se compare pas
 * colonne à colonne avec des prix — la mettre dans la même grille invite au clic
 * d'achat. Elle a donc son propre bloc, plus bas, sans bouton de paiement.
 */
const GRID_TIERS = TIERS.filter((t) => t.priceMonthUsd !== null);
const QUOTE_TIERS = TIERS.filter((t) => t.priceMonthUsd === null);

export const metadata = {
  title: 'Tarifs — Lalanda',
  description:
    // Les montants ne sont pas recopiés : ils viennent du catalogue, comme le
    // reste de la page. Une méta-description périmée est une promesse périmée,
    // et c'est elle que lisent les moteurs de recherche.
    `Cinq offres pour générer votre plan financier bancable : ` +
    GRID_TIERS.map((t) => `${t.name} (${formatPrice(t.priceMonthUsd)}/mois)`).join(', ') +
    `, et une offre Expert sur devis. Essai de ${TRIAL_DAYS} jours sans carte bancaire.`,
};

export default function PricingPage(): React.ReactElement {
  return (
    <>
      <section className="bg-ink ink-ruled">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="font-mono mb-4 text-xs font-medium tracking-[0.18em] text-[var(--on-ink-accent)]">
              TARIFS
            </p>
            <h1 className="font-display text-4xl font-black tracking-tight text-[var(--on-ink)] sm:text-5xl">
              Quatre offres, un même moteur financier.
            </h1>
            <p className="mt-5 text-lg text-[var(--on-ink-muted)]">
              Tous les calculs et exports fonctionnent dès l&apos;offre gratuite. Vous ne payez que
              pour lever la limite de projets, retirer le filigrane et débloquer les fonctions
              collaboratives.
            </p>

            <div className="mt-8 inline-flex flex-col items-center gap-3 rounded-lg border border-[var(--on-ink-accent)]/40 bg-[var(--on-ink)]/5 px-6 py-5">
              <p className="font-display text-xl font-bold text-[var(--on-ink)]">
                {TRIAL_DAYS} jours d&apos;essai, sans carte bancaire.
              </p>
              <p className="max-w-md text-sm text-[var(--on-ink-muted)]">
                Vous obtenez l&apos;offre Pro pendant {TRIAL_DAYS} jours. Aucun moyen de paiement
                n&apos;est demandé, aucun prélèvement n&apos;a lieu au terme : le compte revient à
                l&apos;offre gratuite, et{' '}
                <strong className="font-semibold">aucun projet n&apos;est supprimé</strong>.
              </p>
              <Link
                href="/register"
                className="mt-1 inline-flex items-center justify-center rounded-md bg-[var(--on-ink-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:opacity-90"
              >
                Démarrer l&apos;essai gratuit
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {GRID_TIERS.map((tier) => (
              <TierCard key={tier.slug} tier={tier} />
            ))}
          </div>
          {QUOTE_TIERS.map((tier) => (
            <QuoteCard key={tier.slug} tier={tier} />
          ))}
          <div className="mt-10">
            <PaymentMethods />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="font-display text-2xl font-bold tracking-tight">Comparatif détaillé</h2>
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">
            Les limites listées ici sont celles que l&apos;application applique réellement.
          </p>

          {/* Le tableau défile horizontalement sur mobile plutôt que d'être
              réduit à l'illisible : un comparatif tronqué ne compare rien. */}
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">
                Comparatif des offres {TIERS.map((t) => t.name).join(', ')}
              </caption>
              <thead>
                <tr className="border-b-2 border-[var(--border)]">
                  <th scope="col" className="py-3 pr-4 text-left font-semibold">
                    Fonction
                  </th>
                  {TIERS.map((tier) => (
                    <th
                      key={tier.slug}
                      scope="col"
                      className="px-4 py-3 text-left font-semibold sm:text-center"
                    >
                      {tier.name}
                      <span className="fig block text-xs font-normal text-[var(--foreground-muted)]">
                        {formatPrice(tier.priceMonthUsd)}
                        {tier.priceMonthUsd === null ? '' : ' / mois'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((section) => (
                  <ComparisonSectionRows key={section.title} section={section} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
          <h2 className="font-display text-2xl font-bold tracking-tight">Questions fréquentes</h2>
          <dl className="mt-8 flex flex-col gap-6">
            {FAQ.map((entry) => (
              <div
                key={entry.question}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
              >
                <dt className="font-semibold">{entry.question}</dt>
                <dd className="mt-2 text-sm text-[var(--foreground-muted)]">{entry.answer}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 text-center text-sm text-[var(--foreground-muted)]">
            Une question qui n&apos;est pas ici ?{' '}
            <Link href="/register" className="underline hover:text-[var(--accent)]">
              Créez un compte gratuit
            </Link>{' '}
            — l&apos;essai ne demande aucun moyen de paiement.
          </p>
        </div>
      </section>
    </>
  );
}

function ComparisonSectionRows({
  section,
}: {
  section: (typeof COMPARISON)[number];
}): React.ReactElement {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={1 + TIERS.length}
          className="font-mono pt-8 pb-2 text-left text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--foreground-muted)] uppercase"
        >
          {section.title}
        </th>
      </tr>
      {section.rows.map((row) => (
        <tr key={row.label} className="border-b border-[var(--border)]">
          <th scope="row" className="py-3 pr-4 text-left font-normal">
            {row.label}
            {row.note ? (
              <span className="block text-xs text-[var(--foreground-muted)]">{row.note}</span>
            ) : null}
          </th>
          {/* Les colonnes suivent `PLANS` : une offre ajoutée au catalogue
              apparaît ici sans qu'on ait à toucher au JSX, et surtout aucune
              cellule ne peut être oubliée en cours de route. */}
          {PLANS.map((plan) => (
            <Cell key={plan} value={row.values[plan]} />
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Cellule du comparatif.
 *
 * Un booléen devient une coche ou un tiret, DOUBLÉS d'un texte lisible par un
 * lecteur d'écran : « ✓ » seul se prononce « coche » ou ne se prononce pas du
 * tout selon le lecteur, et une colonne entière devient alors muette.
 */
function Cell({ value }: { value: string | boolean }): React.ReactElement {
  if (typeof value === 'string') {
    return <td className="px-4 py-3 sm:text-center">{value}</td>;
  }
  return (
    <td className="px-4 py-3 sm:text-center">
      <span aria-hidden="true" className={value ? 'text-[var(--accent)]' : 'text-[var(--border)]'}>
        {value ? '✓' : '—'}
      </span>
      <span className="sr-only">{value ? 'Inclus' : 'Non inclus'}</span>
    </td>
  );
}

function TierCard({ tier }: { tier: Tier }): React.ReactElement {
  const borderClass = tier.highlighted ? 'border-[var(--accent)]' : 'border-[var(--border)]';
  const saving = annualSavingPercent(tier);

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
        <span className="fig text-4xl font-semibold tracking-tight">
          {formatPrice(tier.priceMonthUsd)}
        </span>
        {tier.priceMonthUsd === null ? null : (
          <span className="text-sm text-[var(--foreground-muted)]">/ mois</span>
        )}
      </div>
      {tier.priceYearUsd !== null && tier.priceYearUsd > 0 ? (
        <p className="fig mt-1 text-xs text-[var(--foreground-muted)]">
          ou {tier.priceYearUsd} USD / an
          {saving === null ? null : ` — ${saving} % d’économie`}
        </p>
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

      {/* `TierCard` ne sert que les offres à tarif publié, qui ont toutes une
          destination. Le cas `null` (Expert) passe par `QuoteCard`. */}
      <Link
        href={tier.ctaHref ?? '/register'}
        className={`mt-8 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition ${
          tier.highlighted
            ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90'
            : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]'
        }`}
      >
        {tier.cta}
      </Link>
      {tier.selfServe ? (
        <p className="mt-3 text-center text-xs text-[var(--foreground-muted)]">
          Sans carte bancaire. Sans engagement.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Offre sans tarif publié — bloc de contact, pas carte de prix.
 *
 * Volontairement d'une AUTRE forme que `TierCard` : pleine largeur, pas de
 * colonne de montant, pas de mention d'essai. Un pack qui inclut du temps
 * d'expert humain ne s'achète pas au même geste qu'un abonnement mensuel, et
 * lui donner l'apparence d'une carte de prix inviterait précisément ce geste.
 * Aucun tunnel de paiement ne part d'ici.
 */
function QuoteCard({ tier }: { tier: Tier }): React.ReactElement {
  return (
    <div className="mt-6 flex flex-col gap-6 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-2xl">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-bold tracking-tight">{tier.name}</h2>
          <span className="font-mono rounded border border-[var(--border)] px-2 py-0.5 text-[0.62rem] font-semibold tracking-[0.12em] text-[var(--foreground-muted)]">
            SUR DEVIS
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">{tier.tagline}</p>
        <ul className="mt-4 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
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
        <p className="mt-4 text-xs text-[var(--foreground-muted)]">
          Cette offre inclut du temps d&apos;accompagnement par un expert. Son montant dépend de
          votre dossier : il est établi après un échange, et les accès sont ouverts une fois
          l&apos;accord conclu.
        </p>
      </div>
      {/* Aucune destination tant qu'aucun canal de contact n'est publié. Un
          bouton vers une page inexistante enverrait un acheteur sérieux sur un
          404 au moment où il veut parler à quelqu'un ; le marqueur « à
          compléter » du dépôt le dit au lieu de le cacher. */}
      {tier.ctaHref === null ? (
        <p className="shrink-0 text-sm">
          <span className="font-semibold">{tier.cta}</span>
          <span className="mt-2 block">
            <ToComplete>canal de contact commercial à publier</ToComplete>
          </span>
        </p>
      ) : (
        <Link
          href={tier.ctaHref}
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
        >
          {tier.cta}
        </Link>
      )}
    </div>
  );
}

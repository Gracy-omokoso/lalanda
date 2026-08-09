// Sommaire du centre d'aide (S22d).
//
// Publique et lisible sans session. La route est dans le group `(marketing)`
// pour l'en-tête et le pied de page, mais volontairement absente de
// `MARKETING_PATHS` (`lib/routes.ts`) : y figurer renverrait un utilisateur
// connecté vers `/projects`, ce qui casserait les liens d'aide contextuels
// ouverts depuis l'application.

import type { Metadata } from 'next';
import Link from 'next/link';

import { ARTICLES } from '@/lib/aide';
import { construireIndex } from '@/lib/aide/recherche';

import { RechercheAide } from './_components/recherche-aide';

export const metadata: Metadata = {
  title: 'Centre d’aide — Lalanda',
  description:
    'Comprendre votre prévisionnel, les ratios que la banque regarde, et comment construire un dossier que votre banquier prendra au sérieux.',
};

export default function CentreAidePage(): React.ReactElement {
  // Construit au build : le contenu est statique, l'index part avec la page.
  const index = construireIndex(ARTICLES);

  return (
    <>
      <section className="bg-ink ink-ruled">
        <div className="mx-auto max-w-6xl px-6 py-14 sm:py-16">
          <p className="font-mono mb-4 text-xs font-medium tracking-[0.18em] text-[var(--on-ink-accent)]">
            CENTRE D’AIDE
          </p>
          <h1 className="font-display max-w-3xl text-[2.4rem] font-black leading-[1.02] tracking-tight text-[var(--on-ink)] sm:text-5xl">
            Comprendre vos chiffres, et ce que la banque en fera.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--on-ink-muted)]">
            Vous n’avez pas besoin d’être comptable pour monter un dossier solide. Ces pages
            expliquent chaque état financier, chaque ratio, et ce qu’il faut corriger quand un
            voyant passe au rouge.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-14">
        <div className="max-w-2xl">
          <RechercheAide index={index} />
        </div>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2">
          {ARTICLES.map((article, i) => (
            <li key={article.slug}>
              <Link
                href={`/aide/${article.slug}`}
                className="group flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]/45 hover:bg-[var(--surface-muted)]"
              >
                <span className="font-mono text-[0.62rem] font-semibold tracking-[0.14em] text-[var(--foreground-muted)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-display mt-1.5 text-[1.15rem] font-bold leading-snug tracking-tight text-[var(--foreground)]">
                  {article.titre}
                </span>
                <span className="mt-2 text-[0.92rem] leading-relaxed text-[var(--foreground-muted)]">
                  {article.resume}
                </span>
                <span className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--border)] pt-3">
                  {article.sections.slice(0, 4).map((section) => (
                    <span
                      key={section.id}
                      className="text-[0.78rem] text-[var(--foreground-muted)]"
                    >
                      {section.titre}
                    </span>
                  ))}
                  {article.sections.length > 4 ? (
                    <span className="text-[0.78rem] text-[var(--foreground-muted)]">
                      +{article.sections.length - 4}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <aside className="mt-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-display text-[1.1rem] font-bold text-[var(--foreground)]">
            Lalanda ne remplace pas un expert-comptable
          </h2>
          <p className="mt-2 max-w-3xl text-[0.92rem] leading-relaxed text-[var(--foreground-muted)]">
            L’outil produit un prévisionnel cohérent, présenté selon le référentiel SYSCOHADA, à
            partir des hypothèses que vous saisissez. Il ne vérifie pas que ces hypothèses sont
            réalistes et ne connaît pas votre situation fiscale particulière. Ces pages décrivent le
            produit tel qu’il fonctionne aujourd’hui, limites comprises. Pour un dossier important,
            faites relire vos chiffres par un professionnel agréé avant de les déposer.
          </p>
        </aside>
      </div>
    </>
  );
}

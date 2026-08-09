// Page d'un article du centre d'aide (S22d).
//
// Statique : les articles sont de la donnée compilée (`lib/aide`), il n'y a rien
// à charger. `generateStaticParams` les pré-rend tous ; un slug inconnu part en
// 404 plutôt que d'afficher une page vide.
//
// La route vit dans le group `(marketing)` pour hériter de l'en-tête et du pied
// de page publics, mais elle N'EST PAS dans `MARKETING_PATHS` (`lib/routes.ts`) :
// ces chemins-là renvoient un utilisateur authentifié vers `/projects`, ce qui
// casserait les liens d'aide contextuels ouverts depuis l'application. Ici, le
// middleware ne fait rien — la page est lisible connecté comme déconnecté.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ARTICLES, articleParSlug } from '@/lib/aide';

import { BlocRendu } from '../_components/blocs';
import { Sommaire } from '../_components/sommaire';

export function generateStaticParams(): { slug: string }[] {
  return ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = articleParSlug(slug);
  if (!article) return { title: 'Aide — Lalanda' };
  return {
    title: `${article.titre} — Aide Lalanda`,
    description: article.resume,
  };
}

export default async function ArticleAidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const article = articleParSlug(slug);
  if (!article) notFound();

  const position = ARTICLES.findIndex((a) => a.slug === article.slug);
  const precedent = position > 0 ? ARTICLES[position - 1] : undefined;
  const suivant = position < ARTICLES.length - 1 ? ARTICLES[position + 1] : undefined;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
      <nav aria-label="Fil d'Ariane" className="font-mono text-[0.68rem] tracking-[0.1em]">
        <Link
          href="/aide"
          className="text-[var(--foreground-muted)] uppercase transition hover:text-[var(--accent)]"
        >
          ← Centre d’aide
        </Link>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
        {/* Colonne de lecture — largeur bornée pour un confort de lecture longue. */}
        <article className="max-w-[42rem] min-w-0">
          <header className="border-b border-[var(--border)] pb-7">
            <h1 className="font-display text-[2.1rem] font-black leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[2.6rem]">
              {article.titre}
            </h1>
            <p className="mt-3.5 text-[1.05rem] leading-relaxed text-[var(--foreground-muted)]">
              {article.resume}
            </p>
          </header>

          {/* Sommaire replié en tête sur mobile, où la colonne latérale n'existe pas. */}
          <div className="mt-7 lg:hidden">
            <Sommaire sections={article.sections} slug={article.slug} />
          </div>

          <div className="mt-10 flex flex-col gap-12">
            {article.sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-8">
                <h2 className="font-display group text-[1.45rem] font-bold leading-tight tracking-tight text-[var(--foreground)]">
                  <Link href={`/aide/${article.slug}#${section.id}`} className="no-underline">
                    {section.titre}
                    <span
                      aria-hidden="true"
                      className="ml-2 text-[var(--border-strong)] opacity-0 transition group-hover:opacity-100"
                    >
                      #
                    </span>
                  </Link>
                </h2>
                <div className="mt-4 flex flex-col gap-5">
                  {section.blocs.map((bloc, i) => (
                    <BlocRendu key={i} bloc={bloc} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <nav
            aria-label="Articles voisins"
            className="mt-14 flex flex-col gap-3 border-t border-[var(--border)] pt-7 sm:flex-row sm:justify-between"
          >
            {precedent ? (
              <Link
                href={`/aide/${precedent.slug}`}
                className="group flex flex-col gap-0.5 rounded-lg border border-[var(--border)] px-4 py-3 transition hover:border-[var(--accent)]/40 sm:max-w-[48%]"
              >
                <span className="font-mono text-[0.6rem] tracking-[0.12em] text-[var(--foreground-muted)]">
                  ← PRÉCÉDENT
                </span>
                <span className="text-[0.92rem] font-medium text-[var(--foreground)]">
                  {precedent.titre}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {suivant ? (
              <Link
                href={`/aide/${suivant.slug}`}
                className="group flex flex-col gap-0.5 rounded-lg border border-[var(--border)] px-4 py-3 text-right transition hover:border-[var(--accent)]/40 sm:max-w-[48%] sm:items-end"
              >
                <span className="font-mono text-[0.6rem] tracking-[0.12em] text-[var(--foreground-muted)]">
                  SUIVANT →
                </span>
                <span className="text-[0.92rem] font-medium text-[var(--foreground)]">
                  {suivant.titre}
                </span>
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="hidden lg:block">
          <Sommaire sections={article.sections} slug={article.slug} />
        </aside>
      </div>
    </div>
  );
}

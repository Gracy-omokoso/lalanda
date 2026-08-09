// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJETS DE DOCUMENTS, NON VALIDÉS JURIDIQUEMENT
// Les textes rendus par ce composant sont des projets rédigés par l'équipe
// produit. Ils doivent être relus par un juriste AVANT toute mise en production.
// Voir docs/28-CONFORMITE-LEGALE.md.
// ─────────────────────────────────────────────────────────────────────────────
//
// Gabarit commun des pages légales (S22c).
//
// Trois exigences de lecture longue, traitées ici une fois pour les cinq pages :
//
// 1. LARGEUR DE LIGNE LIMITÉE (`max-w-[68ch]`). Un texte juridique en pleine
//    largeur d'écran est illisible : l'œil perd la ligne au retour chariot. La
//    contrainte est en `ch` et non en pixels — elle suit la taille de police
//    choisie par le lecteur.
// 2. SOMMAIRE ET ANCRES. Chaque section porte un `id` stable : c'est ce qui
//    permet de citer « CGU § 7 » par un lien qui atterrit au bon endroit.
//    `scroll-mt` évite que l'ancre se cale sous le bord haut de la fenêtre.
// 3. DATE DE MISE À JOUR EN TÊTE. Le lecteur doit savoir quel état du texte il
//    lit avant de le lire, pas après.
//
// Identité « dossier bancaire » : en-tête sur panneau encre, libellé de section
// en mono, corps sur papier registre.

import Link from 'next/link';

import {
  LEGAL_REVIEWED_BY_COUNSEL,
  LEGAL_VERSION,
  legalDocument,
  type LegalSlug,
} from '@/lib/legal';

export interface LegalSection {
  /** Ancre stable — ne jamais la renommer : des liens externes peuvent la citer. */
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Date affichée en français long à partir d'un `YYYY-MM-DD`. */
export function formatLegalDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function LegalPage({
  slug,
  lead,
  sections,
}: {
  slug: LegalSlug;
  /** Phrase d'introduction, affichée avant le sommaire. */
  lead: React.ReactNode;
  sections: readonly LegalSection[];
}): React.ReactElement {
  const doc = legalDocument(slug);

  return (
    <>
      <section className="bg-ink ink-ruled">
        <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
          <div className="max-w-[68ch]">
            <p className="font-mono mb-4 text-xs font-medium tracking-[0.18em] text-[var(--on-ink-accent)]">
              DOCUMENT LÉGAL
            </p>
            <h1 className="font-display text-3xl font-black tracking-tight text-[var(--on-ink)] sm:text-4xl">
              {doc.title}
            </h1>
            <dl className="font-mono mt-5 flex flex-wrap gap-x-8 gap-y-2 text-xs text-[var(--on-ink-muted)]">
              <div className="flex gap-2">
                <dt>DERNIÈRE MISE À JOUR</dt>
                <dd className="text-[var(--on-ink)]">
                  <time dateTime={doc.updatedAt}>{formatLegalDate(doc.updatedAt)}</time>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt>VERSION DU CORPUS</dt>
                <dd className="text-[var(--on-ink)]">{LEGAL_VERSION}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <DraftNotice />

        <div className="lg:flex lg:gap-12">
          <TableOfContents sections={sections} />

          <article className="min-w-0 max-w-[68ch] flex-1">
            <div className="text-[0.98rem] leading-7 text-[var(--foreground)]">{lead}</div>

            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="mt-12 scroll-mt-24">
                <h2 className="font-display flex items-baseline gap-3 text-xl font-bold tracking-tight">
                  <span
                    aria-hidden="true"
                    className="font-mono text-sm font-medium text-[var(--foreground-muted)]"
                  >
                    {index + 1}.
                  </span>
                  {section.title}
                </h2>
                <div className="mt-4 flex flex-col gap-4 text-[0.98rem] leading-7">
                  {section.body}
                </div>
              </section>
            ))}

            <hr className="mt-14 border-[var(--border)]" />
            <p className="mt-6 text-sm text-[var(--foreground-muted)]">
              Les autres documents légaux sont accessibles depuis le pied de page :{' '}
              <Link href="/cgu" className="underline underline-offset-4">
                CGU
              </Link>
              ,{' '}
              <Link href="/cgv" className="underline underline-offset-4">
                CGV
              </Link>
              ,{' '}
              <Link href="/confidentialite" className="underline underline-offset-4">
                confidentialité
              </Link>
              ,{' '}
              <Link href="/cookies" className="underline underline-offset-4">
                cookies
              </Link>{' '}
              et{' '}
              <Link href="/mentions-legales" className="underline underline-offset-4">
                mentions légales
              </Link>
              .
            </p>
          </article>
        </div>
      </div>
    </>
  );
}

/**
 * Bandeau « version de travail ».
 *
 * Affiché tant que `LEGAL_REVIEWED_BY_COUNSEL` vaut `false`. Il ne s'agit pas
 * d'une précaution d'équipe laissée par oubli : présenter un projet de CGU comme
 * des CGU définitives est une affirmation fausse faite au lecteur au moment où
 * il décide de s'engager. Le bandeau disparaît de lui-même le jour où la
 * relecture juridique a eu lieu — une seule valeur à changer.
 */
function DraftNotice(): React.ReactElement | null {
  if (LEGAL_REVIEWED_BY_COUNSEL) return null;
  return (
    <div
      role="note"
      className="mb-10 max-w-[68ch] rounded-md border border-[var(--warn)] bg-[var(--surface-muted)] p-4 text-sm leading-6"
    >
      <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--warn)]">
        VERSION DE TRAVAIL
      </p>
      <p className="mt-2">
        Ce texte est un projet rédigé par l&apos;équipe Lalanda. Il n&apos;a pas encore été relu par
        un conseil juridique et plusieurs informations restent à compléter. Il est publié pour
        transparence, non comme un engagement définitif.
      </p>
    </div>
  );
}

function TableOfContents({ sections }: { sections: readonly LegalSection[] }): React.ReactElement {
  return (
    <nav
      aria-label="Sommaire du document"
      className="mb-10 shrink-0 lg:sticky lg:top-8 lg:mb-0 lg:w-60 lg:self-start"
    >
      <p className="font-mono text-xs font-medium tracking-[0.14em] text-[var(--foreground-muted)]">
        SOMMAIRE
      </p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {sections.map((section, index) => (
          <li key={section.id} className="flex gap-2">
            <span aria-hidden="true" className="font-mono text-[var(--foreground-muted)]">
              {index + 1}.
            </span>
            <a
              href={`#${section.id}`}
              className="text-[var(--foreground-muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ─── Fragments de rédaction, partagés par les cinq pages ─────────────────────

/** Liste à puces d'un document légal. */
export function LegalList({ items }: { items: readonly React.ReactNode[] }): React.ReactElement {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-2.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Marqueur d'information que l'éditeur doit renseigner.
 *
 * Rendu VISIBLE et non en commentaire : un `[À COMPLÉTER]` invisible dans une
 * page publiée est exactement la façon dont une mention légale part en
 * production incomplète sans que personne ne s'en aperçoive.
 */
export function ToComplete({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <mark className="font-mono rounded border border-dashed border-[var(--border-strong)] bg-transparent px-1.5 py-0.5 text-[0.85em] text-[var(--foreground-muted)]">
      [À COMPLÉTER : {children}]
    </mark>
  );
}

/** Tableau simple (sous-traitants, durées de conservation). Défile sur mobile. */
export function LegalTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly React.ReactNode[])[];
}): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--border-strong)]">
            {headers.map((h) => (
              <th key={h} scope="col" className="py-2 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--border)] align-top">
              {row.map((cell, j) => (
                <td key={j} className="py-2.5 pr-4 leading-6">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

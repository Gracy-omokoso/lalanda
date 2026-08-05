// Landing publique Lalanda.
// Sections : hero, value prop, secteurs, pays, comment ça marche, ratios bancaires, CTA final.
// Design volontairement sobre — palette existante, pas de gradients, whitespace généreux.
// Le middleware laisse cette route publique ; un visiteur authentifié est redirigé vers /projects.

import Link from 'next/link';

export default function LandingPage(): React.ReactElement {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--accent)]">
              SYSCOHADA · RDC · Afrique de l&apos;Ouest et centrale
            </p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
              Un plan financier bancable en 30 minutes.
            </h1>
            <p className="mt-6 text-lg text-[var(--foreground-muted)] sm:text-xl">
              Générez un dossier prêt pour Rawbank, Equity BCDC, TMB, PADMPME — avec les ratios
              qu&apos;un chargé d&apos;affaires bancaire attend, et la fiscalité de votre pays
              intégrée d&apos;office.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="rounded-md bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90"
              >
                Créer mon compte
              </Link>
              <Link
                href="#exemple"
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
              >
                Voir un exemple
              </Link>
            </div>
            <p className="mt-5 text-sm text-[var(--foreground-muted)]">
              Gratuit pour commencer — aucune carte bancaire requise.
            </p>
          </div>
        </div>
      </section>

      {/* Value prop 3 colonnes */}
      <section className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-6 sm:grid-cols-3">
            <ValueCard
              title="Prêt banque"
              body="DSCR, apport minimum, trésorerie mini, payback : les 5 ratios que les analystes bancaires regardent en premier, avec feux tricolores."
            />
            <ValueCard
              title="Fiscalité locale"
              body="IBP, TVA et charges sociales pré-configurés par pays (RDC, Côte d'Ivoire, Sénégal, OHADA générique). Vous ne réinventez rien."
            />
            <ValueCard
              title="Rapide"
              body="Templates sectoriels pré-remplis (restaurant, quincaillerie, services). Vous ajustez vos hypothèses, on calcule le reste."
            />
          </div>
        </div>
      </section>

      {/* Secteurs */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Templates sectoriels
            </h2>
            <p className="mt-3 text-[var(--foreground-muted)]">
              Chaque template embarque les hypothèses métier — panier moyen, marge type, cycle
              client — issues de nos échanges avec des entrepreneurs du terrain.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <SectorCard
              name="Restaurant"
              body="Couverts par jour, ticket moyen, ratio matière, personnel salle et cuisine. Idéal pour un dossier d'ouverture ou d'agrandissement."
            />
            <SectorCard
              name="Quincaillerie & négoce"
              body="Rotation de stock, marge brute par famille de produits, délai fournisseur. Pensé pour les commerces de gros et détail."
            />
            <SectorCard
              name="Prestation de services"
              body="Taux journalier moyen, taux d'occupation, structure de coûts légère. Consulting, agence, formation, freelance."
            />
          </div>
        </div>
      </section>

      {/* Pays */}
      <section className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-10 sm:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pays supportés</h2>
              <p className="mt-3 max-w-xl text-[var(--foreground-muted)]">
                Chaque pack pays contient l&apos;IBP, la TVA, les charges sociales et les ratios
                bancaires attendus localement — datés et versionnés.
              </p>
              <p className="mt-4 text-sm text-[var(--foreground-muted)]">
                + Cameroun, Bénin, Togo, Mali… via le pack OHADA générique.
              </p>
            </div>
            <div className="flex items-center gap-6 text-4xl sm:text-5xl" aria-hidden="true">
              <span title="RDC">🇨🇩</span>
              <span title="Côte d'Ivoire">🇨🇮</span>
              <span title="Sénégal">🇸🇳</span>
            </div>
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Comment ça marche</h2>
            <p className="mt-3 text-[var(--foreground-muted)]">
              Trois étapes, une trentaine de minutes.
            </p>
          </div>
          <ol className="grid gap-6 sm:grid-cols-3">
            <StepCard
              number="1"
              title="Choisir pays + secteur"
              body="Sélectionnez votre pack pays (RDC, CI, SN, OHADA) et un template sectoriel. Les paramètres fiscaux se chargent automatiquement."
            />
            <StepCard
              number="2"
              title="Ajuster vos hypothèses"
              body="Chiffre d'affaires, coûts, investissement, apport, financement. Chaque champ est expliqué, chaque calcul est traçable."
            />
            <StepCard
              number="3"
              title="Exporter le PDF"
              body="Compte d'exploitation, plan de financement, trésorerie, projection 3 ans, ratios. Un dossier propre à déposer en banque."
            />
          </ol>
        </div>
      </section>

      {/* Ratios bancaires — ancre exemple */}
      <section id="exemple" className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Ratios bancaires, avec feux tricolores
            </h2>
            <p className="mt-3 text-[var(--foreground-muted)]">
              Exemple concret — restaurant à Kinshasa, 60 couverts par jour, ticket moyen 12 USD.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <RatioPill label="Marge EBE" value="18 %" status="ok" hint="Seuil ≥ 15 %" />
              <RatioPill label="Marge nette" value="9 %" status="ok" hint="Seuil ≥ 5 %" />
              <RatioPill label="DSCR" value="1,42" status="ok" hint="Seuil ≥ 1,25" />
              <RatioPill label="Apport" value="28 %" status="ok" hint="Seuil ≥ 25 %" />
              <RatioPill label="Trésorerie mini" value="+ 3 200 USD" status="ok" hint="Seuil ≥ 0" />
            </div>
            <p className="mt-6 text-sm text-[var(--foreground-muted)]">
              Payback investissement : 3 ans 4 mois (seuil ≤ 5 ans). Dossier acceptable en
              l&apos;état par un analyste bancaire local.
            </p>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center sm:p-14">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Prêt à monter votre dossier ?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--foreground-muted)]">
              Créez votre compte, choisissez un template, exportez votre premier plan financier
              aujourd&apos;hui.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="rounded-md bg-[var(--accent)] px-6 py-3 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90"
              >
                Créer un compte gratuit
              </Link>
              <Link
                href="/pricing"
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
              >
                Voir les tarifs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ValueCard({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-[var(--foreground-muted)]">{body}</p>
    </div>
  );
}

function SectorCard({ name, body }: { name: string; body: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h3 className="text-lg font-semibold tracking-tight">{name}</h3>
      <p className="mt-2 text-sm text-[var(--foreground-muted)]">{body}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-muted)] text-sm font-semibold text-[var(--accent)]"
      >
        {number}
      </span>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-[var(--foreground-muted)]">{body}</p>
    </li>
  );
}

// Feux tricolores : les couleurs suivent la palette existante — accent pour OK,
// danger pour KO, foreground-muted pour warning. Pas de nouvelles couleurs custom.
type RatioStatus = 'ok' | 'warn' | 'ko';

function RatioPill({
  label,
  value,
  status,
  hint,
}: {
  label: string;
  value: string;
  status: RatioStatus;
  hint: string;
}): React.ReactElement {
  const dotClass =
    status === 'ok'
      ? 'bg-[var(--accent)]'
      : status === 'ko'
        ? 'bg-[var(--danger)]'
        : 'bg-[var(--foreground-muted)]';

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
          {label}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-[var(--foreground-muted)]">{hint}</div>
    </div>
  );
}

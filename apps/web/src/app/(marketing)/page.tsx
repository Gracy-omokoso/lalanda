// Landing publique Lalanda — direction « dossier bancaire ».
// Le hero présente le produit par son artefact : un document prévisionnel
// SYSCOHADA tamponné BANCABLE, réglure de registre, chiffres mono tabulaires.
// Le middleware laisse cette route publique ; un visiteur authentifié est
// redirigé vers /projects.

import Link from 'next/link';

export default function LandingPage(): React.ReactElement {
  return (
    <>
      {/* Hero — panneau encre + document */}
      <section className="bg-ink ink-ruled">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <p className="font-mono mb-5 text-xs font-medium tracking-[0.18em] text-[var(--on-ink-accent)]">
              SYSCOHADA · AFRIQUE DE L&apos;OUEST ET CENTRALE
            </p>
            <h1 className="font-display text-[2.6rem] font-black leading-[0.98] tracking-tight text-[var(--on-ink)] sm:text-6xl lg:text-[4.2rem]">
              Le dossier que votre banquier attend.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--on-ink-muted)]">
              Compte d&apos;exploitation, trésorerie, plan de financement, ratios — générés en 30
              minutes, avec la fiscalité de votre pays déjà intégrée. Prêt à déposer dans votre
              banque, votre institution de microfinance ou votre dispositif public d&apos;appui aux
              PME.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="rounded-md bg-[var(--stamp)] px-6 py-3.5 text-sm font-semibold text-[var(--stamp-foreground)] transition hover:brightness-110"
              >
                Créer mon dossier
              </Link>
              <Link
                href="#exemple"
                className="rounded-md border border-[var(--ink-border)] px-6 py-3.5 text-sm font-medium text-[var(--on-ink)] transition hover:border-[var(--on-ink-muted)]"
              >
                Voir un exemple
              </Link>
            </div>
            <p className="font-mono mt-6 text-xs tracking-wide text-[var(--on-ink-muted)]">
              GRATUIT POUR COMMENCER — AUCUNE CARTE REQUISE
            </p>
          </div>

          {/* Artefact produit : prévisionnel an 1 tamponné */}
          <div aria-hidden="true" className="hidden justify-self-end lg:block">
            <div className="doc-card hero-doc w-[26rem] p-7">
              <div className="flex items-baseline justify-between border-b border-[#d6cdb9] pb-3">
                <span className="font-mono text-[0.65rem] font-semibold tracking-[0.16em] text-[#6c685a]">
                  PRÉVISIONNEL — EXERCICE 1
                </span>
                <span className="font-mono text-[0.65rem] tracking-wide text-[#6c685a]">USD</span>
              </div>
              <div className="mt-5 space-y-3.5 text-[0.83rem]">
                <div className="ledger-row">
                  <span className="text-[#33424a]">Chiffre d&apos;affaires</span>
                  <span className="leader" />
                  <span className="fig font-medium">262 800</span>
                </div>
                <div className="ledger-row">
                  <span className="text-[#33424a]">Excédent brut d&apos;exploitation</span>
                  <span className="leader" />
                  <span className="fig font-medium">47 300</span>
                </div>
                <div className="ledger-row">
                  <span className="text-[#33424a]">Annuité de crédit</span>
                  <span className="leader" />
                  <span className="fig font-medium">33 310</span>
                </div>
                <div className="mt-2 border-t border-[#d6cdb9] pt-3.5 space-y-3.5">
                  <div className="ledger-row">
                    <span className="flex items-center gap-2 text-[#33424a]">
                      <span className="dot dot-ok" />
                      DSCR
                    </span>
                    <span className="leader" />
                    <span className="fig font-semibold">1,42</span>
                  </div>
                  <div className="ledger-row">
                    <span className="flex items-center gap-2 text-[#33424a]">
                      <span className="dot dot-ok" />
                      Apport propre
                    </span>
                    <span className="leader" />
                    <span className="fig font-semibold">28 %</span>
                  </div>
                  <div className="ledger-row">
                    <span className="flex items-center gap-2 text-[#33424a]">
                      <span className="dot dot-warn" />
                      Trésorerie minimum
                    </span>
                    <span className="leader" />
                    <span className="fig font-semibold">+ 3 200</span>
                  </div>
                </div>
              </div>
              <div className="mt-7 flex items-end justify-between">
                <div className="font-mono text-[0.6rem] leading-relaxed tracking-wide text-[#9e947e]">
                  SYSCOHADA RÉVISÉ
                  <br />
                  PACK RDC 2026 — IBP 30 % · TVA 16 %
                </div>
                <span className="stamp hero-stamp text-sm">Bancable</span>
              </div>
            </div>
          </div>
        </div>

        {/* Ligne banques */}
        <div className="border-t border-[var(--ink-border)]">
          <div className="font-mono mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4 text-[0.65rem] tracking-[0.18em] text-[var(--on-ink-muted)]">
            <span>DOSSIERS CONFORMES AUX ATTENTES DES</span>
            <span className="text-[var(--on-ink)]">BANQUES COMMERCIALES</span>
            <span className="text-[var(--on-ink)]">INSTITUTIONS DE MICROFINANCE</span>
            <span className="text-[var(--on-ink)]">FONDS DE GARANTIE</span>
            <span className="text-[var(--on-ink)]">DISPOSITIFS PUBLICS PME</span>
          </div>
        </div>
      </section>

      {/* Value props — table de registre, pas de cartes */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            <ValueRow
              code="R-01"
              title="Les 5 ratios que l'analyste regarde en premier"
              body="DSCR, apport minimum, trésorerie mini, payback, marge EBE — chacun avec son seuil bancaire et son feu tricolore. Vous savez avant le rendez-vous si le dossier tient."
            />
            <ValueRow
              code="R-02"
              title="La fiscalité de votre pays, déjà dedans"
              body="IBP, TVA et charges sociales pré-configurés par pays — RDC, Côte d'Ivoire, Sénégal, OHADA générique. Chaque taux est sourcé, daté et versionné."
            />
            <ValueRow
              code="R-03"
              title="Un template métier, pas une page blanche"
              body="Restaurant, quincaillerie, services : les hypothèses de terrain sont pré-remplies. Vous ajustez vos chiffres, le moteur calcule tout le reste."
            />
          </div>
        </div>
      </section>

      {/* Secteurs */}
      <section className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Templates sectoriels
            </h2>
            <p className="mt-3 text-[var(--foreground-muted)]">
              Chaque template embarque les hypothèses métier issues de nos échanges avec des
              entrepreneurs du terrain.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <SectorCard
              name="Restaurant"
              hypotheses={['Couverts / jour', 'Ticket moyen', 'Ratio matière']}
              body="Idéal pour un dossier d'ouverture ou d'agrandissement."
            />
            <SectorCard
              name="Quincaillerie & négoce"
              hypotheses={['Rotation de stock', 'Marge par famille', 'Délai fournisseur']}
              body="Pensé pour les commerces de gros et de détail."
            />
            <SectorCard
              name="Prestation de services"
              hypotheses={['Taux journalier', "Taux d'occupation", 'Coûts légers']}
              body="Consulting, agence, formation, freelance."
            />
          </div>
        </div>
      </section>

      {/* Pays */}
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Pays supportés
              </h2>
              <p className="mt-3 max-w-xl text-[var(--foreground-muted)]">
                Chaque pack pays contient l&apos;IBP, la TVA, les charges sociales et les ratios
                bancaires attendus localement — datés et versionnés.
              </p>
              <p className="mt-4 text-sm text-[var(--foreground-muted)]">
                + Cameroun, Bénin, Togo, Mali… via le pack OHADA générique.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <CountryPlate code="CD" name="RD Congo" detail="IBP 30 % · TVA 16 %" />
              <CountryPlate code="CI" name="Côte d'Ivoire" detail="BIC 25 % · TVA 18 %" />
              <CountryPlate code="SN" name="Sénégal" detail="IS 30 % · TVA 18 %" />
            </div>
          </div>
        </div>
      </section>

      {/* Comment ça marche — vraie séquence, numérotation légitime */}
      <section className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Trois étapes, trente minutes
            </h2>
          </div>
          <ol className="grid gap-5 sm:grid-cols-3">
            <StepCard
              number="01"
              title="Choisir pays + secteur"
              body="Sélectionnez votre pack pays et un template sectoriel. Les paramètres fiscaux se chargent automatiquement."
            />
            <StepCard
              number="02"
              title="Ajuster vos hypothèses"
              body="Chiffre d'affaires, coûts, investissement, apport, financement. Chaque champ est expliqué, chaque calcul est traçable."
            />
            <StepCard
              number="03"
              title="Exporter PDF + Excel"
              body="Compte d'exploitation, plan de financement, trésorerie, projection, ratios. Un dossier propre à déposer en banque."
            />
          </ol>
        </div>
      </section>

      {/* Exemple ratios — document papier */}
      <section id="exemple" className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Les feux tricolores du banquier
            </h2>
            <p className="mt-3 text-[var(--foreground-muted)]">
              Exemple — restaurant urbain de 40 places, 60 couverts par jour, ticket moyen 12 USD.
            </p>
          </div>
          <div className="doc-card p-6 sm:p-8">
            <div className="mb-6 flex items-baseline justify-between border-b border-[#d6cdb9] pb-3">
              <span className="font-mono text-[0.65rem] font-semibold tracking-[0.16em] text-[#6c685a]">
                RATIOS BANCAIRES — SYNTHÈSE
              </span>
              <span className="font-mono text-[0.65rem] tracking-wide text-[#6c685a]">
                PACK RDC 2026
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <RatioPill label="Marge EBE" value="18 %" status="ok" hint="Seuil ≥ 15 %" />
              <RatioPill label="Marge nette" value="9 %" status="ok" hint="Seuil ≥ 5 %" />
              <RatioPill label="DSCR" value="1,42" status="ok" hint="Seuil ≥ 1,25" />
              <RatioPill label="Apport" value="28 %" status="ok" hint="Seuil ≥ 25 %" />
              <RatioPill label="Trésorerie mini" value="+ 3 200 USD" status="ok" hint="Seuil ≥ 0" />
            </div>
            <p className="mt-6 text-sm text-[#6c685a]">
              Payback investissement : 3 ans 4 mois (seuil ≤ 5 ans). Dossier acceptable en
              l&apos;état par un analyste bancaire local.
            </p>
          </div>
        </div>
      </section>

      {/* CTA final — écho du panneau encre */}
      <section className="bg-ink ink-ruled">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-display mx-auto max-w-2xl text-3xl font-black tracking-tight text-[var(--on-ink)] sm:text-5xl">
            Votre dossier mérite le tampon.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[var(--on-ink-muted)]">
            Créez votre compte, choisissez un template, exportez votre premier plan financier
            aujourd&apos;hui.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="rounded-md bg-[var(--stamp)] px-6 py-3.5 text-sm font-semibold text-[var(--stamp-foreground)] transition hover:brightness-110"
            >
              Créer un compte gratuit
            </Link>
            <Link
              href="/pricing"
              className="rounded-md border border-[var(--ink-border)] px-6 py-3.5 text-sm font-medium text-[var(--on-ink)] transition hover:border-[var(--on-ink-muted)]"
            >
              Voir les tarifs
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function ValueRow({
  code,
  title,
  body,
}: {
  code: string;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <div className="grid gap-3 py-7 sm:grid-cols-[6rem_1fr_1.2fr] sm:gap-8">
      <span className="fig pt-1 text-xs font-medium text-[var(--accent)]">{code}</span>
      <h3 className="font-display text-xl font-bold leading-snug tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">{body}</p>
    </div>
  );
}

function SectorCard({
  name,
  hypotheses,
  body,
}: {
  name: string;
  hypotheses: string[];
  body: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h3 className="font-display text-lg font-bold tracking-tight">{name}</h3>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {hypotheses.map((h) => (
          <li
            key={h}
            className="font-mono rounded border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[0.65rem] tracking-wide text-[var(--foreground-muted)]"
          >
            {h}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-[var(--foreground-muted)]">{body}</p>
    </div>
  );
}

function CountryPlate({
  code,
  name,
  detail,
}: {
  code: string;
  name: string;
  detail: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="fig text-lg font-semibold text-[var(--accent)]">{code}</span>
      <div className="leading-tight">
        <div className="text-sm font-semibold">{name}</div>
        <div className="fig text-[0.65rem] text-[var(--foreground-muted)]">{detail}</div>
      </div>
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
      <span className="fig text-sm font-semibold text-[var(--accent)]">{number}</span>
      <h3 className="font-display mt-3 text-lg font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">{body}</p>
    </li>
  );
}

// Feux tricolores : pastille + statut texte implicite dans le hint (jamais couleur seule).
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
  const dotClass = status === 'ok' ? 'dot-ok' : status === 'ko' ? 'dot-ko' : 'dot-warn';

  return (
    <div className="rounded-md border border-[#d6cdb9] bg-[#eee7d7] p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`dot ${dotClass}`} />
        <span className="font-mono text-[0.62rem] font-medium tracking-[0.12em] text-[#6c685a]">
          {label.toUpperCase()}
        </span>
      </div>
      <div className="fig mt-2 text-2xl font-semibold tracking-tight text-[#14191b]">{value}</div>
      <div className="fig mt-1 text-[0.65rem] text-[#6c685a]">{hint}</div>
    </div>
  );
}

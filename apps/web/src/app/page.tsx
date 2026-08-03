import Link from 'next/link';

import { PlanWizard } from './_components/plan-wizard';

export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Lalanda</h1>
        <p className="text-base opacity-70">
          Planification financière bancable — SYSCOHADA, RDC-first.
        </p>
      </header>

      <section className="rounded-xl border border-black/10 bg-white/40 p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h2 className="mb-4 text-xl font-semibold">Démo · Template « hello-world »</h2>
        <p className="mb-6 text-sm opacity-70">
          Ajuste les hypothèses, l&apos;API évalue les formules avec le moteur (
          <code className="rounded bg-black/5 px-1 py-0.5 text-xs dark:bg-white/10">
            packages/engine
          </code>
          ) et affiche les résultats.
        </p>
        <PlanWizard />
      </section>

      <footer className="flex gap-4 text-xs opacity-50">
        <Link href="/health" className="underline underline-offset-4">
          /health
        </Link>
        <a
          href="https://github.com/Gracy-omokoso/lalanda"
          className="underline underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        <span>Sprint S3 — démo API + wizard.</span>
      </footer>
    </main>
  );
}

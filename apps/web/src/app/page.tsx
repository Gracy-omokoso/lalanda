import Link from 'next/link';

export default function HomePage(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Lalanda</h1>
      <p className="max-w-xl text-center text-lg opacity-80">
        Planification financière bancable pour entrepreneurs et PME — SYSCOHADA, RDC-first.
      </p>
      <div className="flex gap-4 text-sm">
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
      </div>
      <p className="text-xs opacity-50">Sprint S0 — squelette monorepo.</p>
    </main>
  );
}

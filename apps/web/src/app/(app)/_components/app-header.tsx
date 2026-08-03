'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { signOut, useSession } from '@/lib/auth-client';

export function AppHeader(): React.ReactElement {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-black/10 pb-4 dark:border-white/10">
      <Link href="/projects" className="flex flex-col">
        <span className="text-lg font-semibold tracking-tight">Lalanda</span>
        <span className="text-xs opacity-60">Planification financière bancable</span>
      </Link>
      <div className="flex items-center gap-4 text-sm">
        {isPending ? (
          <span className="opacity-50">…</span>
        ) : session?.user ? (
          <>
            <span className="opacity-70">{session.user.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Déconnexion
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}

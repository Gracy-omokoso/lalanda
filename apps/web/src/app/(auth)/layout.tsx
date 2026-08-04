import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]"
          >
            L
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight">Lalanda</span>
            <span className="text-xs text-[var(--foreground-muted)]">
              Plan financier bancable en 30 min
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>
      <main className="flex flex-1 flex-col justify-center">{children}</main>
    </div>
  );
}

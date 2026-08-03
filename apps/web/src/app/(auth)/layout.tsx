export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Lalanda</h1>
        <p className="text-sm opacity-60">Planification financière bancable.</p>
      </header>
      {children}
    </main>
  );
}

// `/ventes/devis/nouveau` — composition d'un devis (ADR-0035), éventuellement
// depuis une opportunité du CRM (`?opportunite=…&client=…&nom=…`).

import type { Metadata } from 'next';

import { QuoteEditor } from '../_components/quote-editor';

export const metadata: Metadata = { title: 'Nouveau devis — Ventes · Lalanda' };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const un = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : null);
  const client = un(sp['client']);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Nouveau devis</h2>
      <QuoteEditor
        vueInitiale={null}
        opportunityId={un(sp['opportunite'])}
        clientInitial={client ? { id: client, nom: un(sp['nom']) ?? 'Client' } : null}
      />
    </section>
  );
}

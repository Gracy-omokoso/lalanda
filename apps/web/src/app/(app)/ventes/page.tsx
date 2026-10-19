// `/ventes` n'a pas de contenu propre : il ouvre l'onglet Factures (ADR-0023).

import { redirect } from 'next/navigation';

export default function SalesIndexPage(): never {
  redirect('/ventes/factures');
}

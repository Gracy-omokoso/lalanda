// `/ventes` n'a pas de contenu propre : il ouvre l'onglet Clients.

import { redirect } from 'next/navigation';

export default function SalesIndexPage(): never {
  redirect('/ventes/clients');
}

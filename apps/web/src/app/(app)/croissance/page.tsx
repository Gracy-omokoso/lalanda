// `/croissance` n'a pas de contenu propre : il ouvre l'onglet Santé (ADR-0032).

import { redirect } from 'next/navigation';

export default function CroissanceIndexPage(): never {
  redirect('/croissance/sante');
}

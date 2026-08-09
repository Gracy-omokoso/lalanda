// Rendu du texte enrichi du centre d'aide (S22d).
// L'analyse vit dans `lib/aide/texte.ts` (pure, testée) ; ici, uniquement du rendu.

import Link from 'next/link';

import { analyserTexte } from '@/lib/aide/texte';

export function TexteRiche({ texte }: { texte: string }): React.ReactElement {
  return (
    <>
      {analyserTexte(texte).map((segment, i) => {
        // Index comme clé : la liste est dérivée d'une chaîne constante, jamais
        // réordonnée ni filtrée. Aucun état local n'y est attaché.
        const key = `${segment.type}-${i}`;

        if (segment.type === 'gras') {
          return (
            <strong key={key} className="font-semibold text-[var(--foreground)]">
              {segment.texte}
            </strong>
          );
        }

        if (segment.type === 'lien') {
          return (
            <Link
              key={key}
              href={segment.href}
              className="font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 transition hover:decoration-[var(--accent)]"
            >
              {segment.texte}
            </Link>
          );
        }

        return <span key={key}>{segment.texte}</span>;
      })}
    </>
  );
}

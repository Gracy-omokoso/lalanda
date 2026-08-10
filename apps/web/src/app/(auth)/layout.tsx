import Link from 'next/link';

import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Coquille des écrans d'authentification — `/login`, `/register`,
 * `/mot-de-passe-oublie`, `/nouveau-mot-de-passe`, `/verification-email`.
 *
 * ── Pourquoi la marque n'est pas dans une barre en haut ──────────────────────
 * Elle y était, et elle s'en détachait : le formulaire est centré
 * verticalement, la barre restait collée en haut de la fenêtre, et sur un
 * écran de bureau les deux se retrouvaient séparés par un vide de plusieurs
 * centaines de pixels. Le logo se lisait alors comme un élément orphelin
 * plutôt que comme l'en-tête de ce qu'on est en train de faire.
 *
 * Le lockup fait désormais partie du bloc centré : il précède immédiatement le
 * titre de la page (« Bon retour », « Créer un compte », …) et se déplace avec
 * lui. Seul le bouton de thème reste en haut, seul sur sa ligne — il commande
 * la page entière, pas le formulaire, et le mettre dans le bloc centré le
 * ferait passer pour une option du formulaire.
 *
 * ── `my-auto` plutôt que `justify-center` ────────────────────────────────────
 * Les deux donnent ici le MÊME rendu, y compris quand le contenu déborde :
 * mesuré sur `/register` (le formulaire le plus long) à 375×812 puis 375×500,
 * le haut du bloc tombe à 88 px dans les deux cas. La coquille est en
 * `min-h-screen` et non `h-screen`, donc `main` grandit avec son contenu et
 * `justify-center` n'a jamais d'espace libre négatif à répartir — le mode de
 * défaillance classique (haut du bloc rejeté au-dessus du bord, hors d'atteinte
 * du défilement) ne se déclenche pas.
 *
 * `my-auto` est gardé parce qu'il reste correct si la coquille passait un jour
 * en hauteur fixe, où `justify-center` couperait le logo et le titre. C'est une
 * précaution, pas la correction d'un bug observé.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-6">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 flex-col">
        <div className="my-auto flex flex-col gap-8 py-8">
          {/* La marque est un lien vers l'accueil : ces pages sont souvent la
              première du produit qu'on voit (un lien d'email, un partage), et
              elles n'offraient aucune sortie vers le site public. Le lockup
              porte déjà le mot « Lalanda », d'où la baseline seule en dessous.

              `self-center` borne la zone cliquable au contenu : sans lui, le
              lien s'étire sur toute la largeur de la colonne et on cliquerait
              vers l'accueil en visant le vide à côté du logo.

              `BrandLogo` est décoratif (`alt=""`, `aria-hidden`) et ne fournit
              aucun nom accessible — d'où l'`aria-label` ici, sans quoi le lien
              serait muet. C'est le seul logo de la page depuis la suppression
              de la barre du haut : pas de nom en double. */}
          <Link
            href="/"
            aria-label="Lalanda — accueil"
            className="flex flex-col items-center gap-2 self-center transition hover:opacity-80"
          >
            <BrandLogo hauteur={44} />
            <span className="text-xs text-[var(--foreground-muted)]">
              Plan financier bancable en 30 min
            </span>
          </Link>

          {children}
        </div>
      </main>
    </div>
  );
}

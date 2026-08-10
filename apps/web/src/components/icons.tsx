// Icônes au trait — géométrie officielle de Lucide (https://lucide.dev), v1.31.0, ISC.
//
// Pourquoi des composants locaux plutôt que la dépendance `lucide-react` :
// l'interface n'utilise aujourd'hui que trois icônes. Le paquet pèse 31,2 Mo
// décompressés (4 090 fichiers) à l'installation pour livrer, au bout de la
// chaîne, les quelques centaines d'octets de tracé ci-dessous — le reste est
// éliminé par le tree-shaking. Rien n'est perdu à les inscrire ici : ce sont
// les mêmes courbes, sous la même licence.
//
// La bascule vers le paquet reste triviale le jour où le nombre d'icônes la
// justifie : l'API est volontairement calquée sur celle de `lucide-react`
// (`className`, `strokeWidth`, viewBox 24×24, `stroke="currentColor"`), si bien
// que remplacer `@/components/icons` par `lucide-react` dans les imports suffit,
// sans toucher une seule balise.
//
// Ces icônes sont décoratives : elles sont `aria-hidden` et ne portent aucun
// nom accessible. Le sens vient de l'`aria-label` du bouton qui les contient —
// une icône muette doublée d'un bouton muet serait invisible au lecteur d'écran
// (docs/04-UX-UI.md : « jamais une icône muette »).

interface IconProps {
  /** Taille et couleur se règlent en CSS : `h-4 w-4`, la couleur suit `currentColor`. */
  className?: string;
  /**
   * Épaisseur du trait, exprimée dans le repère 24×24 de l'icône. La valeur 2
   * de Lucide est conservée par défaut : à 16 px de rendu elle donne un trait
   * d'environ 1,3 px, qui s'accorde à la graisse du texte d'interface.
   */
  strokeWidth?: number;
}

/** Attributs communs à toutes les icônes du jeu — la « signature » Lucide. */
function traits(strokeWidth: number, className?: string): React.SVGProps<SVGSVGElement> {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    className,
  };
}

/** Soleil — Lucide `sun`. Proposé quand le thème sombre est actif. */
export function IconeSoleil({ className, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <svg {...traits(strokeWidth, className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

/** Lune — Lucide `moon`. Proposée quand le thème clair est actif. */
export function IconeLune({ className, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <svg {...traits(strokeWidth, className)}>
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

/** Point d'interrogation cerclé — Lucide `circle-help`. Déclencheur des infobulles. */
export function IconeAide({ className, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <svg {...traits(strokeWidth, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

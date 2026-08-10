// Le lockup de marque — aigle + mot-symbole.
//
// Deux fichiers, un par fond de destination (voir `public/marque/README.md`) :
// `fond-clair` porte un badge OPAQUE encre (#07171c) et un mot-symbole encre;
// `fond-sombre` un badge TRANSPARENT cerclé cyan et un mot-symbole crème —
// vérifié au pixel, pas au coup d'œil : un visualiseur d'images compose la
// transparence sur du blanc et fait croire à un badge blanc plein. Le badge
// laissant passer le fond, la version fond sombre s'adapte à n'importe quel
// fond foncé, y compris le pétrole des panneaux `.bg-ink`.
// Il n'existe pas de SVG : la source livrée est du PNG, et rien ici n'en
// fabrique un.
//
// ── Pourquoi les deux <img> sont rendues, et pas une seule choisie en JS ──────
// Le thème vit dans `data-theme` sur <html>, posé par le script anti-FOUC de
// `app/layout.tsx` AVANT le premier paint et modifié à chaud par `ThemeToggle`.
// Choisir le fichier en JS supposerait de lire ce thème après le montage, donc
// de rendre d'abord la mauvaise image (scintillement) ou rien (saut de mise en
// page), et d'exposer un écart d'hydratation. Ici les deux balises sont dans le
// HTML servi, le CSS en masque une (`app/globals.css`, section « Marque »), et
// la bascule à chaud ne coûte qu'un changement d'attribut : aucun rendu React,
// aucune requête réseau au moment du clic — les deux fichiers sont déjà là.
//
// Les deux balises portent les MÊMES `width`/`height`, donc la boîte est
// identique quel que soit le thème : rien ne bouge à la bascule, et la place
// est réservée avant même le décodage de l'image.
//
// ── Accessibilité : ce composant ne porte JAMAIS le nom accessible ───────────
// Les images sont décoratives (`alt=""`). Deux raisons : elles vont par paire
// et un `alt` renseigné se lirait en double, et le mot « Lalanda » est déjà à
// côté — soit en texte visible, soit via l'`aria-label` du lien qui enveloppe
// le logo. **L'appelant doit donc garantir le nom accessible.** Un lien qui ne
// contiendrait que ce composant et aucun `aria-label` serait un lien muet.

const RATIO_LOCKUP = 1024 / 273;

/**
 * `theme` : le fond est celui du thème courant (`--background`), la paire
 * bascule avec lui. `encre` : le fond est un panneau `.bg-ink` — `--ink` vaut
 * `#005263` dans les DEUX thèmes, donc la version fond sombre y est la bonne en
 * permanence; y brancher la bascule poserait le lockup encre sur de l'encre.
 */
export type FondMarque = 'theme' | 'encre';

export function BrandLogo({
  hauteur,
  fond = 'theme',
  className = '',
}: {
  /** Hauteur de rendu en pixels CSS. La largeur en découle, ratio préservé. */
  hauteur: number;
  fond?: FondMarque;
  className?: string;
}): React.ReactElement {
  const largeur = Math.round(hauteur * RATIO_LOCKUP);

  // Les attributs `width`/`height` réservent le rapport d'aspect avant le
  // décodage (le navigateur en dérive `aspect-ratio`), donc la place est prise
  // dès le premier layout. Le style ne fixe QUE la hauteur et laisse la largeur
  // en `auto` : imposer les deux avec une largeur arrondie à l'entier étirerait
  // le logo de ~0,4 % (30 × 1024/273 = 112,5, arrondi à 113). Ici la largeur
  // découle du ratio exact du fichier.
  //
  // `shrink-0` n'est pas cosmétique. Ces images vivent dans des conteneurs
  // flex (barres d'en-tête) : sans lui, flexbox réduit la LARGEUR de l'image
  // quand la barre est à l'étroit alors que la hauteur reste imposée par le
  // style — le logo est alors écrasé horizontalement. Constaté à 375 px sur
  // l'en-tête marketing : 128 px demandés, 96 px rendus, mot-symbole comprimé.
  const commun = {
    alt: '',
    'aria-hidden': true as const,
    width: largeur,
    height: hauteur,
    style: { width: 'auto', height: hauteur },
    draggable: false,
    decoding: 'async' as const,
  };

  if (fond === 'encre') {
    return (
      <img
        {...commun}
        src="/marque/logo-lalanda-fond-sombre.png"
        className={`shrink-0 ${className}`}
      />
    );
  }

  return (
    <>
      <img
        {...commun}
        src="/marque/logo-lalanda-fond-clair.png"
        className={`marque-fond-clair shrink-0 ${className}`}
      />
      <img
        {...commun}
        src="/marque/logo-lalanda-fond-sombre.png"
        className={`marque-fond-sombre shrink-0 ${className}`}
      />
    </>
  );
}

/**
 * L'aigle seul, carré, sur fond transparent — la marque sans le mot-symbole.
 *
 * Un seul fichier pour les deux thèmes, et c'est vérifié plutôt que supposé :
 * le teal de l'aigle est plus clair qu'un fond sombre et plus foncé qu'un fond
 * clair, et le bec crème donne un point d'accroche dans les deux cas (même
 * constat qu'au favicon, `public/marque/README.md`).
 *
 * Sert là où le lockup complet ne tient pas — la barre applicative sous 640 px.
 * Décoratif comme `BrandLogo` : le nom accessible reste à l'appelant.
 */
export function BrandMark({
  taille,
  className = '',
}: {
  taille: number;
  className?: string;
}): React.ReactElement {
  return (
    <img
      src="/marque/aigle-seul.png"
      alt=""
      aria-hidden="true"
      width={taille}
      height={taille}
      style={{ width: taille, height: taille }}
      draggable={false}
      decoding="async"
      className={`shrink-0 ${className}`}
    />
  );
}

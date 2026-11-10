// Icône des onglets propre à l'organisation — ADR-0073 § 3.
//
// Le favicon Lalanda (`app/icon.png`) reste la valeur par défaut, posée par Next.
// `applyFavicon(url)` remplace l'`href` des balises d'icône existantes par l'URL
// signée du favicon de l'organisation ; `applyFavicon(null)` remet l'original.
// Aucune donnée de l'organisation n'entre dans l'URL : c'est un jeton opaque.

const ORIGINAL = 'data-lalanda-icon';

function iconLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
}

export function applyFavicon(url: string | null): void {
  if (typeof document === 'undefined') return;
  let links = iconLinks();
  if (links.length === 0 && url) {
    const l = document.createElement('link');
    l.rel = 'icon';
    document.head.appendChild(l);
    links = [l];
  }
  for (const l of links) {
    if (!l.hasAttribute(ORIGINAL)) l.setAttribute(ORIGINAL, l.getAttribute('href') ?? '');
    const original = l.getAttribute(ORIGINAL) ?? '';
    if (url) {
      l.href = url;
      l.type = 'image/png';
    } else if (original) {
      l.href = original;
    }
  }
}

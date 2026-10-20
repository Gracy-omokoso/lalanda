// Version du logiciel affichée à l'écran — ADR-0026 § 6.2 (écart C1).
//
// `NEXT_PUBLIC_APP_VERSION` est inlinée AU BUILD par `next.config.mjs` : la
// version de l'étiquette de release (`APP_VERSION`, passée par `deploy.yml` au
// build de l'image), ou à défaut celle du `package.json` suivie de « -dev ».
// L'API publie la sienne sur `/health` ; les deux viennent du même tag au
// déploiement, mais on les affiche toutes deux si elles divergent.

/** Version de l'interface web, figée au build. */
export const WEB_APP_VERSION: string = process.env['NEXT_PUBLIC_APP_VERSION'] || 'inconnue';

/**
 * Texte du pied de page : « Lalanda v0.9.3 », ou
 * « Lalanda v0.9.3 (interface) · v0.9.2 (serveur) » si l'API répond une autre
 * version. `api` vaut `null` tant que `/health` n'a pas répondu.
 */
export function libelleVersion(web: string, api: string | null): string {
  if (api === null || api === web) return `Lalanda v${web}`;
  return `Lalanda v${web} (interface) · v${api} (serveur)`;
}

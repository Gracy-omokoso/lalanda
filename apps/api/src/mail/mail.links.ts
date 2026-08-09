// Les URL que contiennent les emails (S22a).
//
// Rassemblées ici, et pas construites à l'endroit de chaque envoi, pour une
// raison précise : un lien d'email est un contrat entre le serveur qui l'écrit
// et une page web qui doit exister. Éparpiller `${WEB_URL}/…` dans trois modules
// garantit qu'un renommage de route en casse un sans que rien ne le signale.
// Ici, les quatre destinations se relisent d'un coup d'œil et se testent.
//
// Deux origines distinctes, et il faut savoir laquelle :
//  - `WEB_URL` — les pages Next.js (acceptation d'invitation, nouveau mot de
//    passe, confirmation de changement d'adresse). L'utilisateur atterrit sur
//    une interface.
//  - `API_URL` — la vérification d'email de better-auth, qui consomme le jeton
//    côté serveur PUIS redirige vers le web. Le jeton est signé par better-auth
//    et n'est vérifiable que par lui ; passer par une page web d'abord ajouterait
//    un aller-retour sans rien apporter.

/** Origine du front. Défaut aligné sur `.env.example` et `app.module.ts`. */
export function webUrl(): string {
  return trimSlash(process.env['WEB_URL'] ?? 'http://localhost:3000');
}

/** Origine de l'API. Doit correspondre au `baseURL` passé à better-auth. */
export function apiUrl(): string {
  return trimSlash(process.env['API_URL'] ?? 'http://localhost:3001');
}

/** Page d'acceptation d'une invitation — `apps/web/src/app/(app)/invitations/accept`. */
export function invitationUrl(token: string): string {
  return `${webUrl()}/invitations/accept?token=${encodeURIComponent(token)}`;
}

/** Page de confirmation d'un changement d'adresse — `apps/web/src/app/(auth)/verification-email`. */
export function emailChangeVerificationUrl(token: string): string {
  return `${webUrl()}/verification-email?token=${encodeURIComponent(token)}`;
}

/** Page de choix d'un nouveau mot de passe — `apps/web/src/app/(auth)/nouveau-mot-de-passe`. */
export function passwordResetUrl(token: string): string {
  return `${webUrl()}/nouveau-mot-de-passe?token=${encodeURIComponent(token)}`;
}

/**
 * Vérification d'adresse à l'inscription — endpoint better-auth, puis redirection.
 *
 * On reconstruit l'URL plutôt que d'utiliser celle fournie par better-auth :
 * la sienne redirige vers le `callbackURL` du corps de la requête d'inscription,
 * c'est-à-dire `/` (relatif à l'API) quand le client ne le précise pas. Le
 * destinataire tomberait sur une réponse JSON. Ici, la destination est décidée
 * par le serveur et ne dépend pas de ce que le client a bien voulu envoyer.
 */
export function signupVerificationUrl(token: string): string {
  const callback = `${webUrl()}/login?verifie=1`;
  return (
    `${apiUrl()}/auth/verify-email?token=${encodeURIComponent(token)}` +
    `&callbackURL=${encodeURIComponent(callback)}`
  );
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

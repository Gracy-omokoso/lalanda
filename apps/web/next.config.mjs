// Headers de sécurité — voir docs/17-SECURITE.md « Application ».
//
// S16a posait `X-Frame-Options: DENY` et un en-tête nommé `Content-Security-Policy`
// ne contenant que `frame-ancestors 'none'`. Le nom laissait croire à une CSP;
// c'était une protection anti-clickjacking et rien d'autre : sans `default-src`,
// aucune source n'était restreinte et une exfiltration vers un hôte arbitraire
// n'était en rien gênée.
//
// S22e complète la politique avec ce qui se pose SANS risque de régression :
// bornes de destination (`connect-src`, `form-action`), suppression des vecteurs
// passifs (`object-src`, `base-uri`), et HSTS.
//
// ── Limite assumée, à lever hors de ce périmètre ─────────────────────────────
// `script-src` conserve `'unsafe-inline'`. Deux inline sont en jeu : les scripts
// d'amorçage que Next injecte pour le protocole RSC, et le mini-script anti-FOUC
// de `src/app/layout.tsx`. La cible est une CSP par nonce — Next propage
// automatiquement un nonce à SES scripts dès que l'en-tête en porte un, mais le
// script de `layout.tsx` doit alors recevoir `nonce={…}` à la main. `layout.tsx`
// appartient à un autre chantier en cours (S22e §périmètre) : poser un
// `script-src` strict ici sans cette modification casserait l'application. Le
// reste de la politique a donc été durci maintenant, et la migration par nonce
// est un finding ouvert de docs/29-AUDIT-SECURITE-S22e.md.

/**
 * Destination des `fetch` du navigateur : l'API vit sur une autre origine
 * (`NEXT_PUBLIC_API_URL`, inlinée au build — voir apps/web/Dockerfile). Sans
 * cette valeur, `connect-src 'self'` bloquerait toutes les requêtes de données.
 */
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    return new URL(raw).origin;
  } catch {
    // Une valeur illisible ne doit pas produire une CSP silencieusement trouée :
    // on échoue au build plutôt que de servir `connect-src *`.
    throw new Error(`NEXT_PUBLIC_API_URL invalide pour la CSP : « ${raw} »`);
  }
})();

const csp = [
  "default-src 'self'",
  // Voir la limite assumée ci-dessus : `'unsafe-inline'` reste nécessaire tant
  // que le nonce n'est pas câblé dans layout.tsx.
  "script-src 'self' 'unsafe-inline'",
  // Next injecte ses styles critiques en ligne; les polices next/font sont servies
  // depuis l'origine.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  // Le seul appel sortant légitime est l'API. Tout autre hôte est une exfiltration.
  `connect-src 'self' ${apiOrigin}`,
  // Aucun plugin, aucune iframe, aucun worker tiers.
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  // Un `<base>` injecté détournerait toutes les URL relatives de la page.
  "base-uri 'none'",
  // Empêche un formulaire injecté de poster les identifiants ailleurs.
  "form-action 'self'",
  // Doublon moderne de X-Frame-Options (clickjacking) — déjà présent en S16a.
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Caddy pose déjà HSTS en production (Caddyfile § securite). On le pose aussi
  // ici : la défense ne doit pas dépendre d'un reverse-proxy que l'application
  // ne contrôle pas, et un déploiement sans Caddy resterait sinon dégradable.
  // Pas de `preload` : il est irréversible et se décide au niveau du domaine.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Aucune de ces API n'est utilisée par Lalanda. Les refuser explicitement
  // limite ce qu'un script injecté pourrait atteindre.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build autonome pour l'image Docker (apps/web/Dockerfile, ADR-0009) :
  // `.next/standalone` embarque server.js + les seules dépendances tracées.
  output: 'standalone',
  // `X-Powered-By: Next.js` annonce la pile et sa présence; aucune valeur pour
  // le client, une indication gratuite pour un scanner.
  poweredByHeader: false,
  // Autorise Next.js à transpiler nos packages workspace.
  transpilePackages: ['@lalanda/shared', '@lalanda/ui'],
  experimental: {
    // Optimise le chargement des packages internes.
    optimizePackageImports: ['@lalanda/ui'],
  },
  async headers() {
    return [
      {
        // Toutes les routes, assets inclus.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

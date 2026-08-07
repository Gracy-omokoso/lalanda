// Headers de sécurité (S16a) — voir docs/17-SECURITE.md « Application ».
// L'app ne doit jamais être embarquée dans une iframe (clickjacking) :
// X-Frame-Options (legacy) + CSP frame-ancestors (moderne) posés ensemble.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build autonome pour l'image Docker (apps/web/Dockerfile, ADR-0009) :
  // `.next/standalone` embarque server.js + les seules dépendances tracées.
  output: 'standalone',
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

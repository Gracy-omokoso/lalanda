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
};

export default nextConfig;

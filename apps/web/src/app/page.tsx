// La home redirige selon l'état d'auth :
// - session présente → /projects (dashboard)
// - sinon → /login
// La détection se fait par le middleware Next.js sur le cookie de session
// (voir src/middleware.ts). Ici on garde une redirection serveur explicite
// qui fait office de fallback si le middleware ne matche pas cette route.

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

export default async function HomePage(): Promise<never> {
  const jar = await cookies();
  const authed = SESSION_COOKIE_NAMES.some((n) => jar.get(n)?.value);
  redirect(authed ? '/projects' : '/login');
}

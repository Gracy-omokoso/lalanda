// Client better-auth pour Next.js — utilisé dans les pages login/register et le hook useSession.
// Le baseURL pointe vers apps/api où better-auth est monté sous /auth.

import { createAuthClient } from 'better-auth/react';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export const authClient = createAuthClient({
  baseURL: `${apiUrl}/auth`,
  // Envoi automatique des cookies cross-origin (CORS + credentials côté API sont déjà OK).
  fetchOptions: { credentials: 'include' },
});

export const { useSession, signIn, signUp, signOut } = authClient;

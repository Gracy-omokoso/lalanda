// `/admin/utilisateurs` — comptes de la plateforme (S21b).
//
// Attribuer un rôle plateforme est l'acte le plus lourd de cet espace : il donne
// à un compte l'accès à cette page, donc le pouvoir d'en donner l'accès à
// d'autres. C'est pourquoi il exige `canManagePlatform` côté serveur et pourquoi
// chaque attribution part au journal avec l'auteur, la cible et le rôle.

import type { Metadata } from 'next';

import { UsersPanel } from '../_components/users-panel';

export const metadata: Metadata = { title: 'Utilisateurs — Administration · Lalanda' };

export default function AdminUsersPage(): React.ReactElement {
  return <UsersPanel />;
}

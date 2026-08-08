// `/compte` — profil (S20b).
//
// La page est un simple point de montage : le chrome (titre, onglets) vit dans
// `layout.tsx`, la logique dans `_components/profile-panel.tsx`. Ajouter une
// section de compte se fait en créant un segment sous `compte/` et une entrée
// dans `ACCOUNT_TABS`, sans toucher aux pages existantes.

import type { Metadata } from 'next';

import { ProfilePanel } from './_components/profile-panel';

export const metadata: Metadata = { title: 'Profil — Mon compte · Lalanda' };

export default function AccountProfilePage(): React.ReactElement {
  return <ProfilePanel />;
}

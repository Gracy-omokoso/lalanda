// `/rh/services` — services de l'organisation (ADR-0045 § 2.3, § 3.1) ; lecture
// `hr.read`, création et modification en fenêtre modale (`hr.manage`).

import type { Metadata } from 'next';

import { Services } from '../_components/services';

export const metadata: Metadata = { title: 'Services — Ressources humaines · Lalanda' };

export default function ServicesPage(): React.ReactElement {
  return <Services />;
}

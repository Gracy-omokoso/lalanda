// `/ventes/modele-facture` — galerie des six modèles de facture, aperçu réel,
// options et choix (ADR-0028). Consultation : `sales.read` ; choix :
// `organization.manage`.

import type { Metadata } from 'next';

import { InvoiceTemplateGallery } from '../_components/invoice-template-gallery';

export const metadata: Metadata = { title: 'Modèle de facture — Ventes · Lalanda' };

export default function InvoiceTemplatePage(): React.ReactElement {
  return <InvoiceTemplateGallery />;
}

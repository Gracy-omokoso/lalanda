// Clé de recherche d'un document de vente — ADR-0023 § S25e.14 (`q` cherche
// dans le numéro, la référence de pro forma et le nom du client).

import { searchKeyOf } from '../search.js';

export function invoiceSearchKey(doc: {
  customer: { name: string | null };
  proformaRef: string;
  number: string | null;
}): string {
  return searchKeyOf([doc.number, doc.proformaRef, doc.customer.name]);
}

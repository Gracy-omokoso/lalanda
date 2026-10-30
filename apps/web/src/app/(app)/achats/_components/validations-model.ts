// Validations en attente — ADR-0044 § 2.3 et § 3.2 (`GET /purchases/approvals/pending`).
// Logique pure.
//
// La liste est celle que l'API juge approuvable par l'utilisateur : elle exclut
// ses propres demandes, sauf s'il est l'approbateur unique de l'organisation.
// Le web ne refait pas ce tri ; il présente. Le total TTC est celui du moteur.

import type { PurchaseOrderView } from '@/lib/api-purchases';

import { formatMontant } from '../../ventes/_components/sales-model';

import { formatInstantJour, nomPersonne, type Membre } from './achats-model';
import { numeroCommande, phraseApprobations } from './commandes-model';

export interface LigneValidation {
  id: string;
  numero: string;
  titre: string;
  fournisseur: string;
  montant: string;
  demandeur: string;
  depuis: string;
  progression: string | null;
  /** La demande est celle de l'utilisateur, approuvable parce qu'il est seul approbateur. */
  propreDemande: boolean;
}

export function ligneValidation(
  o: PurchaseOrderView,
  membres: readonly Membre[],
  moi: string | null,
): LigneValidation {
  return {
    id: o.id,
    numero: numeroCommande(o),
    titre: o.title,
    fournisseur: o.supplierName ?? 'Fournisseur non choisi',
    montant: formatMontant(o.totals.total, o.currency),
    demandeur: nomPersonne(membres, o.requestedBy, moi),
    depuis: formatInstantJour(o.updatedAt),
    progression: phraseApprobations(o),
    propreDemande: moi !== null && (o.requestedBy === moi || o.createdBy === moi),
  };
}

export const PHRASE_APPROBATEUR_UNIQUE =
  'Vous êtes le seul approbateur de l’organisation : votre approbation de votre propre demande sera marquée comme telle au journal.';

export const PHRASE_AUCUNE_VALIDATION = 'Aucune demande n’attend votre approbation.';

export const PHRASE_SANS_DROIT_VALIDATION =
  'Approuver une demande d’achat est réservé aux rôles qui ont l’autorité de dépense. Vous pouvez suivre les demandes dans « Demandes et commandes ».';

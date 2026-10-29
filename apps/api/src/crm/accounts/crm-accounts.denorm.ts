// Recopie du compte sur ses contacts, opportunités et activités (ADR-0040 § 2.2 à
// § 2.4). ADR-0040 — C1.
//
// `customerId` (contacts, opportunités, activités), `companyName` (contacts) et
// `prospectName` (opportunités) sont conservés en lecture pour la compatibilité
// N-1 ; ils sont désormais ÉCRITS à partir du compte. Règle de l'ancien contrat,
// gardée telle quelle : une personne d'un client n'a pas de `companyName`, une
// opportunité d'un client n'a pas de `prospectName`.
//
// Les opportunités et les activités sont écrites par la collection NATIVE : leurs
// schémas Mongoose (lots C2 et C4) ne déclarent `accountId` qu'à leur fusion, et
// un modèle `strict` retirerait le champ en silence.

import type { ClientSession, Model } from 'mongoose';

import type {
  CrmActivityDocument,
  CrmContactDocument,
  CrmOpportunityDocument,
} from '../crm.schemas.js';

export interface AccountIdentity {
  id: string;
  name: string;
  customerId: string | null;
}

export interface DenormModels {
  contacts: Model<CrmContactDocument>;
  opportunities: Model<CrmOpportunityDocument>;
  activities: Model<CrmActivityDocument>;
}

export interface DenormCounts {
  contacts: number;
  opportunities: number;
  activities: number;
}

/** Champs dénormalisés d'un contact rattaché à `account`. */
export function contactDenormOf(account: Pick<AccountIdentity, 'name' | 'customerId'>): {
  customerId: string | null;
  companyName: string | null;
} {
  return {
    customerId: account.customerId,
    companyName: account.customerId ? null : account.name,
  };
}

/**
 * Rattache à `target` tout ce qui pointe vers l'un des comptes `fromIds` (le
 * compte lui-même pour une simple recopie, un prospect fusionné sinon), et
 * réécrit les champs dénormalisés. `revision` est incrémentée sur les contacts
 * (écrivain : ce lot) ; les opportunités et activités gardent la leur, comme lors
 * de la règle de gain : seul un champ d'affichage change.
 */
export async function repointToAccount(
  models: DenormModels,
  organizationId: string,
  fromIds: readonly string[],
  target: AccountIdentity,
  actorId: string,
  session?: ClientSession,
): Promise<DenormCounts> {
  const opts = session ? { session } : {};
  const filter = { organizationId, accountId: { $in: [...fromIds] } };
  const contacts = await models.contacts.collection.updateMany(
    filter,
    {
      $set: {
        accountId: target.id,
        ...contactDenormOf(target),
        updatedBy: actorId,
        updatedAt: new Date(),
      },
      $inc: { revision: 1 },
    },
    opts,
  );
  const opportunities = await models.opportunities.collection.updateMany(
    filter,
    {
      $set: {
        accountId: target.id,
        customerId: target.customerId,
        prospectName: target.customerId ? null : target.name,
      },
    },
    opts,
  );
  const activities = await models.activities.collection.updateMany(
    filter,
    { $set: { accountId: target.id, customerId: target.customerId } },
    opts,
  );
  return {
    contacts: contacts.modifiedCount,
    opportunities: opportunities.modifiedCount,
    activities: activities.modifiedCount,
  };
}

/** Nombre de contacts, d'opportunités et d'activités rattachés au compte. */
export async function usageOf(
  models: DenormModels,
  organizationId: string,
  accountId: string,
): Promise<DenormCounts> {
  const filter = { organizationId, accountId };
  const [contacts, opportunities, activities] = await Promise.all([
    models.contacts.collection.countDocuments(filter),
    models.opportunities.collection.countDocuments(filter),
    models.activities.collection.countDocuments(filter),
  ]);
  return { contacts, opportunities, activities };
}

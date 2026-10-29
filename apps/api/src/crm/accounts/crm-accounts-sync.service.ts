// Synchronisation fiche client → compte CRM (ADR-0040 § 2.1). ADR-0040 — C1.
//
// `CustomersService` (Ventes) appelle `onCustomerWritten` APRÈS son écriture, hors
// de toute transaction. La fiche client fait foi ; le compte en recopie le nom et
// l'état actif :
//
//   - fiche créée → compte `customer` créé s'il n'existe pas (idempotent par
//     l'index unique `{ organizationId, customerId }`) ;
//   - renommée, désactivée, réactivée → `name`, `sortName`, `searchKey`, `active`
//     recopiés ;
//   - supprimée (jamais facturée) → le compte REDEVIENT prospect (`customerId:
//     null`, nom conservé), journalisé ; ses contacts, opportunités et activités
//     perdent leur `customerId` dénormalisé.
//
// Une synchronisation ne fait JAMAIS échouer l'écriture de la fiche client : une
// erreur est journalisée et rattrapée par la tâche `crm.accounts-reconcile`.
//
// Conversion prospect → client (`conversion/`) : la fiche est créée par Ventes
// pendant que le prospect attend d'être lié. `withoutAccountCreation` suspend la
// création d'un compte client pour la fiche créée dans ce contexte : c'est le
// prospect qui devient ce compte, avec son identifiant.

import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { Customer, type CustomerDocument } from '../../sales/customer.schema.js';
import { isDuplicateKey } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import {
  CrmActivity,
  CrmContact,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmContactDocument,
  type CrmOpportunityDocument,
} from '../crm.schemas.js';
import {
  CRM_ACCOUNTS_SYSTEM_ACTOR,
  CrmAccount,
  type CrmAccountDocument,
  type CrmAccountLean,
} from './crm-account.schema.js';
import { repointToAccount } from './crm-accounts.denorm.js';
import { accountKeys } from './crm-accounts.service.js';

type CustomerLean = Customer & { _id: Types.ObjectId };

/** Ce que la synchronisation a fait (tests, réconciliation). */
export type SyncOutcome = 'created' | 'updated' | 'unchanged' | 'reverted' | 'skipped' | 'failed';

export interface SyncActor {
  userId: string;
  role: string;
}

@Injectable()
export class CrmAccountsSync {
  private readonly logger = new Logger('CrmComptes');
  private readonly suspended = new AsyncLocalStorage<true>();

  constructor(
    @InjectModel(CrmAccount.name) private readonly accounts: Model<CrmAccountDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(CrmContact.name) private readonly contacts: Model<CrmContactDocument>,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Exécute `fn` sans créer de compte pour une fiche client créée pendant `fn`. */
  withoutAccountCreation<T>(fn: () => Promise<T>): Promise<T> {
    return this.suspended.run(true, fn);
  }

  /** Point d'entrée de Ventes : n'échoue jamais. */
  async onCustomerWritten(
    organizationId: string,
    customerId: string,
    actor?: SyncActor,
  ): Promise<SyncOutcome> {
    try {
      return await this.sync(organizationId, customerId, actor);
    } catch (err) {
      this.logger.error(
        `synchronisation client → compte impossible (organisation ${organizationId}, client ${customerId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'failed';
    }
  }

  /** Synchronisation stricte (la réconciliation compte ses échecs). */
  async sync(organizationId: string, customerId: string, actor?: SyncActor): Promise<SyncOutcome> {
    if (!isObjectIdHex(customerId)) return 'skipped';
    const customer = await this.customers
      .findOne({ _id: new Types.ObjectId(customerId), organizationId })
      .lean<CustomerLean>()
      .exec();
    const account = await this.accounts
      .findOne({ organizationId, customerId })
      .lean<CrmAccountLean>()
      .exec();

    if (!customer) {
      return account ? this.revertToProspect(account, actor) : 'unchanged';
    }
    if (!account) {
      if (this.suspended.getStore()) return 'skipped';
      return this.createFor(customer);
    }
    return this.copyIdentity(account, customer);
  }

  private async createFor(customer: CustomerLean): Promise<SyncOutcome> {
    try {
      await this.accounts.create({
        organizationId: customer.organizationId,
        kind: 'customer',
        customerId: String(customer._id),
        name: customer.name,
        ...accountKeys({ name: customer.name }),
        ownerId: null,
        active: customer.active,
        conversion: null,
        mergedInto: null,
        revision: 1,
        createdBy: CRM_ACCOUNTS_SYSTEM_ACTOR,
        updatedBy: CRM_ACCOUNTS_SYSTEM_ACTOR,
        _schemaVersion: 1,
      });
      return 'created';
    } catch (err) {
      // Course : le compte vient d'être créé ailleurs ; on recopie l'identité.
      if (!isDuplicateKey(err)) throw err;
      const account = await this.accounts
        .findOne({ organizationId: customer.organizationId, customerId: String(customer._id) })
        .lean<CrmAccountLean>()
        .exec();
      return account ? this.copyIdentity(account, customer) : 'unchanged';
    }
  }

  private async copyIdentity(
    account: CrmAccountLean,
    customer: CustomerLean,
  ): Promise<SyncOutcome> {
    const keys = accountKeys({ ...account, name: customer.name });
    if (
      account.name === customer.name &&
      account.active === customer.active &&
      account.sortName === keys.sortName &&
      account.searchKey === keys.searchKey &&
      account.kind === 'customer'
    ) {
      return 'unchanged';
    }
    const res = await this.accounts
      .updateOne(
        { _id: account._id, organizationId: account.organizationId },
        {
          $set: {
            kind: 'customer',
            name: customer.name,
            ...keys,
            active: customer.active,
            updatedBy: CRM_ACCOUNTS_SYSTEM_ACTOR,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    return res.modifiedCount === 1 ? 'updated' : 'unchanged';
  }

  /** Fiche client supprimée : le compte redevient prospect, son fil est conservé. */
  private async revertToProspect(account: CrmAccountLean, actor?: SyncActor): Promise<SyncOutcome> {
    const organizationId = account.organizationId;
    const customerId = account.customerId!;
    const res = await this.accounts
      .updateOne(
        { _id: account._id, organizationId, customerId },
        {
          $set: {
            kind: 'prospect',
            customerId: null,
            updatedBy: actor?.userId ?? CRM_ACCOUNTS_SYSTEM_ACTOR,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.modifiedCount !== 1) return 'unchanged';
    const accountId = String(account._id);
    await repointToAccount(
      { contacts: this.contacts, opportunities: this.opportunities, activities: this.activities },
      organizationId,
      [accountId],
      { id: accountId, name: account.name, customerId: null },
      actor?.userId ?? CRM_ACCOUNTS_SYSTEM_ACTOR,
    );
    await this.audit.record({
      organizationId,
      actorUserId: actor?.userId ?? CRM_ACCOUNTS_SYSTEM_ACTOR,
      actorRole: actor?.role ?? 'system',
      action: 'crm.account.reverted_to_prospect',
      targetType: 'crm_account',
      targetId: accountId,
      metadata: { customerId },
    });
    return 'reverted';
  }
}

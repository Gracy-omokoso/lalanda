// Conversion prospect → client (ADR-0040 § 3.1.1). ADR-0040 — C1.
//
// Module de composition : il importe Ventes (`CustomersService`) et le CRM
// (`CrmAccountsService`), pour que `CrmModule` reste sans dépendance vers Ventes
// (Ventes l'importe pour la synchronisation des comptes).
//
//   - `create` : la fiche client est créée par `CustomersService.create`, avec
//     EXACTEMENT les règles de Ventes (type DGI, NIF obligatoire pour PM/PC/PL,
//     unicité du NIF → `409 CUSTOMER_NIF_EXISTS` avec l'identifiant existant).
//     Le prospect devient ce compte client et GARDE son identifiant.
//   - `link` : rattache une fiche existante. Si elle a déjà son compte (cas
//     normal), le prospect y est fusionné ; sinon il devient son compte.

import type { ConvertCrmAccountBody, CrmAccountView } from '@lalanda/shared/crm';
import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../authz/audit.service.js';
import { CustomersService } from '../../../sales/customers.service.js';
import { CreateCustomerSchema } from '../../../sales/sales.dto.js';
import { invalidRequestOf, issuesOf, staleRevision } from '../../../sales/sales.errors.js';
import type { CrmActor } from '../../crm-settings.service.js';
import { CrmAccountsSync } from '../crm-accounts-sync.service.js';
import { notProspect } from '../crm-accounts.errors.js';
import { CrmAccountsService } from '../crm-accounts.service.js';

export interface ConversionResult {
  account: CrmAccountView;
  customerId: string;
  mode: 'created' | 'linked';
  /** Vrai si le prospect a été fusionné dans le compte existant de la fiche. */
  merged: boolean;
}

@Injectable()
export class CrmAccountConversionService {
  constructor(
    @Inject(CrmAccountsService) private readonly accounts: CrmAccountsService,
    @Inject(CrmAccountsSync) private readonly sync: CrmAccountsSync,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async convert(
    organizationId: string,
    accountId: string,
    body: ConvertCrmAccountBody,
    actor: CrmActor,
  ): Promise<ConversionResult> {
    const prospect = await this.accounts.requireUsable(organizationId, accountId);
    if (prospect.kind !== 'prospect') notProspect();
    if (prospect.revision !== body.expectedRevision) staleRevision(prospect.revision);
    return body.mode === 'create'
      ? this.create(organizationId, accountId, body.customer, body.expectedRevision, actor)
      : this.link(organizationId, accountId, body.customerId, body.expectedRevision, actor);
  }

  private async create(
    organizationId: string,
    accountId: string,
    rawCustomer: Record<string, unknown>,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<ConversionResult> {
    const parsed = CreateCustomerSchema.safeParse(rawCustomer);
    if (!parsed.success) {
      invalidRequestOf(
        issuesOf(parsed.error).map((i) => ({
          ...i,
          path: i.path === '' ? 'customer' : `customer.${i.path}`,
        })),
      );
    }
    // La fiche naît par Ventes ; la synchronisation ne lui crée PAS de compte :
    // c'est le prospect qui le devient.
    const customer = await this.sync.withoutAccountCreation(() =>
      this.customers.create(organizationId, parsed.data, actor),
    );
    try {
      const account = await this.accounts.linkCustomer(
        organizationId,
        accountId,
        { id: customer.id, name: customer.name, active: customer.active },
        'created',
        expectedRevision,
        actor,
      );
      return { account, customerId: customer.id, mode: 'created', merged: false };
    } catch (err) {
      // La fiche existe : elle ne doit pas rester sans compte. Le prospect reste
      // prospect ; « link » le rattachera.
      await this.sync.onCustomerWritten(organizationId, customer.id, actor);
      throw err;
    }
  }

  private async link(
    organizationId: string,
    accountId: string,
    customerId: string,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<ConversionResult> {
    const customer = await this.customers.get(organizationId, customerId);
    const existing = await this.accounts.byCustomerId(organizationId, customer.id);
    if (!existing) {
      const account = await this.accounts.linkCustomer(
        organizationId,
        accountId,
        { id: customer.id, name: customer.name, active: customer.active },
        'linked',
        expectedRevision,
        actor,
      );
      return { account, customerId: customer.id, mode: 'linked', merged: false };
    }
    const merged = await this.accounts.merge(
      organizationId,
      accountId,
      String(existing._id),
      expectedRevision,
      actor,
    );
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm.account.converted',
      targetType: 'crm_account',
      targetId: accountId,
      metadata: { customerId: customer.id, mode: 'linked', into: String(existing._id) },
    });
    return { account: merged.account, customerId: customer.id, mode: 'linked', merged: true };
  }
}

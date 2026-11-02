// Notifications des gestes « Soumettre », « Approuver », « Rejeter » d'un contrat ou d'un
// avenant — ADR-0050 § 6. ADR-0050 — V6.
//
// Intercepteur d'application (motif de `NormalizationActionsInterceptor`, ADR-0024) : il
// n'agit que sur SIX routes du lot V3, et seulement APRÈS une réponse réussie ; il relit
// le document dans l'organisation de la session, puis notifie par `SalesContractsNotifier`.
// Ainsi les services du lot V3 ne changent pas (un fichier, un écrivain). Une notification
// perdue ne défait jamais le geste : toute erreur est journalisée et avalée.

import {
  Inject,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { mergeMap, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../../../auth/auth.guard.js';
import { isObjectIdHex } from '../../search.js';
import {
  SalesContractAmendment,
  type SalesContractAmendmentDocument,
  type SalesContractAmendmentLean,
} from '../amendments/sales-contract-amendment.schema.js';
import {
  SalesContract,
  type SalesContractDocument,
  type SalesContractLean,
} from '../contracts/sales-contract.schema.js';
import { SalesContractSettingsService } from '../settings/sales-contract-settings.service.js';
import { SalesContractsNotifier, type ContractDocumentNotice } from './contracts-notifier.js';

type Gesture = 'submit' | 'approve' | 'reject';

/** Routes observées (chemins Nest) → geste ; tout le reste passe sans effet. */
const ROUTES: ReadonlyMap<string, { gesture: Gesture; amendment: boolean }> = new Map([
  ['/sales/contracts/:contractId/submit', { gesture: 'submit', amendment: false }],
  ['/sales/contracts/:contractId/approve', { gesture: 'approve', amendment: false }],
  ['/sales/contracts/:contractId/reject', { gesture: 'reject', amendment: false }],
  [
    '/sales/contracts/:contractId/amendments/:amendmentId/submit',
    { gesture: 'submit', amendment: true },
  ],
  [
    '/sales/contracts/:contractId/amendments/:amendmentId/approve',
    { gesture: 'approve', amendment: true },
  ],
  [
    '/sales/contracts/:contractId/amendments/:amendmentId/reject',
    { gesture: 'reject', amendment: true },
  ],
]);

/** Geste observé pour une requête, ou `null`. Pure, testée. */
export function contractGestureOf(
  method: string,
  routePath: unknown,
): { gesture: Gesture; amendment: boolean } | null {
  if (method !== 'POST' || typeof routePath !== 'string') return null;
  return ROUTES.get(routePath) ?? null;
}

@Injectable()
export class SalesContractsNotificationsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('SalesContractsNotifications');

  constructor(
    @InjectModel(SalesContract.name) private readonly contracts: Model<SalesContractDocument>,
    @InjectModel(SalesContractAmendment.name)
    private readonly amendments: Model<SalesContractAmendmentDocument>,
    @Inject(SalesContractSettingsService) private readonly settings: SalesContractSettingsService,
    @Inject(SalesContractsNotifier) private readonly notifier: SalesContractsNotifier,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const route = (req as unknown as { route?: { path?: unknown } }).route;
    const observed = contractGestureOf(req.method, route?.path);
    if (observed === null) return next.handle();
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        try {
          await this.notify(req, observed.gesture, observed.amendment);
        } catch (err) {
          this.logger.warn(`Notification de contrat non émise : ${String(err)}`);
        }
        return body;
      }),
    );
  }

  private async notify(req: AuthenticatedRequest, gesture: Gesture, isAmendment: boolean) {
    const organizationId = req.orgId;
    const actorUserId = req.user?.id ?? null;
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const contractId = params['contractId'];
    if (!organizationId || !contractId || !isObjectIdHex(contractId)) return;
    const contract = await this.contracts
      .findOne({ _id: new Types.ObjectId(contractId), organizationId })
      .lean<SalesContractLean>()
      .exec();
    if (!contract) return;
    let doc: Pick<
      SalesContractLean | SalesContractAmendmentLean,
      'number' | 'createdBy' | 'submittedBy' | 'submittedAt' | 'approvals'
    > = contract;
    let amendmentId: string | null = null;
    if (isAmendment) {
      const aid = params['amendmentId'];
      if (!aid || !isObjectIdHex(aid)) return;
      const amendment = await this.amendments
        .findOne({ _id: new Types.ObjectId(aid), organizationId, contractId })
        .lean<SalesContractAmendmentLean>()
        .exec();
      if (!amendment) return;
      doc = amendment;
      amendmentId = aid;
    }
    const last = doc.approvals?.[doc.approvals.length - 1];
    const notice: ContractDocumentNotice = {
      organizationId,
      contractId,
      number: doc.number,
      isAmendment,
      amendmentId,
      createdBy: doc.createdBy,
      submittedBy: doc.submittedBy ?? null,
      ownerUserId: contract.ownerUserId,
      at: new Date(
        gesture === 'submit' ? (doc.submittedAt ?? Date.now()) : (last?.at ?? Date.now()),
      ),
      actorUserId,
    };
    if (gesture === 'submit') {
      const { allowSoleApprover } = await this.settings.values(organizationId);
      await this.notifier.submitted(notice, allowSoleApprover);
    } else {
      await this.notifier.decided(notice, gesture === 'approve');
    }
  }
}

// Dépenses et dépenses récurrentes — ADR-0034 § 2, § 3 et § 8.
//
//   GET  /treasury/categories                          catégories (treasury.read)
//   GET  /treasury/expenses                            liste paginée
//   GET  /treasury/expenses/summary                    totaux mois × devise × catégorie (moteur)
//   GET  /treasury/suppliers?q=                        fournisseurs déjà saisis
//   GET  /treasury/expenses/:id                        détail
//   POST /treasury/expenses                            enregistrer (treasury.manage)
//   PUT  /treasury/expenses/:id                        modifier (révision attendue)
//   POST /treasury/expenses/:id/cancel                 annuler (motif)
//   POST /treasury/expenses/:id/attachment             pièce justificative (corps BINAIRE)
//   GET  /treasury/expenses/:id/attachment             pièce (octets, en-têtes inertes)
//   DELETE /treasury/expenses/:id/attachment           retirer la pièce
//   GET  /treasury/recurring-expenses                  règles
//   GET  /treasury/recurring-expenses/due              occurrences passées à confirmer
//   POST /treasury/recurring-expenses                  créer
//   PUT  /treasury/recurring-expenses/:id              modifier
//   POST /treasury/recurring-expenses/:id/occurrences/:date/confirm   confirmer (idempotent)
//
// Organisation active seulement ; une ressource d'une autre organisation répond 404.

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EXPENSE_CATEGORIES, isCalendarDay, type ExpenseAggregation } from '@lalanda/engine';
import type { Request, Response } from 'express';

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  validateAndSanitizeImage,
} from '../account/image-validation.js';
import { readRequestBody } from '../account/request-body.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { ObjectStorageUnavailableError } from '../storage/object-storage.service.js';
import {
  expenseView,
  TreasuryExpensesService,
  type ExpensePage,
  type ExpenseView,
} from './treasury-expenses.service.js';
import {
  TreasuryRecurringService,
  type DueOccurrence,
  type RecurringExpenseView,
} from './treasury-recurring.service.js';
import type { TreasuryActor } from './treasury.common.js';
import {
  CancelSchema,
  ConfirmOccurrenceSchema,
  CreateExpenseSchema,
  ListExpensesQuerySchema,
  PutExpenseSchema,
  PutRecurringExpenseSchema,
  RecurringExpenseSchema,
  SummaryQuerySchema,
} from './treasury.dto.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): TreasuryActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

function imageRejection(code: string, message: string): HttpException {
  const status =
    code === 'FILE_TOO_LARGE'
      ? 413
      : code === 'UNSUPPORTED_IMAGE_TYPE'
        ? 415
        : code === 'IMAGE_DIMENSIONS_REJECTED'
          ? 422
          : 400;
  return new HttpException({ code, message }, status);
}

function storageFailure(cause: unknown): HttpException {
  if (cause instanceof ObjectStorageUnavailableError) {
    return new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message: cause.reason });
  }
  if (cause instanceof HttpException) return cause;
  return new ServiceUnavailableException({
    code: 'STORAGE_FAILURE',
    message: 'Le stockage des fichiers n’a pas pu traiter la demande.',
  });
}

@Controller('treasury')
@UseGuards(AuthGuard, PermissionsGuard)
export class TreasuryExpensesController {
  constructor(
    @Inject(TreasuryExpensesService) private readonly expenses: TreasuryExpensesService,
    @Inject(TreasuryRecurringService) private readonly recurring: TreasuryRecurringService,
  ) {}

  @Get('categories')
  @RequirePermission('treasury.read')
  categories(): { code: string; label: string; nature: string }[] {
    return EXPENSE_CATEGORIES.map((c) => ({ code: c.code, label: c.label, nature: c.nature }));
  }

  @Get('expenses')
  @RequirePermission('treasury.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<ExpensePage> {
    const parsed = ListExpensesQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.expenses.list(orgId, parsed.data);
  }

  @Get('expenses/summary')
  @RequirePermission('treasury.read')
  async summary(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<ExpenseAggregation> {
    const parsed = SummaryQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.expenses.summary(orgId, parsed.data);
  }

  @Get('suppliers')
  @RequirePermission('treasury.read')
  async suppliers(
    @CurrentOrgId() orgId: string,
    @Query('q') q?: string,
  ): Promise<{ items: string[] }> {
    return {
      items: await this.expenses.suppliers(
        orgId,
        typeof q === 'string' ? q.slice(0, 100) : undefined,
      ),
    };
  }

  @Get('expenses/:expenseId')
  @RequirePermission('treasury.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('expenseId') expenseId: string,
  ): Promise<ExpenseView> {
    return this.expenses.get(orgId, expenseId);
  }

  @Post('expenses')
  @RequirePermission('treasury.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ExpenseView> {
    const parsed = CreateExpenseSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return expenseView(await this.expenses.create(orgId, parsed.data, actorOf(user, role)));
  }

  @Put('expenses/:expenseId')
  @RequirePermission('treasury.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('expenseId') expenseId: string,
    @Body() body: unknown,
  ): Promise<ExpenseView> {
    const parsed = PutExpenseSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.expenses.put(
      orgId,
      expenseId,
      parsed.data.expectedRevision,
      parsed.data.expense,
      actorOf(user, role),
    );
  }

  @Post('expenses/:expenseId/cancel')
  @HttpCode(200)
  @RequirePermission('treasury.manage')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('expenseId') expenseId: string,
    @Body() body: unknown,
  ): Promise<ExpenseView> {
    const parsed = CancelSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.expenses.cancel(orgId, expenseId, parsed.data.reason, actorOf(user, role));
  }

  /** Corps binaire brut, comme le logo (ADR-0028) ; vingt envois par heure et par utilisateur. */
  @Post('expenses/:expenseId/attachment')
  @HttpCode(201)
  @RequirePermission('treasury.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  @UseGuards(UserThrottlerGuard)
  async attach(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('expenseId') expenseId: string,
    @Req() req: Request,
  ): Promise<ExpenseView> {
    // Existence et appartenance d'abord : on ne lit pas un corps pour rien.
    await this.expenses.requireOwn(orgId, expenseId);
    const announced = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (
      announced &&
      !ACCEPTED_IMAGE_TYPES.includes(announced as never) &&
      announced !== 'application/octet-stream'
    ) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_IMAGE_TYPE',
        message: `Type « ${announced} » non accepté. Attendu : photo ${ACCEPTED_IMAGE_TYPES.join(', ')} (le PDF n'est pas encore accepté).`,
      });
    }
    const read = await readRequestBody(req, MAX_IMAGE_BYTES);
    if (!read.ok) {
      if (read.reason === 'TOO_LARGE') {
        throw imageRejection(
          'FILE_TOO_LARGE',
          `Le fichier dépasse ${MAX_IMAGE_BYTES / 1024 / 1024} Mio.`,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }
    const verdict = validateAndSanitizeImage(read.body);
    if (!verdict.ok) throw imageRejection(verdict.code, verdict.message);
    try {
      return await this.expenses.attach(orgId, expenseId, verdict, actorOf(user, role));
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get('expenses/:expenseId/attachment')
  @RequirePermission('treasury.read')
  async readAttachment(
    @CurrentOrgId() orgId: string,
    @Param('expenseId') expenseId: string,
    @Res() res: Response,
  ): Promise<void> {
    let object;
    try {
      object = await this.expenses.readAttachment(orgId, expenseId);
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      throw storageFailure(cause);
    }
    if (!object) {
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: 'Aucune pièce jointe.',
      });
    }
    res
      .status(200)
      .set({
        'Content-Type': object.contentType ?? 'application/octet-stream',
        'Content-Length': String(object.body.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
      })
      .end(object.body);
  }

  @Delete('expenses/:expenseId/attachment')
  @RequirePermission('treasury.manage')
  async detach(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('expenseId') expenseId: string,
  ): Promise<ExpenseView> {
    return this.expenses.detach(orgId, expenseId, actorOf(user, role));
  }

  // ─── Récurrences ───────────────────────────────────────────────────────────

  @Get('recurring-expenses')
  @RequirePermission('treasury.read')
  async listRecurring(@CurrentOrgId() orgId: string): Promise<{ items: RecurringExpenseView[] }> {
    return { items: await this.recurring.list(orgId) };
  }

  @Get('recurring-expenses/due')
  @RequirePermission('treasury.read')
  async due(@CurrentOrgId() orgId: string): Promise<{ items: DueOccurrence[] }> {
    return { items: await this.recurring.due(orgId) };
  }

  @Post('recurring-expenses')
  @RequirePermission('treasury.manage')
  async createRecurring(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<RecurringExpenseView> {
    const parsed = RecurringExpenseSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.recurring.create(orgId, parsed.data, actorOf(user, role));
  }

  @Put('recurring-expenses/:ruleId')
  @RequirePermission('treasury.manage')
  async putRecurring(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<RecurringExpenseView> {
    const parsed = PutRecurringExpenseSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.recurring.put(
      orgId,
      ruleId,
      parsed.data.expectedRevision,
      parsed.data.recurringExpense,
      actorOf(user, role),
    );
  }

  @Post('recurring-expenses/:ruleId/occurrences/:date/confirm')
  @HttpCode(200)
  @RequirePermission('treasury.manage')
  async confirm(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('ruleId') ruleId: string,
    @Param('date') date: string,
    @Body() body: unknown,
  ): Promise<{ expense: ExpenseView; alreadyConfirmed: boolean }> {
    const parsed = ConfirmOccurrenceSchema.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    if (!isCalendarDay(date)) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date attendue au format AAAA-MM-JJ.',
      });
    }
    return this.recurring.confirm(orgId, ruleId, date, parsed.data, actorOf(user, role));
  }
}

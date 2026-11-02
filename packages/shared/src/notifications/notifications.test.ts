import { describe, expect, it } from 'vitest';

import {
  ListNotificationsQuery,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_SOURCE_MODULES,
  PutNotificationPreferencesBody,
  isNotificationHref,
} from './index.js';

describe('notifications — contrats partagés', () => {
  it('déclare six types work, cinq crm, un organization, sept purchases, vingt-quatre hr, cinq stock, deux assets, un documents et six sales, préfixés par leur module', () => {
    // ADR-0053 — P6 : `platform.announcement` s'ajoute, hors module d'organisation.
    expect(NOTIFICATION_KINDS).toHaveLength(58);
    for (const kind of NOTIFICATION_KINDS) {
      if (kind === 'platform.announcement') continue;
      const module = kind.split('.')[0]!;
      expect(NOTIFICATION_SOURCE_MODULES as readonly string[]).toContain(module);
    }
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('crm.'))).toEqual([
      'crm.activity_assigned',
      'crm.activity_due_soon',
      'crm.activity_overdue',
      'crm.opportunity_assigned',
      'crm.opportunity_won',
    ]);
    expect(NOTIFICATION_ENTITY_TYPES).toEqual([
      'task',
      'project',
      'activity',
      'opportunity',
      'account',
      'membership',
      'purchase_order',
      'supplier_invoice',
      'supplier',
      'leave_request',
      'employee',
      'hr_document',
      'hr_checklist',
      'stock_item',
      'stock_count',
      'asset',
      'library_document',
      'expense_report',
      'advance',
      'shift',
      'review',
      'goal',
      'attendance_correction',
      'sales_contract',
    ]);
    // ADR-0041 — A4.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('organization.'))).toEqual([
      'organization.permissions_changed',
    ]);
    // ADR-0044 — P0 (§ 6.5) : sept types, un module, trois natures d'entité.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('purchases.'))).toEqual([
      'purchases.approval_requested',
      'purchases.request_approved',
      'purchases.request_rejected',
      'purchases.invoice_variance',
      'purchases.invoice_due_soon',
      'purchases.invoice_overdue',
      'purchases.supplier_payment_details_changed',
    ]);
    expect(NOTIFICATION_SOURCE_MODULES).toContain('purchases');
    // ADR-0045 — H0 (§ 6.1) : neuf types, un module, quatre natures d'entité.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('hr.'))).toEqual([
      'hr.leave_requested',
      'hr.leave_approved',
      'hr.leave_rejected',
      'hr.leave_cancelled',
      'hr.probation_ending',
      'hr.contract_ending',
      'hr.document_expiring',
      'hr.checklist_item_assigned',
      'hr.bank_details_changed',
      // ADR-0051 — H8 (§ 7.5) : quinze types, six natures d'entité, aucun module nouveau.
      'hr.expense_submitted',
      'hr.expense_approved',
      'hr.expense_rejected',
      'hr.expense_reimbursed',
      'hr.advance_submitted',
      'hr.advance_decided',
      'hr.advance_disbursed',
      'hr.advance_overdue',
      'hr.attendance_correction_requested',
      'hr.attendance_correction_decided',
      'hr.shifts_published',
      'hr.shift_changed',
      'hr.review_step',
      'hr.goal_proposed',
      'hr.goal_agreed',
    ]);
    expect(NOTIFICATION_SOURCE_MODULES).toContain('hr');
    // ADR-0046 — S0 (§ 6.7) : huit types, trois modules, quatre natures d'entité.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('stock.'))).toEqual([
      'stock.below_reorder',
      'stock.negative',
      'stock.pending_lines',
      'stock.count_assigned',
      'stock.count_submitted',
    ]);
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('assets.'))).toEqual([
      'assets.maintenance_due',
      'assets.coverage_expiring',
    ]);
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('documents.'))).toEqual([
      'documents.expiring',
    ]);
    expect(NOTIFICATION_SOURCE_MODULES.slice(-4)).toEqual([
      'stock',
      'assets',
      'documents',
      'sales',
    ]);
    // ADR-0050 — V6 (§ 6) : six types, un module, une nature d'entité.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('sales.'))).toEqual([
      'sales.contract_submitted',
      'sales.contract_approved',
      'sales.contract_rejected',
      'sales.contract_notice_due',
      'sales.contract_term_ending',
      'sales.subscription_drafts_ready',
    ]);
  });

  it('un lien est un chemin relatif de l’application, jamais une URL absolue', () => {
    expect(isNotificationHref('/projets/abc?tache=def')).toBe(true);
    for (const bad of [
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      'projets/abc',
      'javascript:alert(1)',
      '/a b',
      '',
    ]) {
      expect(isNotificationHref(bad), bad).toBe(false);
    }
  });

  it('liste : non lues seulement, limite bornée', () => {
    expect(ListNotificationsQuery.parse({ unreadOnly: 'true' })).toEqual({
      unreadOnly: true,
      limit: 20,
    });
    expect(ListNotificationsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListNotificationsQuery.safeParse({ autre: '1' }).success).toBe(false);
  });

  it('préférences : types connus, sans doublon', () => {
    expect(
      PutNotificationPreferencesBody.safeParse({ mutedKinds: ['work.mentioned'] }).success,
    ).toBe(true);
    expect(PutNotificationPreferencesBody.safeParse({ mutedKinds: ['crm.inconnu'] }).success).toBe(
      false,
    );
    expect(
      PutNotificationPreferencesBody.safeParse({
        mutedKinds: ['work.mentioned', 'work.mentioned'],
      }).success,
    ).toBe(false);
  });
});

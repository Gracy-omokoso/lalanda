// Acteur d'une requête CRM et réponse CSV — partagés par les contrôleurs du CRM.

import type { Response } from 'express';

import type { OrgRole } from '../authz/permissions.js';
import type { CsvFile } from './crm-csv.service.js';
import type { CrmActor } from './crm-settings.service.js';

export function crmActorOf(user: { id: string }, role: OrgRole | undefined): CrmActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

export function sendCsv(res: Response, file: CsvFile): void {
  const body = Buffer.from(file.body, 'utf8');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('content-length', String(body.byteLength));
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

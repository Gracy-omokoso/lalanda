// Import d'un fichier de tâches — ADR-0062.
//
// Aperçu puis import, SANS état côté serveur : l'écran renvoie le même fichier
// pour l'import, qui refait exactement la même lecture (`readTable` puis
// `tableToPlan`) avant de passer au créateur commun (`WorkPlanBuilder`). Ce que
// l'aperçu annonce est donc ce qui est créé.

import {
  type WorkImportPreview,
  type WorkPlanApplyResult,
  type WorkPlanProject,
  type WorkPlanTask,
} from '@lalanda/shared/work';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MembersService } from '../organizations/members.service.js';
import { actorCan, type WorkActor } from './work.common.js';
import {
  ImportFileError,
  readTable,
  tableToPlan,
  type ImportMember,
} from './work-import.parser.js';
import { isSelfAssignOnlyRole } from './work-access.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkPlanBuilder, normalizeLabel } from './work-plan-builder.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkSettingsService } from './work-settings.service.js';

/** Erreur de fichier → réponse HTTP (413 pour la taille, 400 sinon). */
export function importFileFailure(err: unknown): never {
  if (err instanceof ImportFileError) {
    if (err.code === 'IMPORT_FILE_TOO_LARGE') {
      throw new HttpException({ code: err.code, message: err.message }, 413);
    }
    throw new BadRequestException({ code: err.code, message: err.message });
  }
  throw err;
}

@Injectable()
export class WorkImportService {
  constructor(
    @Inject(WorkMembersService) private readonly workMembers: WorkMembersService,
    @Inject(MembersService) private readonly orgMembers: MembersService,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkPlanBuilder) private readonly builder: WorkPlanBuilder,
  ) {}

  /** Membres de l'ORGANISATION ACTIVE seulement, avec leur e-mail (correspondance du responsable). */
  private async members(organizationId: string): Promise<ImportMember[]> {
    const list = await this.workMembers.list(organizationId);
    const ids = await this.orgMembers.identitiesOf(list.map((m) => m.userId));
    return list.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: ids.get(m.userId)?.email ?? null,
      canUpdate: m.canUpdate,
    }));
  }

  /** Aperçu (et plan) d'un fichier ; `projectId` : import dans ce projet. */
  async preview(
    organizationId: string,
    body: Buffer,
    fileName: string | null,
    projectId: string | null,
    actor: WorkActor,
  ): Promise<{ preview: WorkImportPreview; tasks: WorkPlanTask[] }> {
    const table = await readTable(body).catch(importFileFailure);
    const [members, settings, project] = await Promise.all([
      this.members(organizationId),
      this.settings.get(organizationId),
      projectId ? this.projects.requireWritable(organizationId, projectId) : Promise.resolve(null),
    ]);
    const columns = project ? project.columns : settings.defaultColumns;
    const result = tableToPlan(
      table,
      members,
      {
        sections: columns.flatMap((c) => [c.label, c.key]),
        labels: settings.labels.flatMap((l) => [l.label, l.key]),
      },
      fileName,
    );
    // Sans `work.manage`, on ne crée ni section ni étiquette : la tâche est
    // importée sans elles, et l'aperçu le dit.
    if (project && !actorCan(actor, 'work.manage')) {
      const newSections = new Set(result.preview.newSections.map(normalizeLabel));
      const newLabels = new Set(result.preview.newLabels.map(normalizeLabel));
      const refRow = new Map(result.preview.rows.map((r) => [r.ref, r]));
      for (const t of result.tasks) {
        const row = refRow.get(t.ref)!;
        if (t.section && newSections.has(normalizeLabel(t.section))) {
          result.preview.issues.push({
            row: row.row,
            column: 'Section',
            severity: 'warning',
            code: 'IMPORT_SECTION_NOT_ALLOWED',
            message: `La section « ${t.section} » n’existe pas dans ce projet et votre rôle ne permet pas d’en créer : tâche placée dans la première colonne « à faire ».`,
          });
          t.section = null;
          row.section = null;
        }
        const kept = (t.labels ?? []).filter((l) => !newLabels.has(normalizeLabel(l)));
        if (kept.length !== (t.labels ?? []).length) {
          result.preview.issues.push({
            row: row.row,
            column: 'Étiquettes',
            severity: 'warning',
            code: 'IMPORT_LABEL_NOT_ALLOWED',
            message: 'Étiquette inconnue et votre rôle ne permet pas d’en créer : ignorée.',
          });
          t.labels = kept;
          row.labels = kept;
        }
      }
      result.preview.newSections = [];
      result.preview.newLabels = [];
      result.preview.counts.warnings = result.preview.issues.filter(
        (i) => i.severity === 'warning',
      ).length;
    }
    // ADR-0066 § 2 : un rôle « assignation à soi seulement » n'assigne pas les autres.
    // Leur tâche est importée sans responsable, et l'aperçu le dit.
    if (isSelfAssignOnlyRole(actor.role)) {
      const refRow = new Map(result.preview.rows.map((r) => [r.ref, r]));
      for (const t of result.tasks) {
        if (!t.assigneeUserId || t.assigneeUserId === actor.userId) continue;
        const row = refRow.get(t.ref)!;
        result.preview.issues.push({
          row: row.row,
          column: 'Responsable',
          severity: 'warning',
          code: 'IMPORT_ASSIGNEE_SELF_ONLY',
          message:
            'Votre rôle ne permet d’assigner une tâche qu’à vous-même : tâche importée sans responsable.',
        });
        t.assigneeUserId = null;
        row.assignee = null;
      }
    }
    result.preview.counts.warnings = result.preview.issues.filter(
      (i) => i.severity === 'warning',
    ).length;
    result.preview.issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    return result;
  }

  private assertImportable(preview: WorkImportPreview, skipInvalid: boolean): void {
    if (preview.counts.valid === 0) {
      throw new UnprocessableEntityException({
        code: 'IMPORT_NOTHING_TO_IMPORT',
        message: 'Aucune ligne importable : corrigez les erreurs signalées dans l’aperçu.',
      });
    }
    if (preview.counts.invalid > 0 && !skipInvalid) {
      throw new UnprocessableEntityException({
        code: 'IMPORT_HAS_ERRORS',
        message: `${preview.counts.invalid} ligne(s) ont une erreur : corrigez le fichier, ou confirmez l’import des ${preview.counts.valid} lignes valides seulement.`,
        details: { invalid: preview.counts.invalid, valid: preview.counts.valid },
      });
    }
  }

  /** Nouveau projet depuis un fichier (`work.manage`). */
  async importNewProject(
    organizationId: string,
    body: Buffer,
    fileName: string | null,
    project: WorkPlanProject,
    skipInvalid: boolean,
    actor: WorkActor,
  ): Promise<WorkPlanApplyResult> {
    const { preview, tasks } = await this.preview(organizationId, body, fileName, null, actor);
    this.assertImportable(preview, skipInvalid);
    return this.builder.createProject(organizationId, project, tasks, actor, 'import');
  }

  /** Tâches d'un fichier dans un projet existant (`work.update`). */
  async importIntoProject(
    organizationId: string,
    projectId: string,
    body: Buffer,
    fileName: string | null,
    skipInvalid: boolean,
    actor: WorkActor,
  ): Promise<WorkPlanApplyResult> {
    const { preview, tasks } = await this.preview(organizationId, body, fileName, projectId, actor);
    this.assertImportable(preview, skipInvalid);
    return this.builder.addToProject(organizationId, projectId, tasks, actor, 'import');
  }
}

// Maintenances dans « Mes tâches » — ADR-0046 § 6.7. ADR-0046 — S7.
//
// Agrégées À LA LECTURE : une intervention PRÉVUE, en retard ou due sous le délai des
// réglages (moteur `assetDeadlines`), dont l'appelant est responsable — il gère les
// équipements (`assets.manage`) ou l'équipement lui est affecté. Sans case à cocher :
// la marquer faite se fait sur la fiche de l'équipement. Ni coût ni prestataire.

export const ASSETS_AGENDA_ID_PREFIX = 'assets:' as const;

export interface AssetsMyTaskItem {
  source: 'assets';
  kind: 'maintenance';
  /** `assets:maintenance:<maintenanceId>`. */
  id: string;
  assetId: string;
  maintenanceId: string;
  /** « EQ-000001 Ordinateur portable ». */
  title: string;
  /** Jour prévu `AAAA-MM-JJ`. */
  dueDate: string;
  priority: 'none';
  rank: string;
  done: false;
  kindLabel: 'Maintenance';
  href: string;
}

export function assetsAgendaId(maintenanceId: string): string {
  return `${ASSETS_AGENDA_ID_PREFIX}maintenance:${maintenanceId}`;
}

export function assetsAgendaHref(assetId: string): string {
  return `/equipements/${assetId}`;
}

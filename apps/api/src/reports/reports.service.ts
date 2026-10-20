// Service de génération des rapports de plan (S8-lite, ADR-0007).
//
// Le rendu PDF lui-même (navigateur Chromium partagé, portillon S22e,
// confinement réseau et JavaScript) vit dans `PdfRenderingService`, partagé avec
// les documents de vente (ADR-0025). Ce service ne fait plus que produire le
// HTML et l'Excel d'un rapport.

import { Inject, Injectable } from '@nestjs/common';

import { PdfRenderingService } from './pdf-rendering.service.js';
import { renderReportHtml, type ReportData } from './report-html.js';
import { renderReportXlsx } from './report-xlsx.js';

@Injectable()
export class ReportsService {
  constructor(@Inject(PdfRenderingService) private readonly pdf: PdfRenderingService) {}

  /** Génère le HTML seul — utile pour prévisualiser sans démarrer Chromium. */
  renderHtml(data: ReportData): string {
    return renderReportHtml(data);
  }

  /**
   * Génère l'export Excel (.xlsx) — une feuille par feuille moteur, formules DSL
   * traduites en formules Excel natives. Voir `report-xlsx.ts` pour le détail du mapping.
   */
  async renderXlsx(data: ReportData): Promise<Buffer> {
    return renderReportXlsx(data);
  }

  /**
   * Génère le PDF binaire d'un rapport. Lance une exception si Chromium n'est pas
   * disponible — c'est intentionnel : la CI qui skip le download ne doit pas appeler
   * cette méthode. `503 REPORT_RENDER_BUSY` quand le portillon partagé est saturé.
   */
  async renderPdf(data: ReportData): Promise<Buffer> {
    return this.pdf.render(this.renderHtml(data));
  }
}

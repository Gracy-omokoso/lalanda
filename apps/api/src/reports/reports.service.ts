// Service de génération PDF (S8-lite, ADR-0007).
//
// - Puppeteer full package (Chromium bundled). Import DIFFÉRÉ pour ne pas bloquer
//   le boot Nest si Chromium n'a pas été téléchargé (CI avec PUPPETEER_SKIP_DOWNLOAD=true).
// - Un seul browser réutilisé, pages jetables : moins de démarrages froids.
// - Rendu = page.setContent(HTML) → page.pdf({ format: 'A4' }).

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { renderReportHtml, type ReportData } from './report-html.js';
import { renderReportXlsx } from './report-xlsx.js';

// Type minimal — on n'importe pas les types de puppeteer statiquement pour éviter
// une dépendance de compilation forte sur la présence de Chromium.
interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface PageLike {
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  pdf(opts: Record<string, unknown>): Promise<Buffer>;
  close(): Promise<void>;
}

@Injectable()
export class ReportsService implements OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);
  private browserPromise: Promise<BrowserLike> | null = null;

  private async getBrowser(): Promise<BrowserLike> {
    if (this.browserPromise) return this.browserPromise;
    this.browserPromise = (async () => {
      const puppeteer = (await import('puppeteer')) as unknown as {
        launch(opts?: Record<string, unknown>): Promise<BrowserLike>;
      };
      this.logger.log('Démarrage du browser Chromium (Puppeteer)…');
      return puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    })();
    return this.browserPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    try {
      const browser = await this.browserPromise;
      await browser.close();
    } catch {
      /* best-effort */
    }
    this.browserPromise = null;
  }

  /** Génère le HTML seul — utile pour prévisualiser sans démarrer Chromium. */
  renderHtml(data: ReportData): string {
    return renderReportHtml(data);
  }

  /**
   * Génère le PDF binaire d'un rapport. Lance une exception si Chromium n'est pas
   * disponible — c'est intentionnel : la CI qui skip le download ne doit pas appeler
   * cette méthode. Le contrôleur doit s'assurer que le trafic prod atteint bien un
   * environnement où `puppeteer` a téléchargé Chromium (ou où CHROME_PATH pointe vers un binaire).
   */
  /**
   * Génère l'export Excel (.xlsx) — une feuille par feuille moteur, formules DSL
   * traduites en formules Excel natives. Voir `report-xlsx.ts` pour le détail du mapping.
   */
  async renderXlsx(data: ReportData): Promise<Buffer> {
    return renderReportXlsx(data);
  }

  async renderPdf(data: ReportData): Promise<Buffer> {
    const html = this.renderHtml(data);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // domcontentloaded : suffisant car le HTML embarque CSS inline et n'a aucune ressource externe.
      // networkidle0 était flaky avec setContent (pas de navigation → 30s timeout systématique).
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      return pdf;
    } finally {
      await page.close();
    }
  }
}

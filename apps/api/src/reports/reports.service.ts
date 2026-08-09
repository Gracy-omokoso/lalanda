// Service de génération PDF (S8-lite, ADR-0007).
//
// - Puppeteer full package (Chromium bundled). Import DIFFÉRÉ pour ne pas bloquer
//   le boot Nest si Chromium n'a pas été téléchargé (CI avec PUPPETEER_SKIP_DOWNLOAD=true).
// - Un seul browser réutilisé, pages jetables : moins de démarrages froids.
// - Rendu = page.setContent(HTML) → page.pdf({ format: 'A4' }).

import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';

import { renderReportHtml, type ReportData } from './report-html.js';
import { renderReportXlsx } from './report-xlsx.js';
import { RenderGate, RenderGateBusyError, readLimits } from './render-gate.js';

/**
 * Délai d'expiration explicite du rendu Chromium (S22e). Puppeteer applique 30 s
 * par défaut sur `setContent` ET sur `pdf`, soit 60 s cumulés pendant lesquels
 * une page occupe un jeton du portillon. On ramène le total sous la barre du
 * délai d'attente en file, sans quoi la file se vide plus vite qu'elle ne se
 * dépile et le portillon ne borne plus rien d'utile.
 */
const PAGE_TIMEOUT_MS = 15_000;

// Type minimal — on n'importe pas les types de puppeteer statiquement pour éviter
// une dépendance de compilation forte sur la présence de Chromium.
interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface PageLike {
  setContent(html: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
  pdf(opts: Record<string, unknown>): Promise<Buffer>;
  close(): Promise<void>;
}

@Injectable()
export class ReportsService implements OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);
  private browserPromise: Promise<BrowserLike> | null = null;
  /**
   * Borne les rendus Chromium simultanés (S22e). Voir `render-gate.ts` pour la
   * mesure qui motive ce garde-fou.
   */
  private readonly gate = new RenderGate(readLimits());

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

  /**
   * (S22e) Le rendu passe par le portillon : au plus `maxConcurrent` pages
   * Chromium vivantes à la fois, file d'attente bornée, refus explicite en `503`
   * au-delà. Le HTML est produit AVANT d'acquérir le jeton — c'est du calcul pur
   * et bon marché, le garder à l'intérieur allongerait la détention du jeton
   * pour rien.
   */
  async renderPdf(data: ReportData): Promise<Buffer> {
    const html = this.renderHtml(data);
    try {
      return await this.gate.run(() => this.renderPdfUnthrottled(html));
    } catch (err) {
      if (err instanceof RenderGateBusyError) {
        this.logger.warn(`Rendu PDF refusé (${err.reason}) — ${JSON.stringify(this.gate.stats())}`);
        throw new ServiceUnavailableException({
          code: 'REPORT_RENDER_BUSY',
          message: 'Le service de génération PDF est saturé. Réessayez dans quelques secondes.',
          retryAfterSec: err.retryAfterSec,
        });
      }
      throw err;
    }
  }

  private async renderPdfUnthrottled(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // domcontentloaded : suffisant car le HTML embarque CSS inline et n'a aucune ressource externe.
      // networkidle0 était flaky avec setContent (pas de navigation → 30s timeout systématique).
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
        timeout: PAGE_TIMEOUT_MS,
      });
      return pdf;
    } finally {
      // `close()` peut lever si la page est déjà morte (crash du renderer). Un
      // jeton est rendu par le `finally` du portillon quoi qu'il arrive, mais
      // laisser remonter cette erreur masquerait la cause réelle de l'échec.
      await page.close().catch(() => undefined);
    }
  }
}

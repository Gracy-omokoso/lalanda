// Rendu HTML → PDF partagé (ADR-0007 ; S22e ; ADR-0025 § O1).
//
// Extrait de `ReportsService` pour que les rapports et les documents de vente
// partagent UN navigateur Chromium et UN portillon : deux services qui
// lanceraient chacun leur navigateur doubleraient la mémoire que le portillon
// prétend borner.
//
// - Puppeteer importé à la demande : le démarrage de Nest ne dépend pas de la
//   présence de Chromium (CI avec PUPPETEER_SKIP_DOWNLOAD=true).
// - Un seul navigateur réutilisé, pages jetables.
// - Confinement : JavaScript coupé, toute requête réseau avortée (S22e).
// - `fixedDate` (ADR-0025) : les dates de métadonnées du PDF sont réécrites à une
//   date donnée, pour qu'un même document figé produise les mêmes octets.

import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';

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
interface HttpRequestLike {
  url(): string;
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PageLike {
  setContent(html: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
  setJavaScriptEnabled(enabled: boolean): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (req: HttpRequestLike) => void): void;
  pdf(opts: Record<string, unknown>): Promise<Uint8Array>;
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  emulateMediaType(type: string | null): Promise<void>;
  screenshot(opts: Record<string, unknown>): Promise<Uint8Array | string>;
  close(): Promise<void>;
}

/** Image de la première page d'un document (aperçu de modèle, ADR-0028 § 8). */
export interface PngRenderOptions {
  /** Largeur et hauteur CSS de la page (A4 à 96 ppp : 794 × 1123). */
  width: number;
  height: number;
  /** Densité (1 à 2) : 1,5 donne une vignette nette sans alourdir la réponse. */
  deviceScaleFactor?: number;
}

export interface PdfRenderOptions {
  /** Marges de page (défaut : aucune, la mise en page les porte). */
  margin?: { top: string; bottom: string; left: string; right: string };
  /**
   * Date écrite dans `/CreationDate` et `/ModDate` à la place de l'heure du
   * rendu : rendu déterministe d'un document figé (ADR-0025 § O2).
   */
  fixedDate?: Date;
  /**
   * En-tête et pied répétés sur chaque page (gabarits Chromium, rendus dans les
   * marges ; aucun JavaScript). Le contenu est fourni DÉJÀ ÉCHAPPÉ par l'appelant.
   */
  headerTemplate?: string;
  footerTemplate?: string;
}

/** Forme PDF d'une date UTC : `D:AAAAMMJJhhmmss+00'00'` (même longueur que Chromium). */
export function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}+00'00'`
  );
}

/**
 * Réécrit les dates de métadonnées d'un PDF, À LONGUEUR ÉGALE : la table des
 * références croisées (`xref`) donne des positions en octets, une chaîne plus
 * longue ou plus courte casserait le fichier. Une date de longueur différente
 * est laissée telle quelle (le PDF reste valide, seulement non déterministe).
 */
export function fixPdfDates(pdf: Buffer, date: Date): Buffer {
  const text = pdf.toString('latin1');
  const wanted = pdfDate(date);
  const out = text.replace(/\/(CreationDate|ModDate) ?\((D:[^)]*)\)/g, (all, key, value) =>
    String(value).length === wanted.length ? all.replace(String(value), wanted) : all,
  );
  return Buffer.from(out, 'latin1');
}

@Injectable()
export class PdfRenderingService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRenderingService.name);
  private browserPromise: Promise<BrowserLike> | null = null;
  /**
   * Borne les rendus Chromium simultanés (S22e). Voir `render-gate.ts` pour la
   * mesure qui motive ce garde-fou. Partagé par tous les appelants.
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
    // Un lancement raté ne doit pas condamner les rendus suivants.
    this.browserPromise.catch(() => {
      this.browserPromise = null;
    });
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

  /**
   * (S22e) Le rendu passe par le portillon : au plus `maxConcurrent` pages
   * Chromium vivantes à la fois, file d'attente bornée, refus explicite en `503`
   * au-delà. Le HTML est produit par l'appelant AVANT : c'est du calcul pur et
   * bon marché, le garder à l'intérieur allongerait la détention du jeton.
   */
  async render(html: string, opts: PdfRenderOptions = {}): Promise<Buffer> {
    try {
      const pdf = await this.gate.run(() => this.renderUnthrottled(html, opts));
      return opts.fixedDate ? fixPdfDates(pdf, opts.fixedDate) : pdf;
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

  /**
   * Image PNG de la première page — MÊME portillon, MÊME confinement (JavaScript
   * coupé, réseau avorté) que le PDF : seul le format de sortie change.
   */
  async renderPng(html: string, opts: PngRenderOptions): Promise<Buffer> {
    try {
      return await this.gate.run(() =>
        this.withConfinedPage(
          html,
          async (page) => {
            await page.emulateMediaType('print');
            const shot = await page.screenshot({
              type: 'png',
              clip: { x: 0, y: 0, width: opts.width, height: opts.height },
            });
            return typeof shot === 'string' ? Buffer.from(shot, 'base64') : Buffer.from(shot);
          },
          opts,
        ),
      );
    } catch (err) {
      if (err instanceof RenderGateBusyError) {
        throw new ServiceUnavailableException({
          code: 'REPORT_RENDER_BUSY',
          message: 'Le service de génération PDF est saturé. Réessayez dans quelques secondes.',
          retryAfterSec: err.retryAfterSec,
        });
      }
      throw err;
    }
  }

  private async withConfinedPage<T>(
    html: string,
    fn: (page: PageLike) => Promise<T>,
    viewport?: PngRenderOptions,
  ): Promise<T> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // Les deux barrières de `renderUnthrottled` (voir son commentaire, S22e) :
      // JavaScript coupé, toute requête réseau avortée.
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        void req.abort().catch(() => req.continue().catch(() => undefined));
      });
      if (viewport) {
        await page.setViewport({
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: Math.min(2, Math.max(1, viewport.deviceScaleFactor ?? 1)),
        });
      }
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async renderUnthrottled(html: string, opts: PdfRenderOptions): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // (S22e) Confinement du renderer. Chromium tourne ici avec `--no-sandbox`
      // (obligatoire dans le conteneur, sans SYS_ADMIN) et sur le réseau qui
      // joint mongo:27017, minio:9000 et l'endpoint de métadonnées cloud
      // 169.254.169.254. Le document est du HTML statique à CSS inline : il n'a
      // besoin NI de JavaScript NI du moindre appel réseau. Mesuré avant ce
      // durcissement : un `<script>fetch('http://127.0.0.1:9000/...')</script>`
      // injecté s'exécutait et joignait MinIO. Un seul oubli futur d'échappement
      // cesserait alors d'être un défaut cosmétique dans un PDF pour devenir une
      // SSRF exfiltrante déclenchée par qui télécharge le PDF.
      //
      // Deux barrières indépendantes, chacune suffisante :
      //   1. JavaScript coupé — aucun script de la page ne peut s'exécuter;
      //   2. interception réseau — toute requête sortante est avortée, y compris
      //      celles qu'un `<img>`/`<link>` déclencherait sans JavaScript.
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        // Le HTML est fourni par `setContent` (document `about:blank`), il n'y a
        // donc AUCUNE requête légitime : tout ce qui part est une ressource que
        // le contenu a tenté de charger, on l'avorte. `void` : le handler est
        // synchrone, on ne bloque pas la boucle d'événements de Puppeteer.
        void req.abort().catch(() => req.continue().catch(() => undefined));
      });
      // domcontentloaded : suffisant car le HTML embarque CSS inline et n'a aucune ressource externe.
      // networkidle0 était flaky avec setContent (pas de navigation → 30s timeout systématique).
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: opts.margin ?? { top: '0', bottom: '0', left: '0', right: '0' },
        timeout: PAGE_TIMEOUT_MS,
        ...(opts.headerTemplate !== undefined || opts.footerTemplate !== undefined
          ? {
              displayHeaderFooter: true,
              headerTemplate: opts.headerTemplate ?? '<span></span>',
              footerTemplate: opts.footerTemplate ?? '<span></span>',
            }
          : {}),
      });
      return Buffer.from(pdf);
    } finally {
      // `close()` peut lever si la page est déjà morte (crash du renderer). Un
      // jeton est rendu par le `finally` du portillon quoi qu'il arrive, mais
      // laisser remonter cette erreur masquerait la cause réelle de l'échec.
      await page.close().catch(() => undefined);
    }
  }
}

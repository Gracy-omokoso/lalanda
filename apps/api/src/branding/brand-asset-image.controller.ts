// Servitude d'un logo d'organisation à l'interface — ADR-0028 § 7.
//
// Même route que l'avatar (`account/avatar-image.controller.ts`) : jeton signé
// dans le chemin, 404 unique pour tout échec (pas d'oracle), en-têtes qui
// rendent inerte un fichier hostile. Un logo n'est servi que s'il est ENCORE
// relié à l'identité de son organisation : remplacer ou retirer un logo révoque
// immédiatement les URL distribuées.
//
// Le PDF n'utilise JAMAIS cette route : il intègre les octets en `data:`.

import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { BRAND_ASSET_URL_TTL_SECONDS, verifyBrandAssetToken } from './brand-asset-url.js';
import { BrandingService } from './branding.service.js';

@Controller('brand-assets')
export class BrandAssetImageController {
  constructor(@Inject(BrandingService) private readonly branding: BrandingService) {}

  @Get(':token')
  async serve(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const assetId = verifyBrandAssetToken(token);
    if (assetId === null) throw new NotFoundException();
    const objet = await this.branding.readLinkedAsset(assetId).catch(() => null);
    if (!objet) throw new NotFoundException();
    res
      .status(200)
      .set({
        'Content-Type': objet.contentType,
        'Content-Length': String(objet.body.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
        'Cache-Control': `private, max-age=${BRAND_ASSET_URL_TTL_SECONDS}`,
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .end(objet.body);
  }
}

// Endpoints publics de listing des ParameterPacks (auth requise). Le contenu détaillé
// d'un pack (avec params fiscaux) est renvoyé pour affichage dans le PDF et la doc,
// ce n'est pas un secret métier.

import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { getParameterPack, listParameterPackSummaries } from './parameter-pack-registry.js';

@Controller('parameter-packs')
@UseGuards(AuthGuard)
export class ParameterPacksController {
  @Get()
  list(): { packs: ReturnType<typeof listParameterPackSummaries> } {
    return { packs: listParameterPackSummaries() };
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    const pack = getParameterPack(slug);
    if (!pack) {
      throw new NotFoundException({
        code: 'PARAMETER_PACK_NOT_FOUND',
        message: `ParameterPack inconnu : ${slug}`,
      });
    }
    return { pack };
  }
}

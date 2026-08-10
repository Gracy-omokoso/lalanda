// Servitude de l'image de profil.
//
// CONTRÔLEUR SÉPARÉ, ET C'EST LE POINT. `AccountController` porte
// `@UseGuards(AccountAuthGuard)` au niveau de la classe : toutes ses routes
// exigent une session. Cette route-ci n'en exige pas — elle est authentifiée par
// un JETON SIGNÉ, exactement comme `email-verification.controller.ts` l'est par
// son jeton de vérification. Mélanger les deux régimes dans un même contrôleur
// obligerait à percer le garde de classe, et une exception à un garde est
// précisément la chose qu'on finit par étendre sans s'en rendre compte.
//
// Le raisonnement complet sur le mode de servitude est en tête de `avatar-url.ts`.

import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AvatarService } from './avatar.service.js';
import { AVATAR_URL_TTL_SECONDS, verifyAvatarToken } from './avatar-url.js';

@Controller('account/avatar')
export class AvatarImageController {
  constructor(@Inject(AvatarService) private readonly avatars: AvatarService) {}

  /**
   * Sert les octets de l'image.
   *
   * UN SEUL CODE D'ÉCHEC — 404 — pour quatre situations distinctes : jeton
   * malformé, signature invalide, jeton expiré, objet inexistant. La route ne
   * doit rien apprendre à qui la sonde ; distinguer « expiré » de « inconnu »
   * confirmerait l'existence d'une photo, ce qui est déjà une information.
   */
  @Get(':token')
  async serve(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const objectId = verifyAvatarToken(token);
    if (objectId === null) throw new NotFoundException();

    const objet = await this.avatars.readByObjectId(objectId);
    if (!objet) throw new NotFoundException();

    res
      .status(200)
      .set({
        // Type issu de NOTRE analyse du contenu à l'upload (base de données),
        // jamais de ce que renvoie le magasin d'objets.
        'Content-Type': objet.contentType,
        'Content-Length': String(objet.body.length),

        // ── Les trois en-têtes qui rendent inerte un fichier hostile ──────────
        // `nosniff` : sans lui, un navigateur peut requalifier un contenu qui
        // « ressemble » à du HTML malgré un Content-Type d'image, et l'exécuter.
        'X-Content-Type-Options': 'nosniff',
        // CSP de la RESSOURCE elle-même : si elle était malgré tout interprétée
        // comme un document, elle ne pourrait ni charger, ni exécuter, ni
        // émettre quoi que ce soit. C'est la ceinture après la bretelle.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // `inline` sans nom de fichier : rien de ce que l'appelant a envoyé
        // (nom d'origine compris) ne se retrouve dans une réponse.
        'Content-Disposition': 'inline',

        // `private` : jamais mis en cache par un intermédiaire partagé. La durée
        // suit celle du jeton — au-delà, l'URL ne vaut plus rien, et un cache
        // plus long ne ferait que produire des images cassées.
        'Cache-Control': `private, max-age=${AVATAR_URL_TTL_SECONDS}`,
        // Autorise `<img crossorigin>` et `next/image` depuis apps/web sans
        // exposer la ressource à une lecture programmatique par n'importe qui :
        // l'URL elle-même reste la capacité.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .end(objet.body);
  }
}

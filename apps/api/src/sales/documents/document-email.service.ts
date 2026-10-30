// Envoi d'un document de vente par e-mail — audit et remise au transport (ADR-0042).
//
// L'appelant (contrôleur des factures ou des devis) a déjà : vérifié le droit,
// chargé le document DANS l'organisation active, vérifié qu'il est envoyable et
// rendu le PDF par le même chemin que le téléchargement. Ce service :
//
//  1. écrit `…email_requested` en audit STRICT — sans trace, rien ne part (§ 5) ;
//  2. remet le message à `MailService` (qui ne lève jamais) ;
//  3. écrit le résultat `…emailed` en audit ordinaire : l'e-mail est parti, faire
//     échouer la requête pousserait à renvoyer (doublon).
//
// Ni l'objet, ni le message, ni le PDF n'entrent au journal d'audit : seulement
// leurs longueurs et taille. Les adresses y sont, c'est la question « à qui ».

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../authz/audit.service.js';
import { MailService } from '../../mail/mail.service.js';
import {
  headingOf,
  noticeOf,
  type DocumentEmailInput,
  type DocumentEmailNature,
  type DocumentEmailResult,
} from './document-email.js';

export interface DocumentEmailSender {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface DocumentEmailRequest {
  organizationId: string;
  sender: DocumentEmailSender;
  target: {
    // ADR-0044 § 3.3 (lot P3) : bon de commande envoyé au fournisseur.
    type: 'sales_invoice' | 'sales_quote' | 'purchase_order';
    id: string;
    reference: string;
    nature: DocumentEmailNature;
    status: string;
  };
  /** Nom du vendeur imprimé (fiche fiscale ou organisation). */
  sellerName: string;
  pdf: Buffer;
  fileName: string;
  input: DocumentEmailInput;
}

@Injectable()
export class DocumentEmailService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  async send(r: DocumentEmailRequest): Promise<DocumentEmailResult> {
    const { organizationId, sender, target, input } = r;
    const base = {
      organizationId,
      actorUserId: sender.userId,
      actorRole: sender.role,
      targetType: target.type,
      targetId: target.id,
    };
    await this.audit.recordStrict({
      ...base,
      action: `${target.type}.email_requested`,
      metadata: {
        reference: target.reference,
        nature: target.nature,
        status: target.status,
        to: input.to,
        cc: input.cc,
        subjectLength: input.subject.length,
        messageLength: input.message.length,
        fileName: r.fileName,
        bytes: r.pdf.byteLength,
      },
    });

    const delivery = await this.mail.sendSalesDocument({
      to: input.to,
      cc: input.cc,
      replyTo: { address: sender.email, name: sender.name },
      subject: input.subject,
      heading: headingOf(target.nature, target.reference),
      message: input.message,
      notice: noticeOf(target.nature),
      attachmentName: r.fileName,
      organizationName: r.sellerName,
      senderName: sender.name,
      attachment: {
        filename: r.fileName,
        contentType: 'application/pdf',
        contentBase64: r.pdf.toString('base64'),
      },
    });

    const reason = delivery.delivered ? null : (delivery.reason ?? null);
    await this.audit.record({
      ...base,
      action: `${target.type}.emailed`,
      metadata: {
        reference: target.reference,
        to: input.to,
        cc: input.cc,
        delivered: delivery.delivered,
        reason,
      },
    });
    return { delivered: delivery.delivered, reason, to: input.to, cc: input.cc };
  }
}

// Module du rendu PDF partagé (ADR-0025 § O1) : un seul navigateur Chromium et
// un seul portillon pour les rapports et les documents de vente.

import { Module } from '@nestjs/common';

import { PdfRenderingService } from './pdf-rendering.service.js';

@Module({
  providers: [PdfRenderingService],
  exports: [PdfRenderingService],
})
export class PdfModule {}

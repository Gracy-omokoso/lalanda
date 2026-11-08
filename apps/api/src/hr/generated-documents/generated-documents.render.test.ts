// Rendu Chromium RÉEL des trois modèles de documents RH générés — ADR-0072 § 4.
//
// Sauté là où Chromium n'est pas téléchargé (CI avec PUPPETEER_SKIP_DOWNLOAD).
// Écrit les PDF et une vignette PNG dans `apps/api/.vitest/generated-doc-samples/`.
// Organisation et personne inventées.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GENERATED_DOCUMENT_TEMPLATES } from '@lalanda/shared/hr';
import { afterAll, describe, expect, it } from 'vitest';

import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { attestationContent, certificateContent } from './generated-document-content.js';
import { generatedDocumentHtml } from './generated-document-render.js';
import { organizationOf } from './hr-generated-documents.service.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../../.vitest/generated-doc-samples');

async function chromiumAvailable(): Promise<boolean> {
  try {
    type P = { executablePath?: () => string | Promise<string> };
    const mod = (await import('puppeteer')) as unknown as P & { default?: P };
    const target = mod.default ?? mod;
    const path = await target.executablePath?.call(target);
    return typeof path === 'string' && existsSync(path);
  } catch {
    return false;
  }
}

const hasChromium = await chromiumAvailable();
const renderer = new PdfRenderingService();

const employer = organizationOf('Exemple', {
  legalName: 'Exemple Logistique SARL',
  rccm: 'CD/KNG/RCCM/24-B-00001',
  nationalId: '01-1234-N56789A',
  nif: 'A1234567B',
  phone: '+243 810 000 000',
  email: 'rh@exemple.cd',
  headOffice: { line1: '12, avenue de l’Exemple', commune: 'Gombe', city: 'Kinshasa' },
});
const org = { ...employer, initials: 'EL', logo: null, logoLight: null };
const person = {
  displayName: 'Nadia Mbuyi',
  jobTitle: 'Cheffe de quai',
  startDate: '2023-03-15',
  endDate: '2026-11-07',
  employeeNumber: 'EXL-0042',
  department: 'Logistique',
  contractTypeLabel: 'CDI',
};

afterAll(async () => {
  await renderer.onModuleDestroy();
}, 60_000);

describe.skipIf(!hasChromium)('ADR-0072 — rendu Chromium réel', () => {
  it.each(GENERATED_DOCUMENT_TEMPLATES)(
    '%s : une page A4 PDF (attestation et certificat)',
    async (templateId) => {
      await mkdir(OUT, { recursive: true });
      const common = {
        templateId,
        org,
        identity: { primaryColor: '#0e7c66', secondaryColor: '#f2a900', font: null },
        issuedOn: '2026-11-08',
        place: 'Kinshasa',
        signatory: { name: 'Gracy Exemple', title: 'Directrice générale' },
        preview: false,
      };
      const docs = {
        attestation: generatedDocumentHtml({
          ...common,
          number: 'ATT-2026-0001',
          content: attestationContent(person, org.name, {
            title: 'work',
            intro: null,
            closing: null,
            includeContractType: true,
            includeDepartment: true,
            includeEmployeeNumber: false,
            personalAddress: null,
          }),
        }),
        certificat: generatedDocumentHtml({
          ...common,
          number: 'CT-2026-0001',
          content: certificateContent(person, org.name, {
            jobs: [
              { title: 'Magasinier', from: '2023-03-15', to: '2024-12-31' },
              { title: 'Cheffe de quai', from: '2025-01-01', to: '2026-11-07' },
            ],
            socialSecurityNumber: '1234567',
          }),
        }),
      };
      for (const [nom, html] of Object.entries(docs)) {
        const pdf = await renderer.render(html, { fixedDate: new Date('2026-11-08T00:00:00Z') });
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        // Une seule page A4.
        expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length).toBe(1);
        await writeFile(resolve(OUT, `${nom}-${templateId}.pdf`), pdf);
        const png = await renderer.renderPng(html, { width: 794, height: 1123 });
        await writeFile(resolve(OUT, `${nom}-${templateId}.png`), png);
      }
    },
    300_000,
  );
});

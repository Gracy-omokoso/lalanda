// Documents RH générés — contenu et mise en page (ADR-0072 § 1 et § 4), sans Chromium.
// Personnes et organisations inventées.

import { GENERATED_DOCUMENT_TEMPLATES } from '@lalanda/shared/hr';
import { describe, expect, it } from 'vitest';

import {
  attestationContent,
  certificateContent,
  fillFields,
  longDate,
  type DocEmployee,
} from './generated-document-content.js';
import { generatedDocumentHtml, templateRef } from './generated-document-render.js';
import { organizationOf } from './hr-generated-documents.service.js';

const employee: DocEmployee = {
  displayName: 'Nadia <Mbuyi>',
  jobTitle: 'Chef de quai & logistique',
  startDate: '2023-03-15',
  endDate: null,
  employeeNumber: 'EXP-0042',
  department: 'Logistique',
  contractTypeLabel: 'CDI',
};

const org = {
  ...organizationOf('Exemple SARL', {
    legalName: 'Exemple Logistique SARL',
    nif: 'A1234567B',
    rccm: 'CD/KNG/RCCM/24-B-00001',
    nationalId: null,
    phone: '+243 810 000 000',
    email: 'rh@exemple.cd',
    headOffice: {
      line1: '12, avenue de l’Exemple',
      line2: null,
      commune: 'Gombe',
      city: 'Kinshasa',
      province: null,
      country: 'CD',
    },
  }),
  initials: 'EL',
  logo: null,
  logoLight: null,
};

function html(templateId: (typeof GENERATED_DOCUMENT_TEMPLATES)[number], preview = false) {
  return generatedDocumentHtml({
    templateId,
    content: certificateContent({ ...employee, endDate: '2026-11-07' }, org.name, {
      jobs: null,
      socialSecurityNumber: null,
    }),
    org,
    identity: { primaryColor: '#f5c400', secondaryColor: null, font: null },
    number: 'CT-2026-0001',
    issuedOn: '2026-11-08',
    place: 'Kinshasa',
    signatory: { name: 'Gracy Exemple', title: 'Directrice générale' },
    preview,
  });
}

describe('ADR-0072 — contenu', () => {
  it('dates longues et champs nommés', () => {
    expect(longDate('2026-11-08')).toBe('8 novembre 2026');
    expect(longDate('2026-01-01')).toBe('1er janvier 2026');
    expect(
      fillFields('{nom} — {poste} — {inconnu}', {
        nom: 'A',
        poste: 'B',
        date_entree: 'C',
        organisation: 'D',
      }),
    ).toBe('A — B — {inconnu}');
  });

  it('attestation : rien d’optionnel sans choix explicite', () => {
    const c = attestationContent(employee, 'Exemple SARL', {
      title: 'work',
      intro: null,
      closing: null,
      includeContractType: false,
      includeDepartment: false,
      includeEmployeeNumber: false,
      personalAddress: null,
    });
    expect(c.title).toBe('Attestation de travail');
    const text = JSON.stringify(c);
    expect(text).toContain('15 mars 2023');
    expect(text).toContain('Chef de quai');
    for (const absent of ['EXP-0042', 'Logistique"', 'CDI', 'Adresse']) {
      expect(text).not.toContain(absent);
    }
    const full = attestationContent(employee, 'Exemple SARL', {
      title: 'employment',
      intro: 'Nous attestons que {nom} travaille chez {organisation}.',
      closing: null,
      includeContractType: true,
      includeDepartment: true,
      includeEmployeeNumber: true,
      personalAddress: '3, rue Inventée, Kinshasa',
    });
    expect(full.title).toBe('Attestation d’emploi');
    expect(JSON.stringify(full)).toContain('EXP-0042');
    expect(JSON.stringify(full)).toContain('travaille chez Exemple SARL');
  });

  it('certificat : les seules mentions de l’art. 79, jamais de motif ni de salaire', () => {
    const c = certificateContent({ ...employee, endDate: '2026-11-07' }, 'Exemple SARL', {
      jobs: [
        { title: 'Magasinier', from: '2023-03-15', to: '2024-12-31' },
        { title: 'Chef de quai', from: '2025-01-01', to: '2026-11-07' },
      ],
      socialSecurityNumber: '1234567',
    });
    const text = JSON.stringify(c);
    expect(c.title).toBe('Certificat de travail');
    expect(text).toContain('Nature des services prestés');
    expect(text).toContain('Magasinier');
    expect(text).toContain('3 ans, 7 mois et 24 jours');
    expect(text).toContain('1234567');
    for (const interdit of [
      'motif',
      'démission',
      'licenci',
      'salaire',
      'libre de tout engagement',
      'EXP-0042',
      'CDI',
    ]) {
      expect(text.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
    const sansNumero = certificateContent({ ...employee, endDate: '2026-11-07' }, 'X', {
      jobs: null,
      socialSecurityNumber: null,
    });
    expect(JSON.stringify(sansNumero)).toContain('non communiqué');
    expect(JSON.stringify(sansNumero)).toContain('Chef de quai & logistique');
  });

  it('employeur : seulement les identifiants renseignés', () => {
    expect(org.legalIds).toEqual(['RCCM : CD/KNG/RCCM/24-B-00001', 'NIF : A1234567B']);
    expect(org.name).toBe('Exemple Logistique SARL');
    expect(organizationOf('Solo', null)).toEqual({ name: 'Solo', contactLines: [], legalIds: [] });
  });
});

describe('ADR-0072 — mise en page', () => {
  it.each(GENERATED_DOCUMENT_TEMPLATES)('%s : HTML confiné, échappé, complet', (id) => {
    const h = html(id);
    expect(h).toContain("default-src 'none'");
    expect(h).not.toMatch(/<script/i);
    expect(h).not.toMatch(/(src|href)="(https?:)?\/\//i);
    expect(h).toContain('Nadia &lt;Mbuyi&gt;');
    expect(h).not.toContain('Nadia <Mbuyi>');
    expect(h).toContain('Chef de quai &amp; logistique');
    expect(h).toContain('CT-2026-0001');
    expect(h).toContain('Fait à Kinshasa, le 8 novembre 2026');
    expect(h).toContain('RCCM : CD/KNG/RCCM/24-B-00001');
    expect(h).not.toContain('Id. nat.');
    expect(h).toContain('Directrice générale');
    expect(h).not.toContain('APERÇU');
    expect(html(id, true)).toContain('APERÇU — SANS VALEUR');
    expect(templateRef(id)).toBe(`${id}@1`);
  });

  it('les trois modèles ont des compositions distinctes', () => {
    const bodies = GENERATED_DOCUMENT_TEMPLATES.map((id) =>
      html(id).split('<body>')[1]!.slice(0, 80),
    );
    expect(new Set(bodies).size).toBe(3);
  });
});

// Assemblage et rendu HTML du business plan (ADR-0037 § 1, § 2, § 7).

import { describe, expect, it } from 'vitest';

import {
  NOTE_IA_ACCEPTEE,
  TITRE_HYPOTHESES,
  assembleSections,
  contentSha256,
  pendingProposals,
  planLabel,
} from './business-plan-assembly.js';
import { renderBusinessPlanHtml } from './business-plan-html.js';
import { BUSINESS_PLAN_SECTION_IDS } from './business-plan.sections.js';
import { sourceFigee } from './business-plan-test-fixtures.js';

describe('assemblage', () => {
  const source = sourceFigee();
  const sections = assembleSections(
    {
      resume: { text: '  Notre restaurant.  ', origin: 'user' },
      plan_financier: { text: 'Lecture du plan.', origin: 'ai_accepted' },
    },
    source,
  );
  const plan = sections.find((s) => s.id === 'plan_financier')!;

  it('rend les neuf sections dans l’ordre fixe', () => {
    expect(sections.map((s) => s.id)).toEqual([...BUSINESS_PLAN_SECTION_IDS]);
  });

  it('insère les lignes du moteur À L’IDENTIQUE (valeur, ordre, seuil)', () => {
    const projection = plan.tables.find((t) => t.sheetId === 'projection')!;
    expect(projection.title).toBe('Projection sur 5 exercices');
    expect(projection.rows.map((r) => [r.lineId, r.value])).toEqual([
      ['ca_annuel_1', 125000],
      ['resultat_annuel_1', -4321.5],
    ]);
    const ratios = plan.tables.find((t) => t.sheetId === 'ratios')!;
    expect(ratios.rows[0]!.seuil).toMatchObject({ valeur: 1.25, direction: 'min', statut: 'vert' });
    // Feuille absente du snapshot : pas de tableau vide.
    expect(plan.tables.map((t) => t.sheetId)).not.toContain('seuil_rentabilite');
  });

  it('titre les hypothèses comme telles, seulement dans le plan financier', () => {
    expect(plan.hypotheses?.map((h) => h.id)).toEqual(['ticket_moyen', 'food_cost_pct']);
    expect(sections.find((s) => s.id === 'resume')!.hypotheses).toBeNull();
  });

  it('marque un texte issu de l’IA acceptée et signale une section vide', () => {
    expect(plan.originNote).toBe(NOTE_IA_ACCEPTEE);
    expect(sections.find((s) => s.id === 'resume')!.originNote).toBeNull();
    expect(sections.find((s) => s.id === 'risques')!.empty).toBe(true);
    expect(sections.find((s) => s.id === 'resume')!.text).toBe('Notre restaurant.');
  });

  it('cite la version du plan figé, ou dit le brouillon', () => {
    expect(planLabel(source)).toBe('Plan financier validé v2 du 12 octobre 2026');
    expect(planLabel(sourceFigee({ status: 'live', version: null, fingerprint: null }))).toMatch(
      /BROUILLON/,
    );
  });
});

describe('empreinte du contenu et propositions en attente', () => {
  const plan = { version: 2, fingerprint: 'f' };

  it('ignore les espaces de bord et les propositions non tranchées', () => {
    const a = contentSha256({ resume: { text: 'A', origin: 'user' } }, plan);
    const b = contentSha256({ resume: { text: ' A ', origin: 'user' } }, plan);
    expect(a).toBe(b);
  });

  it('change avec le texte, l’origine ou le plan rattaché', () => {
    const base = contentSha256({ resume: { text: 'A', origin: 'user' } }, plan);
    expect(contentSha256({ resume: { text: 'B', origin: 'user' } }, plan)).not.toBe(base);
    expect(contentSha256({ resume: { text: 'A', origin: 'ai_accepted' } }, plan)).not.toBe(base);
    expect(
      contentSha256({ resume: { text: 'A', origin: 'user' } }, { version: 3, fingerprint: 'g' }),
    ).not.toBe(base);
  });

  it('liste les sections portant une proposition', () => {
    expect(
      pendingProposals({ resume: { proposal: { text: 'x' } }, risques: { proposal: null } }),
    ).toEqual(['resume']);
  });
});

describe('rendu HTML du PDF', () => {
  const source = sourceFigee();
  const sections = assembleSections(
    { plan_financier: { text: 'Texte <script>alert(1)</script>', origin: 'ai_accepted' } },
    source,
  );
  const html = (watermark: boolean, document: boolean) =>
    renderBusinessPlanHtml({
      projectName: 'Resto « Chez Mama »',
      pays: 'CD',
      sections,
      source,
      document: document
        ? {
            version: 1,
            approvedAt: '2026-10-20T10:00:00.000Z',
            contentSha256: 'c'.repeat(64),
          }
        : null,
      generatedAt: '2026-10-20T10:00:00.000Z',
      watermark,
    });

  it('confine le rendu : CSP stricte, aucune ressource externe, polices intégrées', () => {
    const h = html(false, true);
    expect(h).toContain("default-src 'none'");
    expect(h).not.toMatch(/(src|href)=["']https?:/);
    expect(h).toMatch(/@font-face\{font-family:'Lalanda Inter'.*src:url\(data:font\/woff2;base64,/);
  });

  it('cite la version et l’empreinte du plan figé, et la version du document', () => {
    const h = html(false, true);
    expect(h).toContain('Plan financier validé v2 du 12 octobre 2026');
    expect(h).toContain('a'.repeat(64));
    expect(h).toContain('Business plan validé v1 du 20 octobre 2026');
  });

  it('dit le brouillon quand le document n’est pas validé', () => {
    expect(html(false, false)).toContain('BROUILLON — business plan non validé');
  });

  it('échappe le texte et rend les tableaux du moteur', () => {
    const h = html(false, true);
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain(TITRE_HYPOTHESES);
    expect(h).toContain('125');
    expect(h).toContain(NOTE_IA_ACCEPTEE);
  });

  it('pose le filigrane seulement si l’offre l’impose', () => {
    expect(html(true, true)).toContain('Généré avec Lalanda — offre gratuite');
    expect(html(false, true)).not.toContain('offre gratuite');
  });
});

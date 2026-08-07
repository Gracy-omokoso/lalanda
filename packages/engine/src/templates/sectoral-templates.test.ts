// Tests golden pour les 3 templates sectoriels de lancement (S6-lite).
// Objectif : figer les résultats attendus avec les valeurs par défaut, de sorte que
// toute modification silencieuse d'un manifest fasse échouer le test — les templates
// portent des règles fiscales/business, on ne les modifie pas sans intention.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseTemplate } from '../dsl/parser.js';
import { findUnknownWizardGroupes, resolveEtapes } from '../dsl/schema.js';
import { evaluateTemplate } from '../evaluator/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(name: string): string {
  return readFileSync(resolve(__dirname, `./${name}.yaml`), 'utf8');
}

function byId(lines: readonly { lineId: string; value: number }[]): Map<string, number> {
  return new Map(lines.map((l) => [l.lineId, l.value]));
}

describe('restaurant-kinshasa', () => {
  const template = parseTemplate(loadYaml('restaurant-kinshasa'));

  it('déclare le bon slug, version et secteur', () => {
    expect(template.slug).toBe('restaurant-kinshasa');
    expect(template.version).toBe('1.0.0');
    expect(template.secteur).toBe('restauration');
    expect(template.pays).toEqual(['CD']);
    expect(template.devise_base).toBe('USD');
  });

  it('évalue les défauts → résultat net mensuel = 6180.72 USD', () => {
    // ca = 60 * 26 * 12 = 18720
    // cout_matiere = 18720 * 0.32 = 5990.4
    // marge_matiere = 18720 - 5990.4 = 12729.6
    // charges_operationnelles = 2500 + 800 + 600 = 3900
    // excedent_brut = 12729.6 - 3900 = 8829.6
    // ibp = 8829.6 * 0.30 = 2648.88
    // resultat_net = 8829.6 - 2648.88 = 6180.72
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca')).toBe(18720);
    expect(v.get('cout_matiere')).toBeCloseTo(5990.4, 6);
    expect(v.get('marge_matiere')).toBeCloseTo(12729.6, 6);
    expect(v.get('charges_operationnelles')).toBe(3900);
    expect(v.get('excedent_brut')).toBeCloseTo(8829.6, 6);
    expect(v.get('ibp')).toBeCloseTo(2648.88, 6);
    expect(v.get('resultat_net')).toBeCloseTo(6180.72, 6);
  });

  it('recalcule quand on baisse le ticket moyen à 8 USD', () => {
    // ca = 60 * 26 * 8 = 12480
    const { lines } = evaluateTemplate(template, { ticket_moyen: 8 });
    const v = byId(lines);
    expect(v.get('ca')).toBe(12480);
    // resultat_net > 0 attendu à ce niveau
    expect(v.get('resultat_net')).toBeGreaterThan(0);
  });
});

describe('quincaillerie-negoce', () => {
  const template = parseTemplate(loadYaml('quincaillerie-negoce'));

  it('déclare le bon slug, version et secteur', () => {
    expect(template.slug).toBe('quincaillerie-negoce');
    expect(template.version).toBe('1.0.0');
    expect(template.secteur).toBe('negoce');
    expect(template.pays).toEqual(['CD']);
  });

  it('évalue les défauts → résultat net mensuel = 665 USD', () => {
    // ca = 500 * 26 = 13000
    // cout_achat_marchandises = 13000 * 0.75 = 9750
    // marge_brute = 3250
    // charges_operationnelles = 1200 + 500 + 300 + 300 = 2300
    // excedent_brut = 950
    // ibp = 285
    // resultat_net = 665
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca')).toBe(13000);
    expect(v.get('cout_achat_marchandises')).toBeCloseTo(9750, 6);
    expect(v.get('marge_brute')).toBeCloseTo(3250, 6);
    expect(v.get('charges_operationnelles')).toBe(2300);
    expect(v.get('excedent_brut')).toBeCloseTo(950, 6);
    expect(v.get('ibp')).toBeCloseTo(285, 6);
    expect(v.get('resultat_net')).toBeCloseTo(665, 6);
  });
});

describe('prestation-services', () => {
  const template = parseTemplate(loadYaml('prestation-services'));

  it('déclare le bon slug, version et secteur', () => {
    expect(template.slug).toBe('prestation-services');
    expect(template.version).toBe('1.0.0');
    expect(template.secteur).toBe('services');
    expect(template.pays).toEqual(['CD']);
  });

  it('évalue les défauts → résultat net mensuel = 840 USD', () => {
    // ca = 200 * 15 = 3000
    // charges_operationnelles = 1000 + 300 + 150 + 200 + 150 = 1800
    // excedent_brut = 1200
    // ibp = 360
    // resultat_net = 840
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca')).toBe(3000);
    expect(v.get('charges_operationnelles')).toBe(1800);
    expect(v.get('excedent_brut')).toBeCloseTo(1200, 6);
    expect(v.get('ibp')).toBeCloseTo(360, 6);
    expect(v.get('resultat_net')).toBeCloseTo(840, 6);
  });

  it('descend à zéro de facturation → excédent négatif, IBP = 0 (fix S10 via IF)', () => {
    // Depuis S10 : `IF(excedent_brut > 0, excedent_brut * ibp_taux, 0)` empêche l'IBP
    // négatif sur perte. Le résultat net = excédent - 0 = excédent (perte pure).
    const { lines } = evaluateTemplate(template, { jours_facturables_mois: 0 });
    const v = byId(lines);
    expect(v.get('ca')).toBe(0);
    expect(v.get('excedent_brut')).toBe(-1800);
    expect(v.get('ibp')).toBe(0); // ← fix S10 : plus de « crédit d'impôt » fantôme sur perte
    expect(v.get('resultat_net')).toBe(-1800);
  });

  it('S11-lite : calcule la mensualité PMT + DSCR', () => {
    // Défauts : capital 5000 USD, taux 14 %/an, durée 36 mois.
    // Mensualité PMT théorique ≈ 170.87 USD → service annuel ≈ 2050 USD.
    // Excédent mensuel par défaut = 1200 → EBE annuel = 14 400.
    // DSCR = 14 400 / 2050 ≈ 7.02 → largement au-dessus du seuil 1.25 → VERT.
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('mensualite_emprunt')).toBeGreaterThan(170);
    expect(v.get('mensualite_emprunt')).toBeLessThan(172);
    expect(v.get('service_dette_annuel')).toBeGreaterThan(2050);
    expect(v.get('dscr')).toBeGreaterThan(6.9);
    expect(v.get('dscr')).toBeLessThan(7.1);
  });

  it('S11-lite : sans emprunt → DSCR = 0 (division par zéro protégée par IFERROR)', () => {
    const { lines } = evaluateTemplate(template, { emprunt_capital: 0 });
    const v = byId(lines);
    expect(v.get('mensualite_emprunt')).toBe(0);
    expect(v.get('service_dette_annuel')).toBe(0);
    expect(v.get('dscr')).toBe(0);
  });

  it('S12-lite : projection 3 ans avec taux_croissance_ca 0.20', () => {
    // Défauts : ca_mois = 3000, resultat_net_mois = 840, taux_croissance = 0.20
    // ca_annuel_1 = 3000 * 12 = 36 000
    // ca_annuel_2 = 36 000 * 1.20 = 43 200
    // ca_annuel_3 = 43 200 * 1.20 = 51 840
    // resultat_annuel_1 = 840 * 12 = 10 080
    // resultat_annuel_2 = 10 080 * 1.20 = 12 096
    // resultat_annuel_3 = 12 096 * 1.20 = 14 515.2
    // cumul = 10 080 + 12 096 + 14 515.2 = 36 691.2
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('ca_annuel_1')).toBe(36000);
    expect(v.get('ca_annuel_2')).toBeCloseTo(43200, 6);
    expect(v.get('ca_annuel_3')).toBeCloseTo(51840, 6);
    expect(v.get('resultat_annuel_1')).toBeCloseTo(10080, 6);
    expect(v.get('resultat_cumule_3ans')).toBeCloseTo(36691.2, 3);
  });

  it('S12-lite : payback = emprunt / résultat annuel année 1', () => {
    // Défauts : emprunt 5000, resultat_annuel_1 = 10 080 → payback = 5000 / 10 080 ≈ 0.496 ans
    // Bien en dessous de 5 ans → VERT
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('payback_annees')).toBeCloseTo(5000 / 10080, 6);
  });

  it('S12b : plan de financement — besoins + ressources + écart', () => {
    // Défauts prestation-services : investissements 6000, bfr 4000, apport 3500, emprunt 5000
    // Total besoins = 10 000, total ressources = 8 500, écart = -1 500 (sous-financé)
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('pf_investissements')).toBe(6000);
    expect(v.get('pf_bfr')).toBe(4000);
    expect(v.get('pf_total_besoins')).toBe(10000);
    expect(v.get('pf_apport')).toBe(3500);
    expect(v.get('pf_emprunt')).toBe(5000);
    expect(v.get('pf_total_ressources')).toBe(8500);
    expect(v.get('pf_ecart')).toBe(-1500);
  });

  it('S12b : ratio apport = 35 % (défauts) → orange (seuil pack 25 %)', () => {
    // apport 3500 / besoins 10 000 = 0.35 ≥ 0.25 seuil → VERT
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('apport_pct')).toBeCloseTo(0.35, 6);
    // Sans pack : pas de statut de feu tricolore
    const apportLine = lines.find((l) => l.lineId === 'apport_pct');
    expect(apportLine?.seuil).toBeUndefined();
  });

  it('S13a : trésorerie mensuelle — scénario défauts prestation-services', () => {
    // Défauts prestation :
    //   apport 3500 + emprunt 5000 - invest 6000 - bfr 4000 = -1500 (tresorerie_initiale)
    //   solde_mensuel = resultat_net 840 - mensualite_emprunt (~170 USD) ≈ 670
    //   tresorerie_fin_m12 = -1500 + 670 × 12 ≈ 6540
    //   tresorerie_min = MIN(-1500, 6540) = -1500 ← CRITIQUE (négatif au démarrage)
    const { lines } = evaluateTemplate(template, {});
    const v = byId(lines);
    expect(v.get('tresorerie_initiale')).toBe(-1500);
    expect(v.get('solde_mensuel_operationnel')).toBeGreaterThan(650);
    expect(v.get('solde_mensuel_operationnel')).toBeLessThan(700);
    expect(v.get('tresorerie_fin_m12')).toBeGreaterThan(6000);
    // Min = tresorerie_initiale car solde > 0 (donc trésorerie monte)
    expect(v.get('tresorerie_min_annee_1')).toBe(-1500);
  });

  it('S13a : trésorerie positive si apport initial suffisant', () => {
    // apport 20 000 → tresorerie_initiale = 20 000 + 5000 - 6000 - 4000 = 15 000
    // → tresorerie_min = MIN(15 000, positif) = 15 000 → VERT
    const { lines } = evaluateTemplate(template, { apport_capital: 20000 });
    const v = byId(lines);
    expect(v.get('tresorerie_initiale')).toBe(15000);
    expect(v.get('tresorerie_min_annee_1')).toBe(15000);
  });
});

// ─── Étapes du wizard (S18c) ──────────────────────────────────
// Présentation uniquement : ces assertions garantissent que les 3 templates de
// lancement offrent une saisie guidée cohérente et qu'aucun groupe d'hypothèses
// ne se retrouve hors parcours après une évolution de leur structure.

describe('etapes du wizard — templates sectoriels', () => {
  const slugs = ['restaurant-kinshasa', 'quincaillerie-negoce', 'prestation-services'] as const;

  for (const slug of slugs) {
    describe(slug, () => {
      const template = parseTemplate(loadYaml(slug));

      it('déclare des étapes ordonnées, la première étant le chiffre d’affaires', () => {
        const etapes = resolveEtapes(template);
        expect(etapes.length).toBeGreaterThanOrEqual(4);
        expect(etapes[0]?.id).toBe('chiffre_affaires');
        expect(etapes.at(-1)?.id).toBe('fiscalite');
      });

      it('couvre tous les groupes d’hypothèses et tous les drivers', () => {
        const etapes = resolveEtapes(template);
        const couverts = new Set(etapes.flatMap((e) => e.groupes));
        for (const g of template.groupes_hypotheses ?? []) {
          expect(couverts.has(g.id)).toBe(true);
        }
        // Aucun driver orphelin : chaque driver est rattaché à un groupe visité.
        for (const d of template.drivers) {
          expect(d.groupe).toBeDefined();
          expect(couverts.has(d.groupe as string)).toBe(true);
        }
      });

      it('ne référence aucun groupe d’hypothèses inexistant', () => {
        // Lint des templates LIVRÉS. À l'exécution un groupe inconnu est ignoré pour
        // ne jamais faire tomber le moteur (ADR-0011 Contrat 3) ; dans le dépôt il
        // signale un bloc `wizard` désynchronisé après un renommage — à corriger ici.
        expect(
          findUnknownWizardGroupes(
            template.groupes_hypotheses ?? [],
            template.wizard?.etapes ?? [],
          ),
        ).toEqual([]);
      });

      it('donne un libellé et une description à chaque étape', () => {
        for (const e of resolveEtapes(template)) {
          expect(e.label.length).toBeGreaterThan(0);
          expect(e.description?.length ?? 0).toBeGreaterThan(0);
        }
      });
    });
  }
});

// Tests des états financiers prévisionnels S18a (FIN-001).
//
// Le test central est l'INVARIANT D'ÉQUILIBRE DU BILAN : actif = passif à 0,01 près
// sur chacun des 5 exercices des 3 templates sectoriels. Il n'existe aucun poste
// d'ajustement dans le modèle — si ce test tombe, c'est le calcul qui est faux.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseTemplate } from '../dsl/parser.js';
import { evaluateTemplate, type LineResult } from '../evaluator/index.js';
import { calculerEcheancierDette } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATES = ['restaurant-kinshasa', 'quincaillerie-negoce', 'prestation-services'] as const;

function loadTemplate(name: string) {
  return parseTemplate(readFileSync(resolve(__dirname, `../templates/${name}.yaml`), 'utf8'));
}

function byId(lines: readonly LineResult[]): Map<string, number> {
  return new Map(lines.map((l) => [l.lineId, l.value]));
}

/** Tolérance de l'invariant d'équilibre, en unités monétaires (docs/07 « tolérance d'arrondi »). */
const TOLERANCE_EQUILIBRE = 0.01;

// ─── Invariant d'équilibre ────────────────────────────────────

describe('invariant — bilan équilibré sur 3 templates × 5 exercices', () => {
  for (const slug of TEMPLATES) {
    describe(slug, () => {
      const template = loadTemplate(slug);

      it('déclare un horizon de 5 exercices', () => {
        expect(template.horizon_projection_annees).toBe(5);
        const { etatsFinanciers } = evaluateTemplate(template, {});
        expect(etatsFinanciers).toBeDefined();
        expect(etatsFinanciers!.bilan).toHaveLength(5);
      });

      it('équilibre le bilan d’ouverture', () => {
        const v = byId(evaluateTemplate(template, {}).lines);
        expect(v.get('bilan_total_actif_ouverture')).toBeCloseTo(
          v.get('bilan_total_passif_ouverture')!,
          6,
        );
        expect(Math.abs(v.get('bilan_ecart_equilibre_ouverture')!)).toBeLessThan(
          TOLERANCE_EQUILIBRE,
        );
      });

      it('équilibre le bilan sur chacun des 5 exercices (défauts)', () => {
        const v = byId(evaluateTemplate(template, {}).lines);
        for (let n = 1; n <= 5; n++) {
          const actif = v.get(`bilan_total_actif_annuel_${n}`)!;
          const passif = v.get(`bilan_total_passif_annuel_${n}`)!;
          const ecart = v.get(`bilan_ecart_equilibre_annuel_${n}`)!;
          expect(actif, `total actif exercice ${n}`).toBeDefined();
          expect(Math.abs(actif - passif), `actif − passif exercice ${n}`).toBeLessThan(
            TOLERANCE_EQUILIBRE,
          );
          expect(Math.abs(ecart), `écart d’équilibre exercice ${n}`).toBeLessThan(
            TOLERANCE_EQUILIBRE,
          );
        }
      });

      // L'équilibre ne doit pas dépendre du jeu de valeurs : on le rejoue sur des
      // scénarios volontairement déformants (perte, pas d'emprunt, BFR très lourd).
      const scenarios: Record<string, Record<string, number>> = {
        'sans emprunt': { emprunt_capital: 0 },
        'sans apport ni emprunt': { apport_capital: 0, emprunt_capital: 0 },
        'délai clients très long': { delai_clients_jours: 180 },
        'rotation de stock très lente': { rotation_stock_jours: 180 },
        'croissance négative': { taux_croissance_ca: -0.2 },
        'aucun investissement': { investissements_initiaux: 0, bfr_initial: 0 },
        'BFR initial très lourd': { bfr_initial: 50000 },
      };
      for (const [nom, values] of Object.entries(scenarios)) {
        it(`équilibre le bilan sur les 5 exercices — scénario « ${nom} »`, () => {
          const v = byId(evaluateTemplate(template, values).lines);
          for (let n = 1; n <= 5; n++) {
            const ecart = v.get(`bilan_ecart_equilibre_annuel_${n}`)!;
            expect(Math.abs(ecart), `écart exercice ${n}`).toBeLessThan(TOLERANCE_EQUILIBRE);
          }
        });
      }

      it('ne produit aucune valeur non finie (docs/21 § Contrôles)', () => {
        const { lines } = evaluateTemplate(template, {});
        const nonFinies = lines.filter((l) => !Number.isFinite(l.value));
        expect(nonFinies.map((l) => l.lineId)).toEqual([]);
      });
    });
  }
});

// ─── Cohérence interne du bilan ───────────────────────────────

describe('bilan — cohérence des agrégats et des reports', () => {
  const template = loadTemplate('quincaillerie-negoce');

  it('actif immobilisé net = brut − amortissements cumulés', () => {
    const v = byId(evaluateTemplate(template, {}).lines);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`bilan_actif_immobilise_annuel_${n}`)).toBeCloseTo(
        v.get(`bilan_immobilisations_brutes_annuel_${n}`)! -
          v.get(`bilan_amortissements_cumules_annuel_${n}`)!,
        6,
      );
    }
  });

  it('capitaux propres = capital apporté + résultats cumulés', () => {
    const v = byId(evaluateTemplate(template, {}).lines);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`bilan_capitaux_propres_annuel_${n}`)).toBeCloseTo(
        v.get(`bilan_capital_apporte_annuel_${n}`)! + v.get(`bilan_resultats_cumules_annuel_${n}`)!,
        6,
      );
    }
  });

  it('les résultats cumulés sont bien le cumul des résultats nets de la CAF', () => {
    const v = byId(evaluateTemplate(template, {}).lines);
    let cumul = 0;
    for (let n = 1; n <= 5; n++) {
      cumul += v.get(`caf_resultat_net_annuel_${n}`)!;
      expect(v.get(`bilan_resultats_cumules_annuel_${n}`)).toBeCloseTo(cumul, 6);
    }
  });

  it('les amortissements cumulés sont le cumul des dotations de la feuille amortissements', () => {
    const { lines, amortissements } = evaluateTemplate(template, {});
    const v = byId(lines);
    let cumul = 0;
    for (let n = 1; n <= 5; n++) {
      cumul += amortissements!.dap_par_annee[n - 1]!;
      expect(v.get(`bilan_amortissements_cumules_annuel_${n}`)).toBeCloseTo(cumul, 6);
    }
  });

  it('la trésorerie d’ouverture du bilan égale la ligne DSL existante `tresorerie_initiale`', () => {
    // Non-régression de cohérence : le bilan ne réinvente pas une seconde
    // trésorerie de départ, il repart de celle du plan de financement.
    const v = byId(evaluateTemplate(template, {}).lines);
    expect(v.get('bilan_tresorerie_actif_ouverture')).toBeCloseTo(v.get('tresorerie_initiale')!, 6);
  });

  it('la trésorerie se déroule bien de N−1 à N (CAF − ΔBFR − remboursement)', () => {
    const v = byId(evaluateTemplate(template, {}).lines);
    let precedente = v.get('bilan_tresorerie_actif_ouverture')!;
    for (let n = 1; n <= 5; n++) {
      const attendue =
        precedente +
        v.get(`caf_totale_annuel_${n}`)! -
        v.get(`pf_bfr_variation_annuel_${n}`)! -
        v.get(`bilan_dette_remboursement_annuel_${n}`)!;
      expect(v.get(`bilan_tresorerie_actif_annuel_${n}`), `trésorerie exercice ${n}`).toBeCloseTo(
        attendue,
        6,
      );
      precedente = v.get(`bilan_tresorerie_actif_annuel_${n}`)!;
    }
  });
});

// ─── CAF ──────────────────────────────────────────────────────

describe('CAF — capacité d’autofinancement', () => {
  for (const slug of TEMPLATES) {
    it(`${slug} : CAF = résultat net + dotations, croisé avec la feuille amortissements`, () => {
      const { lines, amortissements } = evaluateTemplate(loadTemplate(slug), {});
      const v = byId(lines);
      expect(amortissements).toBeDefined();
      for (let n = 1; n <= 5; n++) {
        const rn = v.get(`caf_resultat_net_annuel_${n}`)!;
        const dot = v.get(`caf_dotations_annuel_${n}`)!;
        // La dotation de la CAF est exactement le total DAP de la feuille amortissements.
        expect(dot, `dotations exercice ${n}`).toBeCloseTo(
          amortissements!.dap_par_annee[n - 1]!,
          6,
        );
        expect(dot).toBeCloseTo(v.get(`dap_total_a${n}`)!, 6);
        expect(v.get(`caf_totale_annuel_${n}`), `CAF exercice ${n}`).toBeCloseTo(rn + dot, 6);
      }
    });
  }

  it('la CAF revient au résultat de projection diminué des seuls intérêts', () => {
    // RN = résultat_annuel − DAP − intérêts, donc CAF = RN + DAP = résultat_annuel − intérêts.
    // Vérifie que les dotations sont bien neutres sur la CAF (flux non monétaire).
    const v = byId(evaluateTemplate(loadTemplate('restaurant-kinshasa'), {}).lines);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`caf_totale_annuel_${n}`)).toBeCloseTo(
        v.get(`resultat_annuel_${n}`)! - v.get(`bilan_dette_interets_annuel_${n}`)!,
        6,
      );
    }
  });

  it('la CAF cumulée est la somme des CAF annuelles', () => {
    const v = byId(evaluateTemplate(loadTemplate('prestation-services'), {}).lines);
    let somme = 0;
    for (let n = 1; n <= 5; n++) somme += v.get(`caf_totale_annuel_${n}`)!;
    expect(v.get('caf_cumulee_5ans')).toBeCloseTo(somme, 6);
  });
});

// ─── BFR ──────────────────────────────────────────────────────

describe('BFR — délais clients, fournisseurs et rotation de stock', () => {
  const template = loadTemplate('quincaillerie-negoce');

  it('BFR = stocks + créances − fournisseurs − dettes fiscales et sociales', () => {
    const v = byId(evaluateTemplate(template, {}).lines);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`pf_bfr_total_annuel_${n}`)).toBeCloseTo(
        v.get(`pf_bfr_stocks_annuel_${n}`)! +
          v.get(`pf_bfr_creances_clients_annuel_${n}`)! -
          v.get(`pf_bfr_fournisseurs_annuel_${n}`)! -
          v.get(`pf_bfr_dettes_fiscales_sociales_annuel_${n}`)!,
        6,
      );
    }
  });

  it('les créances suivent CA × délai clients / 360', () => {
    const v = byId(evaluateTemplate(template, { delai_clients_jours: 45 }).lines);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`pf_bfr_creances_clients_annuel_${n}`)).toBeCloseTo(
        (v.get(`ca_annuel_${n}`)! * 45) / 360,
        6,
      );
    }
  });

  it('allonger le délai clients dégrade la trésorerie du montant exact des créances supplémentaires', () => {
    const base = byId(evaluateTemplate(template, { delai_clients_jours: 15 }).lines);
    const allonge = byId(evaluateTemplate(template, { delai_clients_jours: 45 }).lines);

    const creancesSupplementaires =
      allonge.get('pf_bfr_creances_clients_annuel_1')! -
      base.get('pf_bfr_creances_clients_annuel_1')!;
    expect(creancesSupplementaires).toBeGreaterThan(0);

    // Exercice 1 : le BFR d'ouverture est identique, donc la variation de BFR
    // augmente exactement des créances supplémentaires — et la trésorerie recule d'autant.
    expect(
      allonge.get('pf_bfr_variation_annuel_1')! - base.get('pf_bfr_variation_annuel_1')!,
    ).toBeCloseTo(creancesSupplementaires, 6);
    expect(
      base.get('bilan_tresorerie_actif_annuel_1')! -
        allonge.get('bilan_tresorerie_actif_annuel_1')!,
    ).toBeCloseTo(creancesSupplementaires, 6);

    // Le bilan reste équilibré dans les deux cas.
    for (let n = 1; n <= 5; n++) {
      expect(Math.abs(allonge.get(`bilan_ecart_equilibre_annuel_${n}`)!)).toBeLessThan(
        TOLERANCE_EQUILIBRE,
      );
    }
  });

  it('allonger le délai fournisseurs améliore la trésorerie (financement du cycle)', () => {
    const base = byId(evaluateTemplate(template, { delai_fournisseurs_jours: 30 }).lines);
    const allonge = byId(evaluateTemplate(template, { delai_fournisseurs_jours: 60 }).lines);
    expect(allonge.get('pf_bfr_total_annuel_1')!).toBeLessThan(base.get('pf_bfr_total_annuel_1')!);
    expect(allonge.get('bilan_tresorerie_actif_annuel_1')!).toBeGreaterThan(
      base.get('bilan_tresorerie_actif_annuel_1')!,
    );
  });

  it('ralentir la rotation du stock alourdit le BFR et pèse sur la trésorerie', () => {
    const rapide = byId(evaluateTemplate(template, { rotation_stock_jours: 30 }).lines);
    const lente = byId(evaluateTemplate(template, { rotation_stock_jours: 90 }).lines);
    expect(lente.get('pf_bfr_stocks_annuel_1')!).toBeGreaterThan(
      rapide.get('pf_bfr_stocks_annuel_1')!,
    );
    expect(lente.get('bilan_tresorerie_actif_annuel_1')!).toBeLessThan(
      rapide.get('bilan_tresorerie_actif_annuel_1')!,
    );
  });

  it('un modèle de services sans achats variables n’a ni stock ni dettes fournisseurs', () => {
    const v = byId(evaluateTemplate(loadTemplate('prestation-services'), {}).lines);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`pf_bfr_stocks_annuel_${n}`)).toBe(0);
      expect(v.get(`pf_bfr_fournisseurs_annuel_${n}`)).toBe(0);
      // Le BFR se réduit alors aux seules créances clients.
      expect(v.get(`pf_bfr_total_annuel_${n}`)).toBeCloseTo(
        v.get(`pf_bfr_creances_clients_annuel_${n}`)!,
        6,
      );
    }
  });

  it('un restaurant encaissé comptant dégage un BFR négatif (ressource de trésorerie)', () => {
    // Défauts : clients 2 j, stock 7 j, fournisseurs 15 j sur 32 % de food cost.
    const v = byId(evaluateTemplate(loadTemplate('restaurant-kinshasa'), {}).lines);
    expect(v.get('pf_bfr_total_annuel_1')!).toBeLessThan(0);
  });
});

// ─── Seuil de rentabilité ─────────────────────────────────────

describe('seuil de rentabilité et point mort', () => {
  it('restaurant : au CA du seuil, le résultat courant avant impôt est nul', () => {
    const template = loadTemplate('restaurant-kinshasa');
    const base = byId(evaluateTemplate(template, {}).lines);
    const caSeuil = base.get('sr_ca_seuil_annuel_1')!;
    expect(caSeuil).toBeGreaterThan(0);

    // Le seuil ne dépend pas du volume (charges fixes et taux de marge constants) :
    // on ramène le CA au seuil en ajustant le ticket moyen.
    const ticketSeuil = caSeuil / 12 / (60 * 26);
    const v = byId(evaluateTemplate(template, { ticket_moyen: ticketSeuil }).lines);

    expect(v.get('ca_annuel_1')).toBeCloseTo(caSeuil, 6);
    // Résultat courant avant impôt = EBE annuel − dotations − intérêts ≈ 0.
    const resultatCourant =
      v.get('excedent_brut')! * 12 -
      v.get('caf_dotations_annuel_1')! -
      v.get('bilan_dette_interets_annuel_1')!;
    expect(resultatCourant).toBeCloseTo(0, 6);
  });

  it('prestation de services : au CA du seuil, le résultat courant avant impôt est nul', () => {
    const template = loadTemplate('prestation-services');
    const base = byId(evaluateTemplate(template, {}).lines);
    const caSeuil = base.get('sr_ca_seuil_annuel_1')!;

    // Sans achats variables, le seuil vaut exactement les charges fixes retenues.
    expect(caSeuil).toBeCloseTo(base.get('sr_charges_fixes_annuel_1')!, 6);
    expect(base.get('sr_taux_marge_variable_annuel_1')).toBe(1);

    const tarifSeuil = caSeuil / 12 / 15;
    const v = byId(evaluateTemplate(template, { tarif_journalier_moyen: tarifSeuil }).lines);
    const resultatCourant =
      v.get('excedent_brut')! * 12 -
      v.get('caf_dotations_annuel_1')! -
      v.get('bilan_dette_interets_annuel_1')!;
    expect(resultatCourant).toBeCloseTo(0, 6);
  });

  it('les charges fixes du seuil = charges d’exploitation + dotations + intérêts', () => {
    const v = byId(evaluateTemplate(loadTemplate('quincaillerie-negoce'), {}).lines);
    expect(v.get('sr_charges_fixes_annuel_1')).toBeCloseTo(
      v.get('charges_operationnelles')! * 12 +
        v.get('caf_dotations_annuel_1')! +
        v.get('bilan_dette_interets_annuel_1')!,
      6,
    );
  });

  it('le point mort en mois et en jours décrivent la même date', () => {
    const v = byId(evaluateTemplate(loadTemplate('quincaillerie-negoce'), {}).lines);
    for (let n = 1; n <= 5; n++) {
      const mois = v.get(`sr_point_mort_mois_annuel_${n}`)!;
      const jours = v.get(`sr_point_mort_jours_annuel_${n}`)!;
      expect(jours).toBeCloseTo(mois * 30, 6);
      expect(mois).toBeGreaterThan(0);
    }
  });

  it('la marge de sécurité est cohérente avec le CA et le seuil', () => {
    const v = byId(evaluateTemplate(loadTemplate('restaurant-kinshasa'), {}).lines);
    for (let n = 1; n <= 5; n++) {
      const ca = v.get(`sr_ca_annuel_${n}`)!;
      const seuil = v.get(`sr_ca_seuil_annuel_${n}`)!;
      expect(v.get(`sr_marge_securite_annuel_${n}`)).toBeCloseTo((ca - seuil) / ca, 6);
    }
  });

  it('CA nul → seuil et point mort ramenés à 0, aucune valeur non finie', () => {
    const { lines } = evaluateTemplate(loadTemplate('prestation-services'), {
      jours_facturables_mois: 0,
    });
    const v = byId(lines);
    expect(v.get('sr_taux_marge_variable_annuel_1')).toBe(0);
    expect(v.get('sr_ca_seuil_annuel_1')).toBe(0);
    expect(v.get('sr_point_mort_mois_annuel_1')).toBe(0);
    expect(lines.every((l) => Number.isFinite(l.value))).toBe(true);
  });
});

// ─── Cohérence CR / états financiers ──────────────────────────

describe('cohérence de la projection à 5 exercices', () => {
  it('CA − achats variables − charges fixes = EBE, sur chaque exercice', () => {
    // Les achats et les charges fixes sont extrapolés au taux de croissance du CA,
    // exactement comme la projection fait croître le résultat net. Ce test verrouille
    // cette cohérence : sans elle, le seuil de rentabilité serait faux en années 2-5.
    const v = byId(evaluateTemplate(loadTemplate('restaurant-kinshasa'), {}).lines);
    const ebeAnnee1 = v.get('excedent_brut')! * 12;
    const croissance = 0.15;
    for (let n = 1; n <= 5; n++) {
      const ebeAttendu = ebeAnnee1 * Math.pow(1 + croissance, n - 1);
      expect(
        v.get(`sr_ca_annuel_${n}`)! -
          v.get(`sr_charges_variables_annuel_${n}`)! -
          (v.get(`sr_charges_fixes_annuel_${n}`)! -
            v.get(`caf_dotations_annuel_${n}`)! -
            v.get(`bilan_dette_interets_annuel_${n}`)!),
        `EBE exercice ${n}`,
      ).toBeCloseTo(ebeAttendu, 4);
    }
  });

  it('les lignes de projection existantes gardent leurs valeurs (non-régression)', () => {
    const v = byId(evaluateTemplate(loadTemplate('prestation-services'), {}).lines);
    expect(v.get('ca_annuel_1')).toBe(36000);
    expect(v.get('ca_annuel_2')).toBeCloseTo(43200, 6);
    expect(v.get('ca_annuel_3')).toBeCloseTo(51840, 6);
    expect(v.get('resultat_annuel_1')).toBeCloseTo(10080, 6);
    expect(v.get('resultat_cumule_3ans')).toBeCloseTo(36691.2, 3);
    // Et les nouvelles lignes prolongent la même suite géométrique.
    expect(v.get('ca_annuel_4')).toBeCloseTo(62208, 6);
    expect(v.get('ca_annuel_5')).toBeCloseTo(74649.6, 3);
    expect(v.get('resultat_cumule_5ans')).toBeCloseTo(
      v.get('resultat_cumule_3ans')! + v.get('resultat_annuel_4')! + v.get('resultat_annuel_5')!,
      6,
    );
  });
});

// ─── Échéancier de la dette ───────────────────────────────────

describe('échéancier de la dette (PMT)', () => {
  it('rembourse exactement le capital sur la durée du prêt', () => {
    const echeancier = calculerEcheancierDette(25000, 0.14, 60, 5);
    const totalRembourse = echeancier.reduce((s, e) => s + e.remboursement_capital, 0);
    expect(totalRembourse).toBeCloseTo(25000, 6);
    expect(echeancier[4]!.capital_restant_cloture).toBe(0);
    expect(echeancier.every((e) => e.interets >= 0)).toBe(true);
  });

  it('les intérêts décroissent à mesure que le capital est remboursé', () => {
    const echeancier = calculerEcheancierDette(25000, 0.14, 60, 5);
    for (let i = 1; i < 5; i++) {
      expect(echeancier[i]!.interets).toBeLessThan(echeancier[i - 1]!.interets);
    }
  });

  it('un prêt plus court que l’horizon laisse les derniers exercices à zéro', () => {
    // 36 mois = 3 exercices : les exercices 4 et 5 n'ont ni échéance ni intérêt.
    const echeancier = calculerEcheancierDette(5000, 0.14, 36, 5);
    expect(echeancier[3]!.remboursement_capital).toBe(0);
    expect(echeancier[3]!.interets).toBe(0);
    expect(echeancier[4]!.capital_restant_cloture).toBe(0);
    expect(echeancier.reduce((s, e) => s + e.remboursement_capital, 0)).toBeCloseTo(5000, 6);
  });

  it('taux nul → amortissement linéaire, aucun intérêt', () => {
    const echeancier = calculerEcheancierDette(12000, 0, 24, 3);
    expect(echeancier[0]!.remboursement_capital).toBeCloseTo(6000, 6);
    expect(echeancier[1]!.remboursement_capital).toBeCloseTo(6000, 6);
    expect(echeancier.every((e) => e.interets === 0)).toBe(true);
  });

  it('capital nul → échéancier entièrement à zéro (pas de division par zéro)', () => {
    const echeancier = calculerEcheancierDette(0, 0.14, 60, 5);
    expect(echeancier).toHaveLength(5);
    expect(echeancier.every((e) => e.remboursement_capital === 0 && e.interets === 0)).toBe(true);
  });

  it('la mensualité de l’échéancier concorde avec la ligne DSL `mensualite_emprunt`', () => {
    const v = byId(evaluateTemplate(loadTemplate('restaurant-kinshasa'), {}).lines);
    const echeancier = calculerEcheancierDette(25000, 0.14, 60, 5);
    const serviceAnnuel = v.get('mensualite_emprunt')! * 12;
    expect(echeancier[0]!.remboursement_capital + echeancier[0]!.interets).toBeCloseTo(
      serviceAnnuel,
      6,
    );
  });

  it('la dette financière du bilan suit le capital restant dû', () => {
    const v = byId(evaluateTemplate(loadTemplate('restaurant-kinshasa'), {}).lines);
    const echeancier = calculerEcheancierDette(25000, 0.14, 60, 5);
    for (let n = 1; n <= 5; n++) {
      expect(v.get(`bilan_dettes_financieres_annuel_${n}`)).toBeCloseTo(
        echeancier[n - 1]!.capital_restant_cloture,
        6,
      );
    }
    // Prêt de 60 mois = 5 exercices → dette soldée en fin d'horizon.
    expect(v.get('bilan_dettes_financieres_annuel_5')).toBe(0);
  });
});

// ─── Feux tricolores et compatibilité ─────────────────────────

describe('feux tricolores et compatibilité ascendante', () => {
  it('sans ParameterPack, l’autonomie financière reste informative (aucun feu)', () => {
    const { lines } = evaluateTemplate(loadTemplate('restaurant-kinshasa'), {});
    const ligne = lines.find((l) => l.lineId === 'bilan_autonomie_financiere_annuel_1');
    expect(ligne).toBeDefined();
    expect(ligne!.seuil).toBeUndefined();
  });

  it('avec un pack fournissant ratio_autonomie_financiere_min, le feu est calculé', () => {
    const pack = {
      slug: 'test',
      pays: 'CD',
      annee: 2026,
      params: { ratio_autonomie_financiere_min: { valeur: 0.3 } },
    } as never;
    const { lines } = evaluateTemplate(
      loadTemplate('restaurant-kinshasa'),
      {},
      {
        parameterPack: pack,
      },
    );
    const ligne = lines.find((l) => l.lineId === 'bilan_autonomie_financiere_annuel_1')!;
    expect(ligne.seuil).toBeDefined();
    expect(ligne.seuil!.valeur).toBe(0.3);
    expect(ligne.seuil!.direction).toBe('min');
    expect(['vert', 'orange', 'rouge']).toContain(ligne.seuil!.statut);
  });

  it('un template sans `structure_financiere` ne produit aucune des nouvelles feuilles', () => {
    const template = parseTemplate(`
slug: sans-structure
version: 1.0.0
drivers:
  - { id: x, type: number, defaut: 10 }
feuilles:
  - id: s
    lignes:
      - { id: y, formule: "x * 2" }
`);
    const { lines, etatsFinanciers } = evaluateTemplate(template, {});
    expect(etatsFinanciers).toBeUndefined();
    expect(lines.map((l) => l.lineId)).toEqual(['y']);
    for (const sheet of ['bilan', 'caf', 'seuil_rentabilite']) {
      expect(lines.some((l) => l.sheetId === sheet)).toBe(false);
    }
  });

  it('les nouvelles lignes portent bien les sheetId prévus par ADR-0011', () => {
    const { lines } = evaluateTemplate(loadTemplate('restaurant-kinshasa'), {});
    const sheets = new Set(lines.map((l) => l.sheetId));
    expect(sheets.has('bilan')).toBe(true);
    expect(sheets.has('caf')).toBe(true);
    expect(sheets.has('seuil_rentabilite')).toBe(true);
    // Le BFR reste dans plan_financement (ADR-0011 § Contrat 2), sans feuille dédiée.
    expect(sheets.has('bfr')).toBe(false);
    for (const l of lines.filter((x) => x.sheetId === 'bilan')) {
      expect(l.lineId.startsWith('bilan_'), l.lineId).toBe(true);
    }
    for (const l of lines.filter((x) => x.sheetId === 'caf')) {
      expect(l.lineId.startsWith('caf_'), l.lineId).toBe(true);
    }
    for (const l of lines.filter((x) => x.sheetId === 'seuil_rentabilite')) {
      expect(l.lineId.startsWith('sr_'), l.lineId).toBe(true);
    }
  });

  it('aucun identifiant de ligne n’est dupliqué après injection des états financiers', () => {
    for (const slug of TEMPLATES) {
      const { lines } = evaluateTemplate(loadTemplate(slug), {});
      const ids = lines.map((l) => l.lineId);
      expect(new Set(ids).size, `${slug} : ids dupliqués`).toBe(ids.length);
    }
  });
});

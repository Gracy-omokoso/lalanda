// Où le quota d'exports PDF a le droit d'être consulté — et nulle part ailleurs.
//
// Jumeau de `project-limit.surface.test.ts`, et pour la même raison. La règle
// posée pour les projets — une organisation de production détient 5 projets sur
// une offre qui en autorise 1, et ses plans « restent lisibles, modifiables et
// exportables » — s'applique ici sans adaptation : le quota d'exports borne les
// rendus À VENIR, il ne doit JAMAIS rendre inaccessible un plan déjà produit.
//
// Cette garantie ne tient pas par bonne volonté. Un test de comportement ne peut
// pas la prouver : il faudrait monter chaque route et vérifier qu'elle ne refuse
// pas, ce qui laisserait toujours la route suivante hors couverture. Ce test-ci
// vérifie la SURFACE — la liste des fichiers autorisés à consulter le plafond,
// et le seul endroit où la garde a le droit d'être appelée. Ajouter une
// consultation ailleurs fait échouer la suite, et c'est le moment où il faut se
// demander si on est en train de fermer l'accès à un dossier bancaire en cours.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Fichiers de production autorisés à consulter `pdfExportsPerMonth`, et à quel titre.
 *
 * Chemins relatifs à `apps/api/src`, séparateurs POSIX.
 */
const AUTORISES: Readonly<Record<string, string>> = {
  // La règle elle-même.
  'billing/pdf-export-quota.ts': 'porte la règle',
  // Le court-circuit des offres illimitées, qui évite un décompte inutile.
  'billing/pdf-export-quota.service.ts': 'applique la règle et compte',
};

/** Le SEUL fichier autorisé à APPLIQUER la garde, c'est-à-dire à refuser un rendu. */
/**
 * Routes d'export PDF qui APPLIQUENT le quota de l'offre : le dossier financier
 * (S22i) et, depuis le 27 oct. 2026, le business plan narratif (ADR-0037), dont
 * l'export PDF est un export du même quota. Aucune autre.
 */
const PORTEURS_DE_LA_GARDE = [
  'reports/reports.controller.ts',
  'business-plan/business-plan.controller.ts',
];

/**
 * Fichiers autorisés à seulement NOMMER `PdfExportQuotaService`, et à quel titre.
 *
 * Nommer la garde et l'appliquer sont deux choses différentes, et c'est la
 * distinction que ce fichier doit tenir. `billing.controller.ts` en injecte une
 * pour servir `GET current/quota/pdf-exports`, qui LIT l'état du mois sans rien
 * refuser : docs/13 — « l'interface peut expliquer une limite, mais l'API
 * l'impose ». Dire à l'utilisateur combien d'exports il lui reste AVANT qu'il ne
 * se heurte au refus est le rôle légitime de l'interface ; c'est exactement ce
 * que fait `GET /ai/quota` à côté de son propre `runGuarded`.
 *
 * L'autorisation est donc bornée à la LECTURE : les verbes d'application sont
 * énumérés plus bas et vérifiés absents de ces fichiers.
 */
const LECTEURS_SEULS: Readonly<Record<string, string>> = {
  'billing/billing.controller.ts': 'expose l’état du quota, sans jamais refuser',
};

/**
 * Les verbes qui REFUSENT un export. Les voir ailleurs que dans la garde et son
 * porteur signifierait qu'un second endroit a le pouvoir de bloquer un rendu.
 */
const VERBES_QUI_REFUSENT = ['runGuarded', 'assertWithinQuota'] as const;

function fichiersSource(dir: string, prefixe = ''): string[] {
  const out: string[] = [];
  for (const entree of readdirSync(dir)) {
    const complet = join(dir, entree);
    const relatif = prefixe ? `${prefixe}/${entree}` : entree;
    if (statSync(complet).isDirectory()) {
      out.push(...fichiersSource(complet, relatif));
    } else if (entree.endsWith('.ts') && !entree.includes('.test.')) {
      out.push(relatif);
    }
  }
  return out;
}

describe('surface du quota d’exports PDF', () => {
  const sources = fichiersSource(SRC);
  const mentions = sources.filter((f) =>
    readFileSync(join(SRC, f), 'utf8').includes('pdfExportsPerMonth'),
  );

  /**
   * Fichiers qui NOMMENT la garde d'exports PDF.
   *
   * C'est nécessairement un sur-ensemble de ceux qui peuvent l'appliquer : la
   * garde s'injecte par son type (`@Inject(PdfExportQuotaService)`), on ne peut
   * pas la faire refuser sans l'avoir nommée. Les deux premiers tests ci-dessous
   * se composent donc en une seule propriété : le premier fige QUI a le droit de
   * tenir la garde, le second fige LEQUEL d'entre eux a le droit de refuser.
   *
   * Ce filtrage est aussi ce qui rend les verbes lisibles : `runGuarded` et
   * `assertWithinQuota` sont délibérément les mêmes noms que côté quota IA
   * (`ai-quota.service.ts`), et les chercher dans tout `src/` remonterait ces
   * homonymes, qui ne bornent aucun export PDF.
   */
  const porteurs = sources.filter((f) =>
    readFileSync(join(SRC, f), 'utf8').includes('PdfExportQuotaService'),
  );

  it('n’est consulté que par les fichiers qui en ont le droit', () => {
    expect([...mentions].sort()).toEqual(Object.keys(AUTORISES).sort());
  });

  it('n’est consulté par aucun chemin de lecture ni par le moteur', () => {
    // Formulé en négatif et par répertoire : c'est la garantie qui compte pour
    // l'utilisateur dont les plans doivent rester ouvrables une fois son quota
    // épuisé. Un plan se lit, se modifie et s'évalue sans qu'on regarde jamais
    // combien de PDF il reste.
    for (const fichier of mentions) {
      for (const interdit of ['plans/', 'projects/', 'evaluate/', 'financial-plans/']) {
        expect(fichier.startsWith(interdit), `${fichier} consulte pdfExportsPerMonth`).toBe(false);
      }
    }
  });

  it('n’est nommé que par les fichiers qui en ont le droit', () => {
    // La garde elle-même, le module qui la fournit, la route qui l'applique, et
    // les lecteurs qui se contentent d'afficher l'état.
    expect([...porteurs].sort()).toEqual(
      [
        'billing/billing.module.ts',
        'billing/pdf-export-quota.service.ts',
        ...PORTEURS_DE_LA_GARDE,
        ...Object.keys(LECTEURS_SEULS),
      ].sort(),
    );
  });

  it('n’est APPLIQUÉ que depuis les routes d’export PDF déclarées', () => {
    // L'assertion qui porte réellement la garantie. Nommer la garde est
    // inoffensif ; pouvoir refuser un rendu ne l'est pas. Parmi les fichiers qui
    // la tiennent, un seul a le droit de s'en servir pour refuser — sans quoi un
    // second point d'application se glisserait dans la liste des autorisés en se
    // faisant passer pour un lecteur.
    const refuseurs = porteurs.filter((f) => {
      const source = readFileSync(join(SRC, f), 'utf8');
      return VERBES_QUI_REFUSENT.some((verbe) => source.includes(verbe));
    });

    expect([...refuseurs].sort()).toEqual(
      ['billing/pdf-export-quota.service.ts', ...PORTEURS_DE_LA_GARDE].sort(),
    );
  });

  it('ne laisse aux lecteurs que la lecture : aucun d’eux ne peut refuser', () => {
    // Redit la même chose depuis l'autre bout, et c'est voulu : la liste
    // `LECTEURS_SEULS` est une autorisation, et une autorisation qu'on accorde
    // sans la borner finit par servir à autre chose. `status()` n'a aucun effet
    // de bord — un écran qui affiche « il vous reste 2 exports » ne doit ni en
    // consommer un, ni pouvoir en bloquer un.
    for (const fichier of Object.keys(LECTEURS_SEULS)) {
      const source = readFileSync(join(SRC, fichier), 'utf8');
      for (const verbe of VERBES_QUI_REFUSENT) {
        expect(source.includes(verbe), `${fichier} peut refuser un export (${verbe})`).toBe(false);
      }
      // Et il ne compte pas non plus : `record` écrirait au compteur du quota
      // depuis une route de simple consultation.
      expect(source).not.toContain('pdfQuota.record');
    }
  });

  it('ne borne QUE le PDF : la route Excel ne touche pas à la garde', () => {
    // La preuve structurelle de « l'Excel n'est jamais plafonné ». Le test de
    // comportement (`reports/reports.controller.quota.test.ts`) montre qu'un
    // classeur sort à quota épuisé ; celui-ci montre qu'aucune ligne ne pourrait
    // le bloquer, y compris dans une variante non testée.
    const source = readFileSync(join(SRC, 'reports/reports.controller.ts'), 'utf8');
    const debutPdf = source.indexOf('async downloadPdf(');
    const debutXlsx = source.indexOf('async downloadXlsx(');

    expect(debutPdf).toBeGreaterThan(-1);
    expect(debutXlsx).toBeGreaterThan(debutPdf);

    expect(source.slice(debutPdf, debutXlsx)).toContain('this.pdfQuota.runGuarded');
    expect(source.slice(debutXlsx)).not.toContain('this.pdfQuota');
  });
});

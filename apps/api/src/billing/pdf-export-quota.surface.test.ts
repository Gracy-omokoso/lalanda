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

/** Le SEUL fichier autorisé à appeler la garde. */
const PORTEUR_DE_LA_GARDE = 'reports/reports.controller.ts';

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

  it('n’est appliqué que depuis la route d’export, et par un seul fichier', () => {
    const appelants = sources.filter((f) =>
      readFileSync(join(SRC, f), 'utf8').includes('PdfExportQuotaService'),
    );
    // La garde elle-même, le module qui la fournit, et la route qui l'applique.
    expect([...appelants].sort()).toEqual(
      [
        'billing/billing.module.ts',
        'billing/pdf-export-quota.service.ts',
        PORTEUR_DE_LA_GARDE,
      ].sort(),
    );
  });

  it('ne borne QUE le PDF : la route Excel ne touche pas à la garde', () => {
    // La preuve structurelle de « l'Excel n'est jamais plafonné ». Le test de
    // comportement (`reports/reports.controller.quota.test.ts`) montre qu'un
    // classeur sort à quota épuisé ; celui-ci montre qu'aucune ligne ne pourrait
    // le bloquer, y compris dans une variante non testée.
    const source = readFileSync(join(SRC, PORTEUR_DE_LA_GARDE), 'utf8');
    const debutPdf = source.indexOf('async downloadPdf(');
    const debutXlsx = source.indexOf('async downloadXlsx(');

    expect(debutPdf).toBeGreaterThan(-1);
    expect(debutXlsx).toBeGreaterThan(debutPdf);

    expect(source.slice(debutPdf, debutXlsx)).toContain('this.pdfQuota.runGuarded');
    expect(source.slice(debutXlsx)).not.toContain('this.pdfQuota');
  });
});

// Validation LOCALE d'un paquet de modèle de facture — ADR-0029 § 5.
//
//   pnpm --filter @lalanda/api modele:valider <dossier|archive.zip> [options]
//
//   --pdf <fichier.pdf>    aperçu réel (Chromium requis) : facture fictive EXEMPLE,
//                          environnement de test et DUPLICATA, rendue par le vrai moteur
//   --html <fichier.html>  HTML assemblé de l'aperçu (sans Chromium)
//   --paquet <fichier.zip> archive prête à téléverser (seulement si le paquet est valide)
//   --variables            liste des variables du contrat de données, puis sortie
//   --json                 rapport en JSON (pour un agent ou une CI)
//
// Même code de validation que l'API : un paquet valide ici est accepté au
// téléversement. Code de sortie 0 si valide, 1 sinon, 2 en cas d'erreur d'usage.

import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { PdfRenderingService } from '../../../../reports/pdf-rendering.service.js';
import { qrCodeSvg } from '../../invoice-qr.js';
import { renderDocumentHtml } from '../template-engine.js';
import { resolveCustomOptions } from './custom-options.js';
import { variableList } from './data-contract.js';
import { PACKAGE_LIMITS, collectPackageFiles, filesFromArchive } from './package-files.js';
import { IssueList, formatIssue } from './report.js';
import { SAMPLE_IDENTITY, sampleLogos, validatePackageFiles } from './validate-package.js';
import { validationCases } from './validation-cases.js';
import { writeZip } from './zip.js';

interface Args {
  target: string | null;
  pdf: string | null;
  html: string | null;
  paquet: string | null;
  variables: boolean;
  json: boolean;
}

function usage(message?: string): never {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    'Usage : pnpm --filter @lalanda/api modele:valider <dossier|archive.zip> [--pdf apercu.pdf] [--html apercu.html] [--paquet modele.zip] [--json]\n' +
      '        pnpm --filter @lalanda/api modele:valider --variables\n',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    target: null,
    pdf: null,
    html: null,
    paquet: null,
    variables: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i]!;
    if (v === '--') continue;
    if (v === '--variables') a.variables = true;
    else if (v === '--json') a.json = true;
    else if (v === '--pdf' || v === '--html' || v === '--paquet') {
      const next = argv[(i += 1)];
      if (!next) usage(`${v} attend un nom de fichier.`);
      a[v.slice(2) as 'pdf' | 'html' | 'paquet'] = next;
    } else if (v.startsWith('--')) usage(`Option inconnue : ${v}`);
    else if (a.target === null) a.target = v;
    else usage('Un seul dossier ou une seule archive à la fois.');
  }
  return a;
}

/** `pnpm --filter` exécute dans apps/api : les chemins se lisent depuis le dossier d'appel. */
function fromCaller(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env['INIT_CWD'] ?? process.cwd(), p);
}

/** Entrées d'un dossier, avec les mêmes plafonds qu'une archive (liens symboliques refusés). */
function readFolder(root: string, issues: IssueList) {
  const entries: Array<{ name: string; directory: boolean; data: Buffer | null; size: number }> =
    [];
  let total = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        issues.error({ code: 'ZIP_SYMLINK', message: 'Lien symbolique refusé.', file: rel });
        continue;
      }
      if (entries.length >= PACKAGE_LIMITS.maxEntries) {
        issues.error({
          code: 'ZIP_TOO_MANY_ENTRIES',
          message: `Plus de ${PACKAGE_LIMITS.maxEntries} entrées.`,
        });
        return;
      }
      if (st.isDirectory()) {
        entries.push({ name: `${rel}/`, directory: true, data: null, size: 0 });
        walk(full);
      } else {
        total += st.size;
        if (total > PACKAGE_LIMITS.maxTotalBytes) {
          issues.error({ code: 'ZIP_TOO_LARGE', message: 'Contenu trop volumineux.' });
          return;
        }
        entries.push({
          name: rel,
          directory: false,
          data: st.size <= PACKAGE_LIMITS.imageBytes ? readFileSync(full) : null,
          size: st.size,
        });
      }
    }
  };
  walk(root);
  return entries;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.variables) {
    for (const v of variableList())
      process.stdout.write(`${v.path.padEnd(42)} ${v.type.padEnd(16)} ${v.doc}\n`);
    return;
  }
  if (!args.target) usage();
  const target = fromCaller(args.target);
  let st;
  try {
    st = lstatSync(target);
  } catch {
    usage(`Introuvable : ${target}`);
  }
  const issues = new IssueList();
  const files = st.isDirectory()
    ? collectPackageFiles(readFolder(target, issues), issues)
    : filesFromArchive(readFileSync(target), issues);
  const { report, template } = issues.ok
    ? await validatePackageFiles(files, issues)
    : { report: null, template: null };

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(report ?? { ok: false, errors: issues.errors, warnings: issues.warnings }, null, 2)}\n`,
    );
  } else {
    const m = report?.manifest;
    process.stdout.write(
      m
        ? `Paquet « ${m.name} » ${m.id}@${m.version} (contrat ${m.contract})\n`
        : `Paquet ${target}\n`,
    );
    if (report?.digest) process.stdout.write(`Empreinte : ${report.digest}\n`);
    for (const c of report?.cases ?? []) process.stdout.write(`  ${c.ok ? '✓' : '✗'} ${c.name}\n`);
    for (const w of issues.warnings) process.stdout.write(`AVERTISSEMENT ${formatIssue(w)}\n`);
    for (const e of issues.errors) process.stdout.write(`ERREUR ${formatIssue(e)}\n`);
    if (issues.truncated) process.stdout.write('… (rapport tronqué)\n');
    process.stdout.write(
      issues.ok
        ? 'VALIDE — le paquet peut être téléversé dans Ventes › Modèle de facture.\n'
        : `INVALIDE — ${issues.errors.length} erreur(s) à corriger.\n`,
    );
  }
  if (!template) process.exit(1);

  if (args.paquet) {
    const out = fromCaller(args.paquet);
    writeFileSync(
      out,
      writeZip(
        [...files.values()]
          .map((f) => ({ name: f.path, data: f.data }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    );
    if (!args.json) process.stdout.write(`Archive écrite : ${out}\n`);
  }

  if (args.pdf || args.html) {
    const c = validationCases({ label: template.label, version: template.manifest.version })[2]!;
    const options = resolveCustomOptions(template, null, SAMPLE_IDENTITY);
    const qr = c.model.security ? await qrCodeSvg(c.model.security.qrContent) : null;
    const r = renderDocumentHtml(c.model, qr, {
      template,
      options,
      identity: SAMPLE_IDENTITY,
      logos: sampleLogos(true),
    });
    if (args.html) {
      writeFileSync(fromCaller(args.html), r.html);
      if (!args.json) process.stdout.write(`Aperçu HTML écrit : ${fromCaller(args.html)}\n`);
    }
    if (args.pdf) {
      const pdf = new PdfRenderingService();
      try {
        const bytes = await pdf.render(r.html, {
          margin: r.margin,
          fixedDate: c.model.fixedDate,
          headerTemplate: r.headerTemplate,
          footerTemplate: r.footerTemplate,
        });
        writeFileSync(fromCaller(args.pdf), bytes);
        if (!args.json) process.stdout.write(`Aperçu PDF écrit : ${fromCaller(args.pdf)}\n`);
      } finally {
        await pdf.onModuleDestroy();
      }
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Erreur inattendue : ${(err as Error).stack ?? String(err)}\n`);
  process.exit(2);
});

// Rendu HTML d'un rapport de plan financier (S8-lite).
//
// Contient uniquement de la mise en forme : les valeurs proviennent du moteur
// (packages/engine). Aucun calcul ici (brief §3-1, CLAUDE.md).
// Le template est un string ES6 — pas de framework de templating, pas d'injection
// côté serveur, on échappe explicitement les valeurs qui viennent du user.

import type { Template } from '@lalanda/engine';

export interface ReportOrg {
  name: string;
  pays: string;
}

export interface ReportProject {
  name: string;
  templateSlug: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportLine {
  sheetId: string;
  lineId: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
}

export interface ReportData {
  organization: ReportOrg;
  project: ReportProject;
  template: Template;
  driverValues: Record<string, number>;
  lines: ReportLine[];
  /** ISO-8601. */
  generatedAt: string;
  /** Devise d'affichage — reprise du template si présente, USD sinon. */
  currency: 'USD' | 'CDF';
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatValue(value: number, format: ReportLine['format'], currency: string): string {
  if (!Number.isFinite(value)) return '—';
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'money') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

function driverFormatFromType(t: 'number' | 'percent' | 'money'): ReportLine['format'] {
  return t;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Rend le HTML complet du rapport. À passer à `page.setContent(...)` de Puppeteer.
 * Le CSS est inline pour n'avoir aucune dépendance réseau au rendu.
 */
export function renderReportHtml(data: ReportData): string {
  const { organization: org, project, template, driverValues, lines, generatedAt, currency } = data;

  // Groupement des drivers par groupe pour affichage lisible (fallback : un seul bloc).
  const groups = template.groupes_hypotheses ?? [];
  const driversByGroup = new Map<string, typeof template.drivers>();
  for (const d of template.drivers) {
    const key = d.groupe ?? '__default';
    const arr = driversByGroup.get(key) ?? [];
    arr.push(d);
    driversByGroup.set(key, arr);
  }
  const groupOrder = groups.length > 0 ? groups.map((g) => g.id) : ['__default'];
  const groupLabels = new Map<string, string>(groups.map((g) => [g.id, g.label]));
  groupLabels.set('__default', 'Hypothèses');

  // Groupement des lignes par feuille (préserve l'ordre du template).
  const linesBySheet = new Map<string, ReportLine[]>();
  for (const l of lines) {
    const arr = linesBySheet.get(l.sheetId) ?? [];
    arr.push(l);
    linesBySheet.set(l.sheetId, arr);
  }
  const sheetLabels = new Map<string, string>(
    template.feuilles.map((f) => [f.id, f.label ?? f.id]),
  );

  const driverBlocks = groupOrder
    .filter((gid) => (driversByGroup.get(gid) ?? []).length > 0)
    .map((gid) => {
      const drivers = driversByGroup.get(gid) ?? [];
      const rows = drivers
        .map((d) => {
          const value = driverValues[d.id] ?? d.defaut ?? 0;
          const formatted = formatValue(value, driverFormatFromType(d.type), d.devise ?? currency);
          return `<tr>
            <td>${escapeHtml(d.label ?? d.id)}</td>
            <td class="num">${escapeHtml(formatted)}</td>
          </tr>`;
        })
        .join('');
      return `<section class="card">
        <h3>${escapeHtml(groupLabels.get(gid) ?? gid)}</h3>
        <table class="kv">
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const resultBlocks = [...linesBySheet.entries()]
    .map(([sheetId, sheetLines]) => {
      const rows = sheetLines
        .map(
          (l) => `<tr>
          <td>${escapeHtml(l.label)}</td>
          <td class="num">${escapeHtml(formatValue(l.value, l.format, currency))}</td>
        </tr>`,
        )
        .join('');
      return `<section class="card">
        <h3>${escapeHtml(sheetLabels.get(sheetId) ?? sheetId)}</h3>
        <table class="kv">
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(project.name)} — Plan financier</title>
  <style>
    /* Palette identique à l'accent Lalanda (SYSCOHADA vert) — cohérence UI/PDF. */
    :root {
      --ink: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --accent: #0e7c66;
      --surface: #f8fafc;
    }
    * { box-sizing: border-box; }
    html, body { padding: 0; margin: 0; color: var(--ink); font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; line-height: 1.4; }
    body { padding: 20mm 15mm 25mm 15mm; }
    header.cover { border-bottom: 3px solid var(--accent); padding-bottom: 10mm; margin-bottom: 10mm; }
    header.cover h1 { margin: 0 0 4mm 0; font-size: 22pt; color: var(--accent); letter-spacing: -0.5px; }
    header.cover .meta { color: var(--muted); font-size: 10pt; }
    header.cover .meta strong { color: var(--ink); }
    header.cover .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 6mm; }
    h2 { margin: 12mm 0 4mm 0; font-size: 14pt; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 2mm; }
    .card { break-inside: avoid; margin-bottom: 6mm; }
    .card h3 { margin: 0 0 3mm 0; font-size: 11pt; color: var(--ink); }
    table.kv { width: 100%; border-collapse: collapse; }
    table.kv td { padding: 2.5mm 3mm; border-bottom: 1px solid var(--border); font-size: 10pt; }
    table.kv tr:last-child td { border-bottom: none; }
    table.kv td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .cols { column-count: 2; column-gap: 8mm; }
    .cols .card { break-inside: avoid; -webkit-column-break-inside: avoid; }
    footer.stamp { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid var(--border); color: var(--muted); font-size: 8.5pt; display: flex; justify-content: space-between; }
    footer.stamp .disclaimer { max-width: 60%; }
  </style>
</head>
<body>
  <header class="cover">
    <h1>${escapeHtml(project.name)}</h1>
    <p class="meta">Plan financier prévisionnel — moyennes mensuelles</p>
    <div class="grid">
      <div class="meta">
        <div>Organisation&nbsp;: <strong>${escapeHtml(org.name)}</strong></div>
        <div>Pays&nbsp;: <strong>${escapeHtml(org.pays)}</strong></div>
        <div>Devise&nbsp;: <strong>${escapeHtml(currency)}</strong></div>
      </div>
      <div class="meta">
        <div>Template&nbsp;: <strong>${escapeHtml(template.slug)}</strong> v${escapeHtml(template.version)}</div>
        <div>Créé le&nbsp;: <strong>${escapeHtml(formatDate(project.createdAt))}</strong></div>
        <div>Généré le&nbsp;: <strong>${escapeHtml(formatDate(generatedAt))}</strong></div>
      </div>
    </div>
  </header>

  <h2>Hypothèses</h2>
  <div class="cols">${driverBlocks}</div>

  <h2>Résultats</h2>
  <div class="cols">${resultBlocks}</div>

  <footer class="stamp">
    <div class="disclaimer">
      Document généré par Lalanda. Les valeurs sont indicatives et n'engagent que leur émetteur. Le
      moteur de calcul reste la seule source de vérité.
    </div>
    <div>${escapeHtml(new Date(generatedAt).toISOString())}</div>
  </footer>
</body>
</html>`;
}

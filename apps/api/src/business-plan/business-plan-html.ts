// Rendu HTML du business plan pour le PDF (ADR-0037 § 7).
//
// Mise en forme seulement : les textes viennent du document, les tableaux de
// `business-plan-assembly.ts` (lignes du moteur inchangées). Même confinement que
// le dossier financier : CSP `default-src 'none'`, aucune ressource externe,
// polices intégrées en `data:` (Inter, `invoice-fonts.ts`), logo en `data:`.

import {
  LOGO_LIGHT_DATA_URI,
  LOGO_LIGHT_SIZE,
  LOGO_WATERMARK_DATA_URI,
  LOGO_WATERMARK_SIZE,
} from '../reports/assets/brand.js';
import { WATERMARK_TEXT } from '../reports/report-html.js';
import { fontFacesCss, fontStack } from '../sales/documents/templates/invoice-fonts.js';
import {
  MENTION_TABLEAUX,
  SECTION_VIDE,
  TITRE_HYPOTHESES,
  planLabel,
  type AssembledSection,
  type AssembledTable,
  type PlanSource,
} from './business-plan-assembly.js';

export interface BusinessPlanHtmlData {
  projectName: string;
  pays: string;
  sections: AssembledSection[];
  source: PlanSource;
  /** Version validée du document, ou `null` pour un brouillon. */
  document: { version: number; approvedAt: string; contentSha256: string } | null;
  /** ISO-8601. */
  generatedAt: string;
  watermark: boolean;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** Paragraphes : une ligne vide sépare deux paragraphes, un saut simple reste un saut. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p>${escapeHtml(p).replaceAll('\n', '<br />')}</p>`)
    .join('');
}

const STATUT_COULEUR = { vert: '#16a34a', orange: '#ea580c', rouge: '#dc2626' } as const;

function renderTable(t: AssembledTable): string {
  const rows = t.rows
    .map((r) => {
      const dot = r.seuil
        ? `<span class="dot" style="background:${STATUT_COULEUR[r.seuil.statut]}"></span>`
        : '';
      const seuil = r.seuil ? `<div class="seuil">${escapeHtml(r.seuil.display)}</div>` : '';
      return `<tr><td>${dot}${escapeHtml(r.label)}${seuil}</td><td class="num">${escapeHtml(r.display)}</td></tr>`;
    })
    .join('');
  return `<div class="table-block"><h3>${escapeHtml(t.title)}</h3><table><tbody>${rows}</tbody></table></div>`;
}

function renderSection(s: AssembledSection, n: number): string {
  const body = s.empty
    ? `<p class="empty">${SECTION_VIDE}</p>`
    : `${paragraphs(s.text)}${s.originNote ? `<p class="origin">${escapeHtml(s.originNote)}</p>` : ''}`;
  const hyp =
    s.hypotheses && s.hypotheses.length > 0
      ? `<div class="table-block"><h3>${TITRE_HYPOTHESES}</h3><table><tbody>${s.hypotheses
          .map(
            (h) =>
              `<tr><td>${escapeHtml(h.label)}</td><td class="num">${escapeHtml(h.display)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '';
  const tables =
    s.tables.length > 0
      ? `<p class="note">${MENTION_TABLEAUX}</p>${s.tables.map(renderTable).join('')}`
      : '';
  return `<section class="section"><h2>${n}. ${escapeHtml(s.title)}</h2>${body}${hyp}${tables}</section>`;
}

export function renderBusinessPlanHtml(data: BusinessPlanHtmlData): string {
  const { source, document } = data;
  const statut = document
    ? `Business plan validé v${document.version} du ${formatDate(document.approvedAt)}`
    : 'BROUILLON — business plan non validé';
  const plan = planLabel(source);
  const empreinte = source.fingerprint
    ? `Empreinte SHA-256 du plan : ${source.fingerprint}`
    : 'Aucune version figée du plan n’est rattachée.';
  const toc = data.sections.map((s, i) => `<li>${i + 1}. ${escapeHtml(s.title)}</li>`).join('');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
  <title>${escapeHtml(data.projectName)} — Business plan</title>
  <style>
    ${fontFacesCss(['inter'])}
    :root { --ink: #0f172a; --muted: #64748b; --border: #e2e8f0; --accent: #0e7c66; --surface: #f8fafc; }
    @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: var(--ink); font-family: ${fontStack('inter')}; font-size: 10.5pt; line-height: 1.5; }
    .cover { break-after: page; min-height: 250mm; display: flex; flex-direction: column; justify-content: center; }
    .cover img.logo { align-self: flex-start; width: 62mm; height: auto; margin-bottom: 6mm; }
    .cover .kicker { color: var(--muted); font-style: italic; margin: 0 0 4mm 0; }
    .cover h1 { font-size: 22pt; margin: 0 0 8mm 0; }
    .badge { align-self: flex-start; padding: 2mm 4mm; border-radius: 2mm; font-weight: 700; margin-bottom: 6mm; }
    .badge.ok { color: var(--accent); border: 2px solid var(--accent); background: #ecfdf5; }
    .badge.draft { color: #b45309; border: 2px dashed #d97706; background: #fffbeb; }
    .meta { color: var(--muted); font-size: 9.5pt; }
    .meta strong { color: var(--ink); }
    .fingerprint { font-size: 8pt; color: var(--muted); word-break: break-all; }
    .toc { break-after: page; }
    .toc h2 { color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 2mm; }
    .toc ol { list-style: none; padding: 0; }
    .toc li { padding: 2mm 0; border-bottom: 1px dotted var(--border); }
    .section { break-before: page; }
    .section h2 { color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 2mm; font-size: 15pt; }
    .section p { margin: 0 0 3mm 0; text-align: justify; }
    .empty { color: var(--muted); font-style: italic; }
    .origin { color: var(--muted); font-size: 8.5pt; font-style: italic; }
    .note { color: var(--muted); font-size: 8.5pt; background: var(--surface); padding: 2mm 3mm; border-radius: 2mm; }
    .table-block { break-inside: avoid; margin: 4mm 0; }
    .table-block h3 { font-size: 10.5pt; margin: 0 0 2mm 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1.8mm 3mm; border-bottom: 1px solid var(--border); font-size: 9.5pt; vertical-align: top; }
    td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
    .seuil { font-size: 8pt; color: var(--muted); }
    .watermark { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 2.5mm; font-size: 7.5pt; color: #94a3b8; }
    .watermark img { width: 22mm; height: auto; }
    footer { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid var(--border); color: var(--muted); font-size: 8pt; }
  </style>
</head>
<body>
  ${
    data.watermark
      ? `<div class="watermark"><img src="${LOGO_WATERMARK_DATA_URI}" width="${LOGO_WATERMARK_SIZE.width}" height="${LOGO_WATERMARK_SIZE.height}" alt="" />${escapeHtml(WATERMARK_TEXT)}</div>`
      : ''
  }
  <section class="cover">
    <img class="logo" src="${LOGO_LIGHT_DATA_URI}" width="${LOGO_LIGHT_SIZE.width}" height="${LOGO_LIGHT_SIZE.height}" alt="Lalanda" />
    <p class="kicker">Business plan</p>
    <h1>${escapeHtml(data.projectName)}</h1>
    <div class="badge ${document ? 'ok' : 'draft'}">${escapeHtml(statut)}</div>
    <p class="meta"><strong>${escapeHtml(plan)}</strong></p>
    <p class="fingerprint">${escapeHtml(empreinte)}</p>
    <p class="meta">Pays : <strong>${escapeHtml(data.pays)}</strong> · Devise : <strong>${escapeHtml(source.currency)}</strong> · Généré le <strong>${escapeHtml(formatDate(data.generatedAt))}</strong></p>
    ${source.error ? `<p class="meta">Tableaux indisponibles : ${escapeHtml(source.error)}</p>` : ''}
  </section>
  <section class="toc"><h2>Sommaire</h2><ol>${toc}</ol></section>
  ${data.sections.map((s, i) => renderSection(s, i + 1)).join('')}
  <footer>
    ${escapeHtml(statut)} — ${escapeHtml(plan)}. ${escapeHtml(empreinte)}${
      document ? ` — Empreinte du document : ${escapeHtml(document.contentSha256)}` : ''
    }.
    Les textes sont ceux de l'entrepreneur ; les tableaux et chiffres du plan financier sont calculés par le moteur de Lalanda et n'ont pas été modifiés. Les hypothèses sont des choix de l'entrepreneur, les projections ne sont pas des résultats réalisés. Ne remplace pas l'avis d'un expert-comptable agréé.
  </footer>
</body>
</html>`;
}

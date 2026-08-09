// Rendu HTML d'un rapport de plan financier (S8-lite → S13e bancable).
//
// Contient uniquement de la mise en forme : les valeurs proviennent du moteur
// (packages/engine). Aucun calcul ici (brief §3-1, CLAUDE.md).
// Le template est un string ES6 — pas de framework de templating, pas d'injection
// côté serveur, on échappe explicitement les valeurs qui viennent du user.
//
// Structure S13e (dossier bancable RDC — Rawbank/BCDC/TMB/PADMPME) :
//   Page 1  — Page de garde
//   Page 2  — Sommaire
//   Sect. 1 — Hypothèses du plan          (drivers du template, groupés)
//   Sect. 2 — Compte d'exploitation mensuel (feuille `activite`)
//   Sect. 3 — Plan de financement initial   (feuille `plan_financement`)
//   Sect. 4 — Plan de trésorerie année 1    (feuille `tresorerie`, vue simplifiée)
//   Sect. 5 — Projection sur 5 exercices     (feuille `projection`)
//   Sect. 6 — Financement de l'emprunt      (feuille `financement`)
//   Sect. 7 — Bilan prévisionnel            (feuille `bilan`, S18a)
//             ⚠ la trésorerie du bilan (sect. 7) et celle de la sect. 4 ne
//             coïncident qu'à l'ouverture : la sect. 4 ignore la variation de
//             BFR et les intérêts. Note de rapprochement rendue sous le bilan.
//   Sect. 8 — Capacité d'autofinancement    (feuille `caf`, S18a)
//   Sect. 9 — Seuil de rentabilité          (feuille `seuil_rentabilite`, S18a)
//   Sect. 10 — Amortissements               (feuille `amortissements`)
//   Sect. 11 — Ratios bancaires             (feuille `ratios`, pastilles feux)
//   Fin     — Avertissement légal du ParameterPack (si présent)

import type { Template } from '@lalanda/engine';

export interface ReportOrg {
  name: string;
  pays: string;
}

export interface ReportProject {
  name: string;
  templateSlug: string;
  pays: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportLine {
  sheetId: string;
  lineId: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  seuil?: {
    valeur: number;
    direction: 'min' | 'max';
    statut: 'vert' | 'orange' | 'rouge';
  };
}

/** Métadonnées légères du pack — juste ce qui est imprimé dans la page de garde. */
export interface ReportParameterPack {
  slug: string;
  label: string;
  annee: number;
  systeme_comptable: string;
  avertissement?: string;
}

export interface ReportData {
  organization: ReportOrg;
  project: ReportProject;
  template: Template;
  parameterPack?: ReportParameterPack;
  driverValues: Record<string, number>;
  lines: ReportLine[];
  /** ISO-8601. */
  generatedAt: string;
  /** Devise d'affichage — reprise du pack/template/USD. */
  currency: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
  /**
   * (S16c) Présent si l'export repart d'un plan validé figé (?planVersion=N) :
   * le PDF affiche « Plan validé v{N} du {date} ». Absent → mention
   * « BROUILLON — non validé » (les chiffres peuvent encore changer).
   */
  plan?: {
    version: number;
    /** ISO-8601 — date de validation. */
    approvedAt: string;
  };
  /**
   * (S16b) Filigrane « offre gratuite » — décidé côté API selon l'entitlement
   * `pdfWatermark` du plan de l'organisation. Absent/false = pas de filigrane.
   */
  watermark?: boolean;
}

/** Texte du filigrane — aligné sur la promesse de la page /pricing. */
export const WATERMARK_TEXT = 'Généré avec Lalanda — offre gratuite';

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

// Ordre canonique des sections bancables (brief S13e). Les feuilles absentes du template
// sont silencieusement ignorées — on ne montre pas de section vide.
interface SectionSpec {
  n: number;
  sheetId: string;
  title: string;
}
/**
 * Notes de rapprochement affichées sous une section.
 *
 * (S18a) Le plan de trésorerie mensuel et le bilan prévisionnel donnent DEUX
 * trésoreries différentes pour le même exercice : la vue mensuelle est un modèle
 * simplifié année 1 qui ignore la variation de BFR et les intérêts d'emprunt.
 * Avec un délai clients de 60 jours l'écart se chiffre en dizaines de milliers.
 * Un lecteur qui compare les deux chiffres dans le même dossier doit trouver
 * l'explication à côté des chiffres, pas dans la documentation interne.
 */
const SECTION_NOTES: Record<string, string> = {
  tresorerie:
    'Vue simplifiée : ce plan mensuel projette un solde constant sur 12 mois et ' +
    'ignore la variation du besoin en fonds de roulement ainsi que les intérêts ' +
    'd’emprunt. Il ne coïncide donc avec la trésorerie du bilan prévisionnel qu’à ' +
    'l’ouverture. La trésorerie de clôture faisant foi est celle du bilan.',
  bilan:
    'Rapprochement avec la section « Plan de trésorerie » : la trésorerie du bilan ' +
    'est le déroulé complet du tableau de flux (capacité d’autofinancement, moins ' +
    'la variation du besoin en fonds de roulement, moins le remboursement du ' +
    'capital). Le plan mensuel, plus simple, ignore les deux derniers termes — les ' +
    'deux vues ne se rejoignent qu’à l’ouverture. C’est le bilan qui fait foi.',
};

const BANCABLE_SECTIONS: readonly SectionSpec[] = [
  { n: 2, sheetId: 'activite', title: "Compte d'exploitation mensuel" },
  { n: 3, sheetId: 'plan_financement', title: 'Plan de financement initial' },
  {
    n: 4,
    sheetId: 'tresorerie',
    title: 'Plan de trésorerie année 1 — vue simplifiée (hors variation de BFR et hors intérêts)',
  },
  { n: 5, sheetId: 'projection', title: 'Projection sur 5 exercices' },
  { n: 6, sheetId: 'financement', title: "Financement de l'emprunt" },
  // (S18a, FIN-001) États financiers prévisionnels. Feuilles absentes = sections omises.
  { n: 7, sheetId: 'bilan', title: 'Bilan prévisionnel' },
  { n: 8, sheetId: 'caf', title: "Capacité d'autofinancement" },
  { n: 9, sheetId: 'seuil_rentabilite', title: 'Seuil de rentabilité et point mort' },
  { n: 10, sheetId: 'amortissements', title: 'Amortissements' },
  { n: 11, sheetId: 'ratios', title: 'Ratios bancaires' },
] as const;

/**
 * Rend le HTML complet du rapport. À passer à `page.setContent(...)` de Puppeteer.
 * Le CSS est inline pour n'avoir aucune dépendance réseau au rendu.
 */
export function renderReportHtml(data: ReportData): string {
  const {
    organization: org,
    project,
    template,
    parameterPack,
    driverValues,
    lines,
    generatedAt,
    currency,
    plan,
    watermark,
  } = data;

  // (S16c) Badge de statut : plan validé figé vs brouillon recalculable.
  const statusBadge = plan
    ? `<div class="status-badge validated">Plan validé v${plan.version} du ${escapeHtml(formatDate(plan.approvedAt))}</div>`
    : `<div class="status-badge draft">BROUILLON — non validé</div>`;
  const statusFooter = plan
    ? `Plan validé v${plan.version} du ${escapeHtml(formatDate(plan.approvedAt))} — chiffres figés, jamais recalculés.`
    : `BROUILLON — non validé : les chiffres peuvent changer à chaque recalcul.`;

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

  // Feux tricolores (S10) — palette conforme à l'UI.
  const statutColor: Record<'vert' | 'orange' | 'rouge', string> = {
    vert: '#16a34a',
    orange: '#ea580c',
    rouge: '#dc2626',
  };
  const statutLabel: Record<'vert' | 'orange' | 'rouge', string> = {
    vert: 'OK',
    orange: 'Vigilance',
    rouge: 'Critique',
  };

  // Section 1 — Hypothèses (drivers par groupe, colonnes de cartes).
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

  /** Rend une ligne standard (non-ratios). Applique un surlignage rouge si `highlightRedIds` contient le lineId ET valeur < 0. */
  function renderLineRow(l: ReportLine, highlightRedIds: ReadonlySet<string>): string {
    const isCritical = highlightRedIds.has(l.lineId) && Number.isFinite(l.value) && l.value < 0;
    const rowStyle = isCritical ? ' class="critical"' : '';
    const valStyle = isCritical ? ' num critical-val' : ' num';
    return `<tr${rowStyle}>
      <td>${escapeHtml(l.label)}</td>
      <td class="${valStyle}">${escapeHtml(formatValue(l.value, l.format, currency))}</td>
    </tr>`;
  }

  /** Rend une feuille "ratios" avec pastilles feux + note de seuil. */
  function renderRatiosBody(sheetLines: ReportLine[]): string {
    const rows = sheetLines
      .map((l) => {
        const dot = l.seuil
          ? `<span class="dot" style="background:${statutColor[l.seuil.statut]};"></span>`
          : '';
        const seuilNote = l.seuil
          ? `<div class="seuil-note" style="color:${statutColor[l.seuil.statut]};">${escapeHtml(statutLabel[l.seuil.statut])} — seuil ${l.seuil.direction === 'min' ? '≥' : '≤'} ${escapeHtml(formatValue(l.seuil.valeur, l.format, currency))}</div>`
          : '';
        return `<tr>
          <td>${dot}${escapeHtml(l.label)}${seuilNote}</td>
          <td class="num">${escapeHtml(formatValue(l.value, l.format, currency))}</td>
        </tr>`;
      })
      .join('');
    return `<table class="kv">
      <tbody>${rows}</tbody>
    </table>`;
  }

  /** Rend une feuille standard (activite, plan_financement, tresorerie, projection, financement). */
  function renderStandardSheet(
    sheetLines: ReportLine[],
    highlightRedIds: ReadonlySet<string>,
  ): string {
    const rows = sheetLines.map((l) => renderLineRow(l, highlightRedIds)).join('');
    return `<table class="kv">
      <tbody>${rows}</tbody>
    </table>`;
  }

  // IDs à mettre en avant en rouge si négatifs (brief S13e).
  const PF_RED = new Set<string>(['pf_ecart']);
  const TRESO_RED = new Set<string>(['tresorerie_min_annee_1']);
  const EMPTY_RED = new Set<string>();

  // Rendu des sections bancables. Filtre celles dont la feuille n'a pas de lignes.
  const bancableSections = BANCABLE_SECTIONS.filter(
    (s) => (linesBySheet.get(s.sheetId) ?? []).length > 0,
  );

  const sectionBlocks = bancableSections
    .map((spec) => {
      const sheetLines = linesBySheet.get(spec.sheetId) ?? [];
      let body: string;
      let legend = '';
      if (spec.sheetId === 'ratios') {
        legend = `<p class="legend">
          <span class="dot" style="background:${statutColor.vert};"></span> vert : OK
          &nbsp;&nbsp;
          <span class="dot" style="background:${statutColor.orange};"></span> orange : vigilance
          &nbsp;&nbsp;
          <span class="dot" style="background:${statutColor.rouge};"></span> rouge : critique
        </p>`;
        body = renderRatiosBody(sheetLines);
      } else if (spec.sheetId === 'plan_financement') {
        body = renderStandardSheet(sheetLines, PF_RED);
      } else if (spec.sheetId === 'tresorerie') {
        body = renderStandardSheet(sheetLines, TRESO_RED);
      } else {
        body = renderStandardSheet(sheetLines, EMPTY_RED);
      }
      return `<section class="section">
        <h2 class="section-title">Section ${spec.n} — ${escapeHtml(spec.title)}</h2>
        ${legend}
        ${body}
        ${SECTION_NOTES[spec.sheetId] ? `<p class="legend">${SECTION_NOTES[spec.sheetId]}</p>` : ''}
      </section>`;
    })
    .join('');

  // Sommaire : puces (pas de vraie numérotation de page — Puppeteer + HTML rend
  // ça compliqué, on assume et on garde des puces claires).
  const tocItems = [
    `<li>Section 1 — Hypothèses du plan</li>`,
    ...bancableSections.map((s) => `<li>Section ${s.n} — ${escapeHtml(s.title)}</li>`),
  ].join('');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <!-- (S22e) Troisième barrière, à l'intérieur du document lui-même : même si le
       renderer était un jour relancé sans le confinement de reports.service.ts,
       cette CSP interdit tout script et toute ressource hors styles inline. Le
       rapport n'utilise que du CSS inline (voir le <style> ci-dessous). -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
  <title>${escapeHtml(project.name)} — Plan financier</title>
  <style>
    /* Palette identique à l'accent Lalanda (SYSCOHADA vert) — cohérence UI/PDF. */
    :root {
      --ink: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --accent: #0e7c66;
      --surface: #f8fafc;
      --critical: #dc2626;
    }
    /* Marges A4 gérées par @page — le body n'a plus de padding. */
    @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
    * { box-sizing: border-box; }
    html, body { padding: 0; margin: 0; color: var(--ink); font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; line-height: 1.4; }

    /* ---- Page de garde (page 1) ---- */
    .cover-page { break-after: page; page-break-after: always; min-height: 250mm; display: flex; flex-direction: column; justify-content: center; }
    .cover-page .brand { font-size: 48pt; font-weight: 700; color: var(--accent); letter-spacing: -1.5px; margin: 0 0 4mm 0; }
    .cover-page .project-name { font-size: 20pt; color: var(--ink); margin: 0 0 12mm 0; font-weight: 600; }
    .cover-page .accent-rule { height: 3px; background: var(--accent); width: 40mm; margin-bottom: 10mm; }
    .cover-page .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; margin-top: 8mm; }
    .cover-page .meta-item { color: var(--muted); font-size: 10pt; }
    .cover-page .meta-item strong { color: var(--ink); display: block; margin-top: 1mm; font-size: 11pt; }
    .cover-page .tagline { color: var(--muted); font-size: 11pt; margin: 0 0 15mm 0; font-style: italic; }

    /* ---- Badge statut du plan (S16c) ---- */
    .status-badge { display: inline-block; align-self: flex-start; padding: 2mm 4mm; border-radius: 2mm; font-size: 10.5pt; font-weight: 700; letter-spacing: 0.3px; margin-bottom: 8mm; }
    .status-badge.validated { color: var(--accent); border: 2px solid var(--accent); background: #ecfdf5; }
    .status-badge.draft { color: #b45309; border: 2px dashed #d97706; background: #fffbeb; }

    /* ---- Sommaire (page 2) ---- */
    .toc-page { break-after: page; page-break-after: always; }
    .toc-page h2 { margin: 0 0 8mm 0; font-size: 18pt; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 3mm; }
    .toc-page ol.toc { list-style: none; padding: 0; margin: 0; }
    .toc-page ol.toc li { padding: 3mm 0; border-bottom: 1px dotted var(--border); font-size: 12pt; }
    .toc-page ol.toc li::before { content: "▸ "; color: var(--accent); font-weight: 700; }

    /* ---- Sections numérotées (chacune démarre sur une nouvelle page) ---- */
    .section { break-before: page; page-break-before: always; }
    .section:first-of-type { /* Section 1 vient juste après le TOC : break-before naturel */ }
    .section-title { margin: 0 0 6mm 0; font-size: 16pt; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 2mm; }
    .legend { margin: 0 0 5mm 0; font-size: 9.5pt; color: var(--muted); background: var(--surface); padding: 2.5mm 3mm; border-radius: 2mm; }

    /* ---- Cartes et tableaux ---- */
    .card { break-inside: avoid; margin-bottom: 6mm; }
    .card h3 { margin: 0 0 3mm 0; font-size: 11pt; color: var(--ink); }
    table.kv { width: 100%; border-collapse: collapse; }
    table.kv td { padding: 2.5mm 3mm; border-bottom: 1px solid var(--border); font-size: 10pt; vertical-align: top; }
    table.kv tr:last-child td { border-bottom: none; }
    table.kv td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    table.kv tr.critical td { background: #fef2f2; }
    table.kv td.critical-val { color: var(--critical); }
    .cols { column-count: 2; column-gap: 8mm; }
    .cols .card { break-inside: avoid; -webkit-column-break-inside: avoid; }

    /* ---- Pastilles feux (ratios) ---- */
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .seuil-note { font-size: 8pt; margin-top: 1mm; }

    /* ---- Filigrane offre gratuite (S16b) ---- */
    /* position:fixed en contexte print Chromium : répété sur chaque page, en bas du
       bloc de contenu. Discret : petit corps, gris clair, centré — n'obstrue pas les
       chiffres. NB vérifié empiriquement : un bottom négatif (dans la marge @page)
       est replié en haut de page par Chromium — rester à 0. */
    .watermark { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 7.5pt; color: #94a3b8; letter-spacing: 0.4px; }

    /* ---- Avertissement légal ---- */
    .disclaimer-box { margin-top: 8mm; background: #fef9e7; border: 1px solid #f0c95a; padding: 4mm; break-inside: avoid; }
    .disclaimer-box h3 { color: #8a6d00; margin: 0 0 2mm 0; font-size: 11pt; }
    .disclaimer-box p { margin: 0; font-size: 9pt; }
    footer.stamp { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid var(--border); color: var(--muted); font-size: 8.5pt; display: flex; justify-content: space-between; }
    footer.stamp .disclaimer { max-width: 60%; }
  </style>
</head>
<body>
  ${watermark ? `<div class="watermark">${escapeHtml(WATERMARK_TEXT)}</div>` : ''}
  <!-- Page 1 : garde -->
  <section class="cover-page">
    <div class="accent-rule"></div>
    <h1 class="brand">LALANDA</h1>
    <p class="tagline">Plan financier prévisionnel bancable</p>
    <h2 class="project-name">${escapeHtml(project.name)}</h2>
    ${statusBadge}
    <div class="meta-grid">
      <div class="meta-item">Organisation<strong>${escapeHtml(org.name)}</strong></div>
      <div class="meta-item">Pays du projet<strong>${escapeHtml(project.pays)}</strong></div>
      <div class="meta-item">Cadre fiscal<strong>${parameterPack ? escapeHtml(parameterPack.label) : '—'}</strong></div>
      <div class="meta-item">Système comptable<strong>${parameterPack ? escapeHtml(parameterPack.systeme_comptable) : '—'}</strong></div>
      <div class="meta-item">Devise d'affichage<strong>${escapeHtml(currency)}</strong></div>
      <div class="meta-item">Template<strong>${escapeHtml(template.slug)} v${escapeHtml(template.version)}</strong></div>
      <div class="meta-item">Créé le<strong>${escapeHtml(formatDate(project.createdAt))}</strong></div>
      <div class="meta-item">Généré le<strong>${escapeHtml(formatDate(generatedAt))}</strong></div>
    </div>
  </section>

  <!-- Page 2 : sommaire -->
  <section class="toc-page">
    <h2>Sommaire</h2>
    <ol class="toc">${tocItems}</ol>
  </section>

  <!-- Section 1 : Hypothèses -->
  <section class="section">
    <h2 class="section-title">Section 1 — Hypothèses du plan</h2>
    <div class="cols">${driverBlocks}</div>
  </section>

  <!-- Sections 2 à 7 : feuilles bancables -->
  ${sectionBlocks}

  ${
    parameterPack?.avertissement
      ? `<section class="disclaimer-box">
    <h3>⚠ Avertissement — cadre fiscal ${escapeHtml(parameterPack.label)}</h3>
    <p>${escapeHtml(parameterPack.avertissement)}</p>
  </section>`
      : ''
  }

  <footer class="stamp">
    <div class="disclaimer">
      ${statusFooter}
      Document généré par Lalanda. Les valeurs sont indicatives et n'engagent que leur émetteur. Le
      moteur de calcul reste la seule source de vérité. Ne remplace pas l'avis d'un expert-comptable
      agréé pour un dépôt bancaire officiel.
    </div>
    <div>${escapeHtml(new Date(generatedAt).toISOString())}</div>
  </footer>
</body>
</html>`;
}

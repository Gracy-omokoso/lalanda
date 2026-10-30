// Logique pure de l'écran des rapports du CRM — ADR-0040 § 7.2, § 8.2 (lot C6).
//
// Isolée du rendu pour être testée sans DOM. AUCUN CALCUL DE CHIFFRE : taux,
// durées, totaux, montants et prévisions viennent de l'API (moteur
// `crmReports`). Ce module ne fait que mettre en forme et, pour les barres,
// convertir une valeur DÉJÀ servie en largeur visuelle (0 à 100) — la valeur
// affichée en texte reste celle de l'API. Montants par devise, jamais
// additionnés entre devises ni convertis, toujours étiquetés « estimé ».

import type {
  CrmReportCurrencyTotal,
  CrmReportDuration,
  CrmReportOwner,
  CrmReportRate,
  CrmReportsRequest,
  CrmReportsView,
} from '@/lib/api-crm-reports';

import { formatMontant, formatTaux } from '../../../ventes/_components/sales-model';
import type { MembreCrm } from '../../_components/crm-access';

// ── Période ─────────────────────────────────────────────────────────────────

/** Périodes proposées (mois glissants) ; 12 par défaut, 24 au plus (décision n° 12). */
export const PERIODES_MOIS = [3, 6, 12, 24] as const;
export type PeriodeMois = (typeof PERIODES_MOIS)[number];
export const PERIODE_PAR_DEFAUT: PeriodeMois = 12;

export function libellePeriode(mois: PeriodeMois): string {
  return `${mois} derniers mois`;
}

/** Lit une période choisie ; toute valeur hors liste revient au défaut (12 mois). */
export function periodeDepuis(valeur: string): PeriodeMois {
  const n = Number(valeur);
  return (PERIODES_MOIS as readonly number[]).includes(n) ? (n as PeriodeMois) : PERIODE_PAR_DEFAUT;
}

function ajouterMois(jour: string, delta: number): string {
  const [y, m, d] = jour.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + delta;
  const annee = Math.floor(index / 12);
  const mois = index - annee * 12;
  const dernier = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, mois, Math.min(d, dernier))).toISOString().slice(0, 10);
}

function ajouterJours(jour: string, n: number): string {
  const [y, m, d] = jour.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Bornes de la période envoyées à l'API. Les 12 mois par défaut n'envoient
 * rien (l'API applique sa période par défaut) ; les autres choix donnent
 * `[aujourd'hui − N mois + 1 jour, aujourd'hui]` en jours de Kinshasa, la même
 * convention que la période par défaut du moteur. L'API reste juge
 * (`400 CRM_REPORT_PERIOD_TOO_LONG` au-delà de 24 mois).
 */
export function bornesPeriode(
  mois: PeriodeMois,
  aujourdhui: string,
): Pick<CrmReportsRequest, 'from' | 'to'> {
  if (mois === PERIODE_PAR_DEFAUT) return {};
  return { from: ajouterJours(ajouterMois(aujourdhui, -mois), 1), to: aujourdhui };
}

// ── Responsable ─────────────────────────────────────────────────────────────

/** `''` : toute l'organisation ; `me` : les miennes ; sinon l'identifiant d'un membre. */
export type FiltreResponsableRapport = string;

export function requeteRapports(
  mois: PeriodeMois,
  responsable: FiltreResponsableRapport,
  aujourdhui: string,
): CrmReportsRequest {
  return {
    ...bornesPeriode(mois, aujourdhui),
    ...(responsable === '' ? {} : { ownerId: responsable }),
  };
}

/** Nom affiché d'un responsable des rapports (nom joint par l'API d'abord). */
export function nomResponsable(
  o: Pick<CrmReportOwner, 'ownerId' | 'ownerName' | 'isMember'>,
  membres: readonly MembreCrm[] = [],
): string {
  if (o.ownerId === null) return 'Sans responsable';
  if (o.ownerName) return o.isMember ? o.ownerName : `${o.ownerName} (ancien membre)`;
  if (!o.isMember) return 'Ancien membre (à réassigner)';
  return membres.find((m) => m.userId === o.ownerId)?.name ?? 'Un membre';
}

// ── Mise en forme ───────────────────────────────────────────────────────────

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function libelleNombreOpp(n: number): string {
  return pluriel(n, 'opportunité');
}

/** « 1 500,00 USD (estimé) » par devise ; jamais de somme entre devises. */
export function montantsEstimes(amounts: readonly CrmReportCurrencyTotal[]): string[] {
  return amounts.map((a) => `${formatMontant(a.total, a.currency)} (estimé)`);
}

/** Phrase d'un échantillon insuffisant — jamais « 0 % ». */
export function phraseEchantillon(sample: number, requis: number, quoi: string): string {
  return `Pas assez ${quoi} (${sample} sur ${requis})`;
}

export interface TexteTaux {
  disponible: boolean;
  /** Valeur principale : « 42 % » ou « Indisponible ». */
  valeur: string;
  /** Détail : base du taux, ou échantillon et minimum requis. */
  detail: string;
}

/**
 * Libellé d'un taux. `unavailable` donne l'échantillon et le minimum requis,
 * jamais 0 %. `quoi` complète « Pas assez … » (ADR-0040 § 8.2).
 */
export function texteTaux(
  r: CrmReportRate,
  quoi = 'd’opportunités clôturées',
  base = 'clôturées',
): TexteTaux {
  if (r.status === 'available') {
    return {
      disponible: true,
      valeur: formatTaux(r.ratePercent) ?? r.ratePercent,
      detail: `${r.count} sur ${r.sample} ${base}`,
    };
  }
  return {
    disponible: false,
    valeur: 'Indisponible',
    detail: phraseEchantillon(r.sample, r.requiredSample, quoi),
  };
}

export interface TexteDuree {
  disponible: boolean;
  valeur: string;
  detail: string;
}

export function texteDuree(d: CrmReportDuration, quoi: string): TexteDuree {
  if (d.status === 'available') {
    return {
      disponible: true,
      valeur: pluriel(d.meanDays, 'jour'),
      detail: `Médiane : ${pluriel(d.medianDays, 'jour')} · ${d.sample} ${quoi}`,
    };
  }
  return {
    disponible: false,
    valeur: 'Indisponible',
    detail: phraseEchantillon(d.sample, d.requiredSample, `d’opportunités ${quoi}`),
  };
}

/** Largeur visuelle (0 à 100) d'une valeur servie par l'API, rapportée au maximum affiché. */
export function largeur(valeur: number, maximum: number): number {
  if (!Number.isFinite(valeur) || !Number.isFinite(maximum) || maximum <= 0 || valeur <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((valeur / maximum) * 1000) / 10);
}

function libelleEtape(view: Pick<CrmReportsView, 'stages'>, key: string | null): string {
  if (key === null) return 'Gagnée';
  return view.stages.find((s) => s.key === key)?.label ?? key;
}

// ── Entonnoir ───────────────────────────────────────────────────────────────

export interface LigneEntonnoir {
  stageKey: string;
  etape: string;
  nombre: number;
  texteNombre: string;
  montants: string[];
  largeur: number;
}

export function lignesEntonnoir(view: Pick<CrmReportsView, 'stages' | 'funnel'>): LigneEntonnoir[] {
  const max = Math.max(view.funnel.created, ...view.funnel.stages.map((s) => s.count));
  return view.funnel.stages.map((s) => ({
    stageKey: s.stageKey,
    etape: libelleEtape(view, s.stageKey),
    nombre: s.count,
    texteNombre: libelleNombreOpp(s.count),
    montants: montantsEstimes(s.amounts),
    largeur: largeur(s.count, max),
  }));
}

// ── Conversion ──────────────────────────────────────────────────────────────

export interface LigneConversion {
  de: string;
  vers: string;
  taux: TexteTaux;
  largeur: number;
}

export function lignesConversion(
  view: Pick<CrmReportsView, 'stages' | 'conversion'>,
): LigneConversion[] {
  return view.conversion.stages.map((c) => ({
    de: libelleEtape(view, c.fromStageKey),
    vers: libelleEtape(view, c.toStageKey),
    taux: texteTaux(c.rate, 'd’opportunités passées par cette étape', 'passées par l’étape'),
    largeur: c.rate.status === 'available' ? largeur(Number(c.rate.ratePercent), 100) : 0,
  }));
}

// ── Résultats par responsable ───────────────────────────────────────────────

export interface LigneResponsable {
  cle: string;
  nom: string;
  ouvertes: { nombre: string; montants: string[] };
  gagnees: { nombre: string; montants: string[] };
  perdues: { nombre: string; montants: string[] };
  tauxGain: TexteTaux;
  prevision: string[];
  motifs: string[];
}

export function lignesResponsables(
  view: Pick<CrmReportsView, 'byOwner'>,
  membres: readonly MembreCrm[] = [],
): LigneResponsable[] {
  return view.byOwner.map((o) => ({
    cle: o.ownerId ?? 'sans-responsable',
    nom: nomResponsable(o, membres),
    ouvertes: { nombre: libelleNombreOpp(o.open.count), montants: montantsEstimes(o.open.amounts) },
    gagnees: { nombre: libelleNombreOpp(o.won.count), montants: montantsEstimes(o.won.amounts) },
    perdues: { nombre: libelleNombreOpp(o.lost.count), montants: montantsEstimes(o.lost.amounts) },
    tauxGain: texteTaux(o.winRate),
    prevision: o.forecast.map((f) => `${formatMontant(f.weighted, f.currency)} pondéré (estimé)`),
    motifs: o.topLostReasons.map((r) => `${libelleMotifRapport(r)} (${r.count})`),
  }));
}

export function libelleMotifRapport(r: {
  lostReasonKey: string | null;
  label?: string | null;
}): string {
  if (r.lostReasonKey === null) return 'Sans motif';
  return r.label ?? `${r.lostReasonKey} (motif retiré)`;
}

// ── Prévision par mois de clôture prévue ────────────────────────────────────

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function libelleMois(mois: string): string {
  const [y, m] = mois.split('-').map(Number) as [number, number];
  if (!Number.isInteger(y) || !Number.isInteger(m)) return mois;
  const texte = MOIS.format(new Date(Date.UTC(y, m - 1, 1)));
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

type Bucket = CrmReportsView['forecastByMonth']['buckets'][number];

export function libelleBucket(b: Pick<Bucket, 'kind' | 'month'>): string {
  if (b.kind === 'overdue') return 'En retard (date passée)';
  if (b.kind === 'no_date') return 'Sans date prévue';
  return b.month ? libelleMois(b.month) : 'Mois inconnu';
}

export interface DevisePrevision {
  currency: string;
  pondere: string;
  brut: string;
  nonPonderable: string | null;
  largeur: number;
}

export interface LignePrevisionMois {
  cle: string;
  periode: string;
  enRetard: boolean;
  nombre: string;
  devises: DevisePrevision[];
}

/**
 * Une ligne par période ; une sous-ligne par devise. La barre d'une devise est
 * rapportée au plus grand montant pondéré DE LA MÊME DEVISE (jamais entre devises).
 */
export function lignesPrevisionMois(
  view: Pick<CrmReportsView, 'forecastByMonth'>,
): LignePrevisionMois[] {
  const maxParDevise = new Map<string, number>();
  for (const b of view.forecastByMonth.buckets) {
    for (const c of b.currencies) {
      const v = Number(c.weighted);
      if (Number.isFinite(v)) {
        maxParDevise.set(c.currency, Math.max(maxParDevise.get(c.currency) ?? 0, v));
      }
    }
  }
  return view.forecastByMonth.buckets.map((b) => ({
    cle: b.kind === 'month' ? (b.month ?? 'mois') : b.kind,
    periode: libelleBucket(b),
    enRetard: b.kind === 'overdue',
    nombre: libelleNombreOpp(b.count),
    devises: b.currencies.map((c) => ({
      currency: c.currency,
      pondere: `${formatMontant(c.weighted, c.currency)} (estimé)`,
      brut: `${formatMontant(c.unweighted, c.currency)} (estimé)`,
      nonPonderable:
        c.notWeightable.count === 0
          ? null
          : `Non pondérable : ${formatMontant(c.notWeightable.total, c.currency)} (${libelleNombreOpp(c.notWeightable.count)})`,
      largeur: largeur(Number(c.weighted), maxParDevise.get(c.currency) ?? 0),
    })),
  }));
}

export function libelleSourceProbabilite(s: 'historical' | 'manual'): string {
  return s === 'historical'
    ? 'Probabilités historiques (taux de gain observés par étape).'
    : 'Probabilités saisies sur les opportunités.';
}

// ── Motifs de perte ─────────────────────────────────────────────────────────

export interface LigneMotif {
  cle: string;
  motif: string;
  nombre: string;
  largeur: number;
}

export function lignesMotifs(view: Pick<CrmReportsView, 'lostReasons'>): LigneMotif[] {
  const max = Math.max(0, ...view.lostReasons.reasons.map((r) => r.count));
  return view.lostReasons.reasons.map((r) => ({
    cle: r.lostReasonKey ?? 'sans-motif',
    motif: libelleMotifRapport(r),
    nombre: libelleNombreOpp(r.count),
    largeur: largeur(r.count, max),
  }));
}

// ── Mentions ────────────────────────────────────────────────────────────────

const JOUR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function libelleJour(jour: string): string {
  const [y, m, d] = jour.split('-').map(Number) as [number, number, number];
  if (![y, m, d].every(Number.isInteger)) return jour;
  return JOUR.format(new Date(Date.UTC(y, m - 1, d)));
}

export function phrasePeriode(view: Pick<CrmReportsView, 'period'>): string {
  return `Du ${libelleJour(view.period.from)} au ${libelleJour(view.period.to)} (jours de Kinshasa)`;
}

export const MENTION_TRONQUE =
  'Chiffres partiels : trop d’opportunités pour un seul calcul. Réduisez la période ou filtrez par responsable.';

export function messageRapports(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: unknown; detail?: unknown };
    if (e.status === 403) return 'Votre rôle ne permet pas de consulter les rapports du CRM.';
    const code =
      typeof e.detail === 'object' && e.detail !== null
        ? (e.detail as { code?: unknown }).code
        : undefined;
    if (code === 'CRM_REPORT_PERIOD_TOO_LONG') return 'La période ne peut pas dépasser 24 mois.';
    if (code === 'CRM_REPORT_PERIOD_INVALID') return 'Période invalide.';
  }
  return 'Impossible de charger les rapports du CRM.';
}

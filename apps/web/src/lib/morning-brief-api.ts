// Client du brief du matin (ADR-0033).
//
// Fichier séparé de `api.ts` : le brief est un domaine à part, et ses formes
// recopient celles du moteur (`packages/engine/src/morning-brief/types.ts`),
// dont l'application web ne dépend pas. Montants : chaînes décimales.

import { jsonRequest } from './api';

export type BriefCurrency = 'CDF' | 'USD';
export type BriefFactStatus = 'known' | 'to_fill' | 'unavailable' | 'hidden';
export type BriefSeverity = 'critique' | 'attention' | 'info';

export interface BriefFactView {
  id: string;
  label: string;
  kind: 'amount' | 'count' | 'status';
  status: BriefFactStatus;
  value: string | null;
  currency: BriefCurrency | null;
  source: { module: string; collection: string | null; rule: string; reference: string };
}

export interface BriefThresholdView {
  id: string;
  value: number;
  unit: 'facture' | 'heures' | 'jours' | 'jour_du_mois';
  label: string;
  nature: 'parametre_produit_a_valider';
}

export interface BriefRuleOutcomeView {
  ruleId: string;
  severity: BriefSeverity;
  rank: number;
  title: string;
  message: string;
  recommendation: string;
  actionPath: string;
  factIds: string[];
  threshold: BriefThresholdView | null;
}

export interface MorningBriefData {
  version: string;
  now: string;
  period: { year: number; month: number; day: number };
  facts: BriefFactView[];
  alerts: BriefRuleOutcomeView[];
  recommendations: BriefRuleOutcomeView[];
  triggeredCount: number;
  alertCount: number;
  rulesSkipped: { ruleId: string; reason: 'hidden' | 'unavailable' }[];
  predictions: never[];
  truncated: boolean;
}

export interface MorningBriefView {
  brief: MorningBriefData;
  ai: {
    enabled: boolean;
    disabledBy: 'organization' | 'platform' | null;
    quota: {
      limit: number | null;
      used: number;
      remaining: number | null;
      unlimited: boolean;
      exceeded: boolean;
      resetInDays: number;
    } | null;
    mention: string;
  };
  canManageAi: boolean;
}

export type BriefIntent = 'explain' | 'this_week';

export interface BriefAnswerView {
  intent: BriefIntent;
  items: { texte: string; sources: { id: string; label: string }[] }[];
  source: 'llm' | 'fallback';
  cached: boolean;
  reason: 'desactivee_plateforme' | 'desactivee_organisation' | 'indisponible' | 'rejetee' | null;
  mention: string;
  factsSha256: string;
}

export interface MorningBriefPreferences {
  emailDaily: boolean;
  aiEnabled: boolean;
  aiDisabledBy: 'organization' | 'platform' | null;
}

export const morningBriefApi = {
  get: () => jsonRequest<MorningBriefView>('/morning-brief', { method: 'GET' }),
  explain: (intent: BriefIntent) =>
    jsonRequest<BriefAnswerView>('/morning-brief/explanation', {
      method: 'POST',
      body: { intent },
    }),
  preferences: () =>
    jsonRequest<MorningBriefPreferences>('/morning-brief/preferences', { method: 'GET' }),
  setEmailDaily: (emailDaily: boolean) =>
    jsonRequest<MorningBriefPreferences>('/morning-brief/preferences', {
      method: 'PUT',
      body: { emailDaily },
    }),
  setAiEnabled: (aiEnabled: boolean) =>
    jsonRequest<MorningBriefPreferences>('/morning-brief/settings', {
      method: 'PUT',
      body: { aiEnabled },
    }),
};

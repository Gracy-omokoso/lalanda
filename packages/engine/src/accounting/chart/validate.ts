// Cohérence d'un pack de plan comptable — ADR-0049 § 2.1 « Règles du pack » (lot K1).
//
// `validateChartPack` ne lève pas : il rend la liste des défauts, pour que l'API (K4)
// puisse les afficher. `parseChartPack` (parse.ts) refuse tout pack qui en a un.

import { RULE_TOKENS, TO_CONFIRM_MENTION, type ChartPack, type Confirmation } from './schema.js';

export type ChartPackIssueCode =
  | 'SCHEMA'
  | 'DUPLICATE_SOURCE'
  | 'DUPLICATE_CLASS'
  | 'DUPLICATE_ACCOUNT'
  | 'DUPLICATE_EXPECTED'
  | 'DUPLICATE_RULE'
  | 'UNKNOWN_SOURCE'
  | 'SOURCED_WITHOUT_SOURCE'
  | 'TO_CONFIRM_WITHOUT_MENTION'
  | 'UNKNOWN_CLASS'
  | 'ACCOUNT_OUTSIDE_CLASS'
  | 'UNKNOWN_PARENT'
  | 'PARENT_NOT_PREFIX'
  | 'AUXILIARY_NOT_COLLECTIVE'
  | 'UNKNOWN_ACCOUNT_IN_RULE'
  | 'RULE_WITHOUT_LINES'
  | 'UNKNOWN_ACCOUNT_IN_TEMPLATE'
  | 'APPROVED_WITH_TO_CONFIRM'
  | 'APPROVED_WITHOUT_REVIEW'
  | 'APPROVED_WITH_EXPECTED_ACCOUNTS'
  | 'APPROVED_WITHOUT_NATURE'
  | 'APPROVED_WITH_UNVERIFIED_SOURCE';

export interface ChartPackIssue {
  code: ChartPackIssueCode;
  path: string;
  message: string;
}

/** Statuts qui exigent un pack complet et relu (docs/09 : « un pack incomplet ne peut pas être publié comme complet »). */
const COMPLETE_STATUSES = new Set<ChartPack['status']>(['approved', 'active', 'retired']);

interface Confirmable {
  confirmation: Confirmation;
  sourceId: string | null;
  note?: string | undefined;
}

export function validateChartPack(pack: ChartPack): ChartPackIssue[] {
  const issues: ChartPackIssue[] = [];
  const add = (code: ChartPackIssueCode, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  // ─── Unicité ───────────────────────────────────────────────
  const dup = (values: string[], code: ChartPackIssueCode, path: string, what: string): void => {
    const seen = new Set<string>();
    values.forEach((v, i) => {
      if (seen.has(v)) add(code, `${path}.${i}`, `${what} en double : « ${v} »`);
      seen.add(v);
    });
  };
  dup(
    pack.sources.map((s) => s.id),
    'DUPLICATE_SOURCE',
    'sources',
    'source',
  );
  dup(
    pack.classes.map((c) => c.number),
    'DUPLICATE_CLASS',
    'classes',
    'classe',
  );
  dup(
    pack.accounts.map((a) => a.number),
    'DUPLICATE_ACCOUNT',
    'accounts',
    'compte',
  );
  dup(
    pack.expectedAccounts.map((e) => e.id),
    'DUPLICATE_EXPECTED',
    'expectedAccounts',
    'compte attendu',
  );
  dup(
    pack.proposedRules.map((r) => r.key),
    'DUPLICATE_RULE',
    'proposedRules',
    'règle',
  );

  const sourceIds = new Set(pack.sources.map((s) => s.id));
  const classNumbers = new Set(pack.classes.map((c) => c.number));
  const accountNumbers = new Set(pack.accounts.map((a) => a.number));

  // ─── Source et mention, pour tout élément confirmable ─────
  const checkConfirmable = (item: Confirmable, path: string): void => {
    if (item.sourceId !== null && !sourceIds.has(item.sourceId)) {
      add('UNKNOWN_SOURCE', `${path}.sourceId`, `source inconnue : « ${item.sourceId} »`);
    }
    if (item.confirmation === 'sourced' && item.sourceId === null) {
      add('SOURCED_WITHOUT_SOURCE', `${path}.sourceId`, 'un élément « sourced » exige une source');
    }
    if (item.confirmation === 'to_confirm' && !(item.note ?? '').includes(TO_CONFIRM_MENTION)) {
      add(
        'TO_CONFIRM_WITHOUT_MENTION',
        `${path}.note`,
        `un élément « to_confirm » porte la mention « ${TO_CONFIRM_MENTION} »`,
      );
    }
  };

  pack.classes.forEach((c, i) => checkConfirmable(c, `classes.${i}`));

  // ─── Comptes ───────────────────────────────────────────────
  pack.accounts.forEach((a, i) => {
    const path = `accounts.${i}`;
    checkConfirmable(a, path);
    if (!classNumbers.has(a.classNumber)) {
      add('UNKNOWN_CLASS', `${path}.classNumber`, `classe inconnue : « ${a.classNumber} »`);
    }
    if (!a.number.startsWith(a.classNumber)) {
      add(
        'ACCOUNT_OUTSIDE_CLASS',
        `${path}.number`,
        `le compte ${a.number} ne commence pas par sa classe ${a.classNumber}`,
      );
    }
    if (a.parent !== null) {
      if (!accountNumbers.has(a.parent)) {
        add('UNKNOWN_PARENT', `${path}.parent`, `compte parent inconnu : « ${a.parent} »`);
      } else if (a.parent === a.number || !a.number.startsWith(a.parent)) {
        add(
          'PARENT_NOT_PREFIX',
          `${path}.parent`,
          `le parent ${a.parent} n'est pas un préfixe strict de ${a.number}`,
        );
      }
    }
    if (a.auxiliaryKind !== null && !a.collective) {
      add(
        'AUXILIARY_NOT_COLLECTIVE',
        `${path}.auxiliaryKind`,
        'seul un compte collectif reçoit des comptes auxiliaires',
      );
    }
  });

  // ─── Règles proposées ──────────────────────────────────────
  const tokens = new Set<string>(RULE_TOKENS);
  pack.proposedRules.forEach((r, i) => {
    const path = `proposedRules.${i}`;
    checkConfirmable(r, path);
    if (r.debit.length === 0 || r.credit.length === 0) {
      add('RULE_WITHOUT_LINES', path, 'une règle vise au moins un compte au débit et au crédit');
    }
    for (const [side, refs] of [
      ['debit', r.debit],
      ['credit', r.credit],
    ] as const) {
      refs.forEach((ref, j) => {
        if (!tokens.has(ref) && !accountNumbers.has(ref)) {
          add(
            'UNKNOWN_ACCOUNT_IN_RULE',
            `${path}.${side}.${j}`,
            `compte absent du pack : « ${ref} »`,
          );
        }
      });
    }
  });

  // ─── Modèles d'états ───────────────────────────────────────
  for (const [kind, rubrics] of Object.entries(pack.statementTemplates)) {
    rubrics?.forEach((rb, i) => {
      const path = `statementTemplates.${kind}.${i}`;
      checkConfirmable(rb, path);
      rb.accountPrefixes.forEach((p, j) => {
        if (!classNumbers.has(p) && ![...accountNumbers].some((n) => n.startsWith(p))) {
          add(
            'UNKNOWN_ACCOUNT_IN_TEMPLATE',
            `${path}.accountPrefixes.${j}`,
            `aucune classe ni aucun compte du pack ne correspond à « ${p} »`,
          );
        }
      });
    });
  }

  // ─── Pack complet : approved, active, retired ──────────────
  if (COMPLETE_STATUSES.has(pack.status)) {
    const toConfirm: string[] = [
      ...pack.classes.flatMap((c, i) => (c.confirmation === 'to_confirm' ? [`classes.${i}`] : [])),
      ...pack.accounts.flatMap((a, i) =>
        a.confirmation === 'to_confirm' ? [`accounts.${i}`] : [],
      ),
      ...pack.proposedRules.flatMap((r, i) =>
        r.confirmation === 'to_confirm' ? [`proposedRules.${i}`] : [],
      ),
      ...Object.entries(pack.statementTemplates).flatMap(
        ([kind, rubrics]) =>
          rubrics?.flatMap((rb, i) =>
            rb.confirmation === 'to_confirm' ? [`statementTemplates.${kind}.${i}`] : [],
          ) ?? [],
      ),
    ];
    for (const path of toConfirm) {
      add(
        'APPROVED_WITH_TO_CONFIRM',
        path,
        `un pack « ${pack.status} » ne contient aucun élément « to_confirm »`,
      );
    }
    if (pack.review === null) {
      add('APPROVED_WITHOUT_REVIEW', 'review', `un pack « ${pack.status} » exige une relecture`);
    }
    if (pack.expectedAccounts.length > 0) {
      add(
        'APPROVED_WITH_EXPECTED_ACCOUNTS',
        'expectedAccounts',
        `un pack « ${pack.status} » ne laisse aucun compte attendu`,
      );
    }
    pack.accounts.forEach((a, i) => {
      if (a.nature === null) {
        add(
          'APPROVED_WITHOUT_NATURE',
          `accounts.${i}.nature`,
          `nature du compte ${a.number} non fournie`,
        );
      }
    });
    pack.sources.forEach((s, i) => {
      if (s.verifiedOn === null || s.verifiedBy === null) {
        add(
          'APPROVED_WITH_UNVERIFIED_SOURCE',
          `sources.${i}`,
          `source « ${s.id} » non vérifiée (date et auteur exigés)`,
        );
      }
    });
  }

  return issues;
}

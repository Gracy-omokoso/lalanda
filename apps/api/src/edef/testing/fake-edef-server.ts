// Faux serveur e-MCF pour les tests — ADR-0021 §6, enrichi par ADR-0024
// (chantier F1, « Faux serveur e-MCF enrichi »).
//
// Serveur `node:http` sur un port éphémère, aucune dépendance ajoutée. Il imite
// la spécification PUBLIQUE (`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`) :
// `GET /api/info/status`, `GET /api/info/{liste}`, et les routes de facturation
// `GET /api/invoice`, `POST /api/invoice`, `GET /api/invoice/{uid}`,
// `PUT /api/invoice/{uid}/confirm`, `PUT /api/invoice/{uid}/cancel` ;
// l'authentification `Authorization: Bearer <jeton>` et le 401 d'un jeton
// inconnu. AUCUN test automatisé n'appelle la DGI réelle.
//
// Ce serveur NE FAIT AUTORITÉ SUR AUCUNE RÈGLE FISCALE :
//  - les listes renvoyées sont FICTIVES (codes des énumérations de la
//    spécification publique, libellés neutres) ;
//  - les totaux d'une facture sont calculés par LE MOTEUR (`computeInvoiceTotals`)
//    sous une politique d'arrondi CHOISIE PAR LE TEST (`policy`,
//    `setRoundingPolicy`) : le faux serveur peut donc différer de notre calcul,
//    exactement comme la DGI pourrait le faire ;
//  - les codes d'erreur sont ceux qu'ADR-0024 § 5 nomme (1, 20, 50, 51, 63…) ;
//    une donnée que le moteur refuse est rejetée avec le code FICTIF
//    `FAKE-VALIDATION` ; les libellés sont neutres, rédigés pour ce serveur ;
//  - ce que la documentation DGI ne dit pas (détail d'une facture finalisée,
//    annulée ou expirée, format de `dateTime`) suit un CHOIX de ce serveur,
//    documenté ci-dessous, en attendant les sondes (ADR-0024 § 7.4).
//
// Il enregistre chaque requête reçue — méthode, chemin, en-tête `Authorization`,
// corps : c'est la preuve, côté test, que le jeton a bien été utilisé, qu'aucune
// requête n'est partie quand la production est fermée ou le journal en panne, et
// qu'aucun `POST` n'a été rejoué.
//
// ── Scénarios de facturation (ADR-0024, critères « Faux serveur ») ──────────
// Choisis par jeton (`invoiceScenario` du profil) ou par numéro de facture
// (`setInvoiceScenario(rn, …)`, prioritaire) ; plusieurs se combinent dans un
// tableau (ex. `['confirm_timeout_after_finalize', 'details_without_security']`).
// « Ne répond pas » = la connexion reste ouverte sans réponse : le client tombe
// sur son délai (`timeout`).
//
//   ok                               comportement nominal
//   totals_offset:<champ>            un centime de plus sur <champ> (ex. `vab`,
//                                    `total`) dans la réponse du `POST` ; ces
//                                    totaux décalés sont ceux que la DGI retient
//                                    (un `confirm` avec les nôtres → erreur 50/51)
//   post_business_error:<code>       `POST` → erreur <code>, `uid` nul, rien créé
//   post_timeout_before_create       `POST` ne répond pas, rien créé
//   post_timeout_after_create        `POST` crée la demande puis ne répond pas
//   post_malformed                   `POST` crée la demande, réponse JSON illisible
//   confirm_timeout_before_finalize  1er `confirm` du `uid` ne répond pas, rien finalisé
//   confirm_timeout_after_finalize   1er `confirm` finalise puis ne répond pas
//   confirm_error:<code>             1er `confirm` → erreur <code>, rien finalisé
//   cancel_timeout                   1er `cancel` ne répond pas, rien annulé (la
//                                    demande reste en attente jusqu'à expiration)
//   pending_full                     `POST` → erreur 1, rien créé
//   duplicate_pending                `POST` → une demande « fantôme » de même `rn`
//                                    est créée (comme un envoi perdu), puis
//                                    erreur 63 avec son `uid`
//   details_without_security         `GET /api/invoice/{uid}` sans `secElements`,
//                                    même pour une demande finalisée
//   server_error                     HTTP 500 sur toutes les routes de facturation
//   post_without_uid                 (extension) `POST` → totaux sans `uid` ni
//                                    `errorCode`, rien créé
//   confirm_without_code             (extension) 1er `confirm` → 200 sans
//                                    `codeDEFDGI`, rien finalisé
//
// Seul le PREMIER `confirm` (ou `cancel`) d'un `uid` subit un scénario
// `confirm_*` (ou `cancel_timeout`) : le second se comporte normalement, ce qui
// permet de tester « vérification, puis second `confirm` sur le même `uid` ».
//
// Règles toujours actives : expiration d'une demande non finalisée au bout de
// `pendingTtlMs` (120 s par défaut, court en test ; horloge avançable par
// `advanceClock`) ; au plus `maxPending` (10) demandes en attente par jeton
// (erreur 1) ; refus d'un `rn` déjà en attente (erreur 63 avec l'`uid`
// existant) ; `confirm` revérifié contre les totaux retenus (erreur 50 pour
// `total`, 51 pour `vtotal`) ; `confirm` ou `cancel` d'une demande finalisée,
// annulée, expirée ou inconnue → erreur 20 (ambiguë, comme à la DGI).
//
// Choix de ce serveur (NON documentés par la DGI) : `GET /api/invoice/{uid}`
// répond pour toute demande connue, quel que soit son état, avec `secElements`
// seulement si elle est finalisée ; un `uid` inconnu → erreur 20 ; une demande
// expirée n'apparaît plus dans `GET /api/invoice` ; `dateTime` au format
// `jj/MM/aaaa HH:mm:ss`, heure de Kinshasa (UTC+1) — question DGI n° 5.

import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  DGI_ROUNDING_POLICY,
  TAX_GROUP_LETTERS,
  computeInvoiceTotals,
  decimalFromJsonNumber,
  decimalFromJsonRate,
  decimalToJsonNumber,
  toEdefTotals,
  usdCounterValue,
  type InvoiceLineInput,
  type InvoiceTotals,
  type ItemType,
  type RoundingPolicy,
  type SpecificTax,
  type TaxGroupLetter,
  type TaxRateTable,
} from '@lalanda/engine';

export type FakeEdefInvoiceScenario =
  | 'ok'
  | `totals_offset:${string}`
  | `post_business_error:${string}`
  | 'post_timeout_before_create'
  | 'post_timeout_after_create'
  | 'post_malformed'
  | 'confirm_timeout_before_finalize'
  | 'confirm_timeout_after_finalize'
  | `confirm_error:${string}`
  | 'cancel_timeout'
  | 'pending_full'
  | 'duplicate_pending'
  | 'details_without_security'
  | 'server_error'
  // Extensions de ce serveur (forme de réponse non conforme, pour le client) :
  | 'post_without_uid'
  | 'confirm_without_code';

export type FakeEdefScenarioInput = FakeEdefInvoiceScenario | readonly FakeEdefInvoiceScenario[];

export interface FakeEdefTokenProfile {
  nif: string;
  nim: string;
  /** ISO 8601. */
  tokenValid: string;
  emcfStatus?: 'Enregistré' | 'Actif' | 'Désactivé';
  /** Comportement de TOUTES les routes (lectures et facturation), avant tout scénario. */
  behaviour?:
    | 'ok'
    | 'unauthorized'
    | 'server_error'
    | 'slow'
    | 'malformed'
    | 'business_error'
    | 'status_false'
    /** Extension de test : réponse de plus de 1 Mio. */
    | 'oversized';
  /** Scénario des routes de facturation pour ce jeton (cf. en-tête). */
  invoiceScenario?: FakeEdefScenarioInput;
}

export interface FakeEdefRequest {
  method: string;
  path: string;
  authorization: string | null;
  /** Corps brut reçu ; `null` si vide. */
  body: string | null;
  /** Heure du faux serveur (horloge avançable). */
  at: Date;
}

export type FakeEdefInvoiceStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface FakeEdefSecurityElements {
  dateTime: string;
  qrCode: string;
  codeDEFDGI: string;
  counters: string;
  nim: string;
}

/** État d'une demande de facture côté faux serveur (copie, lecture seule). */
export interface FakeEdefInvoiceRecord {
  uid: string;
  rn: string;
  nif: string;
  status: FakeEdefInvoiceStatus;
  createdAt: Date;
  finalizedAt: Date | null;
  /** Corps reçu, analysé. */
  request: Readonly<Record<string, unknown>>;
  /** Totaux retenus par le faux serveur (`InvoiceResponseDto` sans `uid`). */
  totals: Readonly<Record<string, number | null>>;
  security: FakeEdefSecurityElements | null;
  confirmCalls: number;
  cancelCalls: number;
  /** Créée par le scénario `duplicate_pending` (envoi « perdu » simulé). */
  phantom: boolean;
}

/** Nature d'un appel de facturation reçu (pour compter, ex. « un seul `POST` »). */
export type FakeEdefInvoiceCall = 'submit' | 'confirm' | 'cancel' | 'pending' | 'details';

export interface FakeEdefServer {
  baseUrl: string;
  requests: FakeEdefRequest[];
  /** Remplace la liste des groupes de taxation renvoyée (et utilisée pour les totaux). */
  setTaxGroups(groups: Record<string, number>): void;
  /** Ajoute ou remplace un profil de jeton en cours de test. */
  setToken(token: string, profile: FakeEdefTokenProfile): void;
  /** Scénario pour un numéro de facture `rn` (prioritaire sur celui du jeton) ; `null` l'efface. */
  setInvoiceScenario(rn: string, scenario: FakeEdefScenarioInput | null): void;
  /** Politique d'arrondi des totaux du faux serveur. */
  setRoundingPolicy(policy: RoundingPolicy): void;
  /** Avance l'horloge du faux serveur (expiration des demandes, dates). */
  advanceClock(ms: number): void;
  /** Heure courante du faux serveur. */
  now(): Date;
  /** Demandes connues, état à jour (expiration appliquée). */
  invoices(): FakeEdefInvoiceRecord[];
  invoiceByUid(uid: string): FakeEdefInvoiceRecord | null;
  invoicesByRn(rn: string): FakeEdefInvoiceRecord[];
  /** Requêtes de facturation reçues, par nature. */
  callsTo(kind: FakeEdefInvoiceCall): FakeEdefRequest[];
  close(): Promise<void>;
}

/** Taux d'exemple du contrat ADR-0021 §10 — valeurs de test, pas une source. */
export const FAKE_DEFAULT_TAX_GROUPS: Record<string, number> = { a: 0, b: 16, c: 5, o: 1 };

/** Durée de vie par défaut d'une demande non finalisée (documentation DGI : 2 min). */
export const FAKE_DEFAULT_PENDING_TTL_MS = 120_000;
/** Demandes en attente au plus par e-MCF (documentation DGI : 10). */
export const FAKE_DEFAULT_MAX_PENDING = 10;
/** Code FICTIF d'une donnée que le moteur refuse (aucune correspondance DGI revendiquée). */
export const FAKE_VALIDATION_ERROR_CODE = 'FAKE-VALIDATION';

const TYPE_LISTS: Record<string, Array<{ type: string; description: string }>> = {
  invoiceTypes: ['FV', 'FT', 'FA', 'EV', 'ET', 'EA'].map((type) => ({
    type,
    description: `Type ${type} (valeur fictive du faux serveur)`,
  })),
  paymentTypes: [
    'ESPECES',
    'VIREMENT',
    'CARTEBANCAIRE',
    'MOBILEMONEY',
    'CHEQUES',
    'CREDIT',
    'AUTRE',
  ].map((type) => ({ type, description: `Paiement ${type} (valeur fictive)` })),
  clientTypes: ['PP', 'PM', 'PC', 'PL', 'AO'].map((type) => ({
    type,
    description: `Client ${type} (valeur fictive)`,
  })),
  referenceTypes: [{ type: 'REF', description: 'Nature d’avoir (valeur fictive)' }],
  itemTypes: ['BIE', 'SER', 'TAX'].map((type) => ({
    type,
    description: `Article ${type} (valeur fictive)`,
  })),
};

interface StoredInvoice extends FakeEdefInvoiceRecord {
  token: string;
  type: string;
}

const INVOICE_DETAIL = /^\/api\/invoice\/([^/]+)$/;
const INVOICE_ACTION = /^\/api\/invoice\/([^/]+)\/(confirm|cancel)$/;

export async function startFakeEdefServer(opts: {
  tokens: Record<string, FakeEdefTokenProfile>;
  taxGroups?: Record<string, number>;
  slowMs?: number;
  /** Expiration d'une demande non finalisée (défaut 120 s). */
  pendingTtlMs?: number;
  /** Demandes en attente au plus par jeton (défaut 10). */
  maxPending?: number;
  /** Politique d'arrondi des totaux (défaut : celle de Lalanda, `DGI_ROUNDING_POLICY`). */
  policy?: RoundingPolicy;
}): Promise<FakeEdefServer> {
  const tokens = new Map(Object.entries(opts.tokens));
  let taxGroups = { ...(opts.taxGroups ?? FAKE_DEFAULT_TAX_GROUPS) };
  const slowMs = opts.slowMs ?? 20_000;
  const pendingTtlMs = opts.pendingTtlMs ?? FAKE_DEFAULT_PENDING_TTL_MS;
  const maxPending = opts.maxPending ?? FAKE_DEFAULT_MAX_PENDING;
  let policy: RoundingPolicy = opts.policy ?? DGI_ROUNDING_POLICY;
  let clockOffsetMs = 0;
  const requests: FakeEdefRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const rnScenarios = new Map<string, readonly FakeEdefInvoiceScenario[]>();
  const store = new Map<string, StoredInvoice>();
  const counters = new Map<string, { total: number; byType: Map<string, number> }>();

  const now = (): Date => new Date(Date.now() + clockOffsetMs);

  /** Applique l'expiration (horloge du faux serveur). */
  function refresh(rec: StoredInvoice): StoredInvoice {
    if (rec.status === 'pending' && now().getTime() - rec.createdAt.getTime() >= pendingTtlMs) {
      rec.status = 'expired';
    }
    return rec;
  }

  function scenariosFor(
    profile: FakeEdefTokenProfile,
    rn: string | null,
  ): readonly FakeEdefInvoiceScenario[] {
    const byRn = rn !== null ? rnScenarios.get(rn) : undefined;
    if (byRn) return byRn;
    return toList(profile.invoiceScenario);
  }

  function pendingOf(token: string): StoredInvoice[] {
    return [...store.values()]
      .map(refresh)
      .filter((r) => r.token === token && r.status === 'pending');
  }

  function createInvoice(
    token: string,
    profile: FakeEdefTokenProfile,
    body: Record<string, unknown>,
    totals: Record<string, number | null>,
    phantom: boolean,
  ): StoredInvoice {
    const rec: StoredInvoice = {
      token,
      type: typeof body['type'] === 'string' ? body['type'] : 'FV',
      uid: randomUUID(),
      rn: String(body['rn'] ?? ''),
      nif: typeof body['nif'] === 'string' ? body['nif'] : profile.nif,
      status: 'pending',
      createdAt: now(),
      finalizedAt: null,
      request: Object.freeze({ ...body }),
      totals: Object.freeze({ ...totals }),
      security: null,
      confirmCalls: 0,
      cancelCalls: 0,
      phantom,
    };
    store.set(rec.uid, rec);
    return rec;
  }

  function securityFor(
    rec: StoredInvoice,
    profile: FakeEdefTokenProfile,
  ): FakeEdefSecurityElements {
    const c = counters.get(rec.token) ?? { total: 0, byType: new Map<string, number>() };
    counters.set(rec.token, c);
    c.total += 1;
    const ofType = (c.byType.get(rec.type) ?? 0) + 1;
    c.byType.set(rec.type, ofType);
    const groups = randomBytes(10).toString('hex').toUpperCase().match(/.{4}/g)!.slice(0, 5);
    const codeDEFDGI = ['FAKE', ...groups].join('-');
    const dateTime = kinshasaDateTime(now());
    return {
      dateTime,
      codeDEFDGI,
      counters: `${ofType}/${c.total} ${rec.type}`,
      nim: profile.nim,
      qrCode: `FAKE-QR;${profile.nim};${codeDEFDGI};${dateTime}`,
    };
  }

  function computeTotals(
    body: Record<string, unknown>,
  ): { ok: true; totals: Record<string, number | null> } | { ok: false; detail: string } {
    const rates: Partial<Record<TaxGroupLetter, string>> = {};
    for (const letter of TAX_GROUP_LETTERS) {
      const value = taxGroups[letter.toLowerCase()];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        rates[letter] = String(value);
      }
    }
    const items = Array.isArray(body['items']) ? (body['items'] as unknown[]) : [];
    const lines: InvoiceLineInput[] = [];
    for (const [i, raw] of items.entries()) {
      const line = lineOf(raw);
      if (!line) return { ok: false, detail: `article ${i + 1} illisible` };
      lines.push(line);
    }
    const mode = body['mode'];
    if (mode !== 'ttc' && mode !== 'ht') return { ok: false, detail: 'mode de prix' };
    const result = computeInvoiceTotals({
      priceMode: mode,
      lines,
      rates: rates as TaxRateTable,
      policy,
    });
    if (!result.ok) {
      return { ok: false, detail: result.issues.map((i) => i.code).join(', ') };
    }
    const out = jsonTotals(result.totals, rates as TaxRateTable);
    const curRate = body['curRate'];
    if (typeof curRate === 'number') {
      const rate = decimalFromJsonRate(curRate);
      if (rate === null) return { ok: false, detail: 'curRate' };
      out['curTotal'] = decimalToJsonNumber(usdCounterValue(result.totals.total, rate));
    }
    return { ok: true, totals: out };
  }

  // ── Routes de facturation ──────────────────────────────────────────────────

  function handleInvoice(
    req: { method: string; path: string; body: string | null },
    token: string,
    profile: FakeEdefTokenProfile,
    res: ServerResponse,
  ): void {
    const { method, path } = req;

    if (path === '/api/invoice' && method === 'GET') {
      if (has(scenariosFor(profile, null), 'server_error')) return serverError(res);
      const list = pendingOf(token).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return sendJson(res, 200, {
        status: true,
        version: '2.0',
        nif: profile.nif,
        nim: profile.nim,
        tokenValid: profile.tokenValid,
        serverDateTime: now().toISOString(),
        pendingRequestsCount: list.length,
        pendingRequestsList: list.map((r) => ({ date: r.createdAt.toISOString(), uid: r.uid })),
      });
    }

    if (path === '/api/invoice' && method === 'POST') {
      const parsed = parseJson(req.body);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return sendJson(res, 400, { title: 'Bad Request', status: 400 });
      }
      const body = parsed as Record<string, unknown>;
      const rn = typeof body['rn'] === 'string' ? body['rn'] : null;
      const scen = scenariosFor(profile, rn);

      if (has(scen, 'server_error')) return serverError(res);
      if (has(scen, 'post_timeout_before_create')) return hang(res);
      const forced = param(scen, 'post_business_error');
      if (forced !== null) return businessError(res, forced, 'Refus simulé (faux serveur).');
      if (has(scen, 'pending_full')) return pendingFull(res);
      if (has(scen, 'duplicate_pending') && rn) {
        const existing =
          pendingOf(token).find((r) => r.rn === rn) ??
          createInvoice(token, profile, body, {}, true);
        return duplicate(res, rn, existing.uid);
      }

      if (!rn) return businessError(res, FAKE_VALIDATION_ERROR_CODE, 'Numéro `rn` absent.');
      const waiting = pendingOf(token);
      const sameRn = waiting.find((r) => r.rn === rn);
      if (sameRn) return duplicate(res, rn, sameRn.uid);
      if (waiting.length >= maxPending) return pendingFull(res);

      const computed = computeTotals(body);
      if (!computed.ok) {
        return businessError(
          res,
          FAKE_VALIDATION_ERROR_CODE,
          `Donnée refusée par le faux serveur (${computed.detail}).`,
        );
      }
      const totals = { ...computed.totals };
      const offsetField = param(scen, 'totals_offset');
      if (offsetField !== null) totals[offsetField] = plusOneCent(totals[offsetField]);

      if (has(scen, 'post_without_uid')) {
        return sendJson(res, 200, { uid: null, ...totals, errorCode: null, errorDesc: null });
      }

      const rec = createInvoice(token, profile, body, totals, false);
      if (has(scen, 'post_timeout_after_create')) return hang(res);
      if (has(scen, 'post_malformed')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end(`{"uid":"${rec.uid}","total":`);
      }
      return sendJson(res, 200, { uid: rec.uid, ...totals, errorCode: null, errorDesc: null });
    }

    const action = INVOICE_ACTION.exec(path);
    if (action && method === 'PUT') {
      const uid = decodeURIComponent(action[1]!);
      const rec = store.get(uid);
      const scen = scenariosFor(profile, rec?.rn ?? null);
      if (has(scen, 'server_error')) return serverError(res);
      if (!rec || rec.token !== token) return unknownOrFinalized(res);
      refresh(rec);

      if (action[2] === 'confirm') {
        rec.confirmCalls += 1;
        const first = rec.confirmCalls === 1;
        if (first && has(scen, 'confirm_timeout_before_finalize')) return hang(res);
        const forced = param(scen, 'confirm_error');
        if (first && forced !== null) {
          return businessError(res, forced, 'Refus simulé (faux serveur).');
        }
        if (rec.status !== 'pending') return unknownOrFinalized(res);
        if (first && has(scen, 'confirm_without_code')) {
          return sendJson(res, 200, {
            dateTime: kinshasaDateTime(now()),
            qrCode: 'FAKE-QR',
            codeDEFDGI: '',
            counters: '1/1 FV',
            nim: profile.nim,
            errorCode: null,
            errorDesc: null,
          });
        }
        const amounts = parseJson(req.body) as { total?: unknown; vtotal?: unknown } | undefined;
        if (typeof amounts !== 'object' || amounts === null) {
          return sendJson(res, 400, { title: 'Bad Request', status: 400 });
        }
        if (amounts.total !== rec.totals['total']) {
          return businessError(res, '50', 'Total TTC différent du total retenu (faux serveur).');
        }
        if (amounts.vtotal !== rec.totals['vtotal']) {
          return businessError(res, '51', 'Total TVA différent du total retenu (faux serveur).');
        }
        rec.status = 'confirmed';
        rec.finalizedAt = now();
        rec.security = securityFor(rec, profile);
        if (first && has(scen, 'confirm_timeout_after_finalize')) return hang(res);
        return sendJson(res, 200, { ...rec.security, errorCode: null, errorDesc: null });
      }

      rec.cancelCalls += 1;
      if (rec.cancelCalls === 1 && has(scen, 'cancel_timeout')) return hang(res);
      if (rec.status !== 'pending') return unknownOrFinalized(res);
      rec.status = 'cancelled';
      rec.finalizedAt = now();
      return sendJson(res, 200, {
        dateTime: kinshasaDateTime(rec.finalizedAt),
        qrCode: null,
        codeDEFDGI: null,
        counters: null,
        nim: null,
        errorCode: null,
        errorDesc: null,
      });
    }

    const detail = INVOICE_DETAIL.exec(path);
    if (detail && method === 'GET') {
      const uid = decodeURIComponent(detail[1]!);
      const rec = store.get(uid);
      const scen = scenariosFor(profile, rec?.rn ?? null);
      if (has(scen, 'server_error')) return serverError(res);
      if (!rec || rec.token !== token) return unknownOrFinalized(res);
      refresh(rec);
      const r = rec.request;
      return sendJson(res, 200, {
        nif: rec.nif,
        rn: rec.rn,
        mode: r['mode'] ?? null,
        isf: r['isf'] ?? null,
        type: r['type'] ?? null,
        items: r['items'] ?? null,
        client: r['client'] ?? null,
        operator: r['operator'] ?? null,
        payment: r['payment'] ?? null,
        totals: { uid: rec.uid, ...rec.totals, errorCode: null, errorDesc: null },
        reference: r['reference'] ?? null,
        referenceType: r['referenceType'] ?? null,
        referenceDesc: r['referenceDesc'] ?? null,
        secElements:
          rec.status === 'confirmed' && rec.security && !has(scen, 'details_without_security')
            ? { ...rec.security, errorCode: null, errorDesc: null }
            : null,
        errorCode: null,
        errorDesc: null,
      });
    }

    return sendJson(res, path.startsWith('/api/invoice') ? 405 : 404, { title: 'Not Found' });
  }

  // ── Serveur ────────────────────────────────────────────────────────────────

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      handle(req, res, text.length > 0 ? text : null);
    });
  });

  function handle(req: IncomingMessage, res: ServerResponse, body: string | null): void {
    const authorization =
      typeof req.headers.authorization === 'string' ? req.headers.authorization : null;
    const path = (req.url ?? '/').split('?')[0]!;
    const method = req.method ?? 'GET';
    requests.push({ method, path, authorization, body, at: now() });

    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const profile = token ? tokens.get(token) : undefined;

    if (!token || !profile || profile.behaviour === 'unauthorized') {
      return sendJson(
        res,
        401,
        {
          type: 'https://tools.ietf.org/html/rfc7235#section-3.1',
          title: 'Unauthorized',
          status: 401,
        },
        'application/problem+json',
      );
    }

    const respond = (): void => {
      switch (profile.behaviour) {
        case 'server_error':
          return sendJson(res, 500, { title: 'Internal Server Error' });
        case 'malformed':
          res.writeHead(200, { 'content-type': 'application/json' });
          return void res.end('{"status": tru');
        case 'business_error':
          return sendJson(res, 200, {
            errorCode: 'FAKE-1',
            errorDesc: 'Erreur métier simulée (faux serveur)',
          });
        case 'oversized':
          res.writeHead(200, { 'content-type': 'application/json' });
          return void res.end(`{"pad":"${'x'.repeat(1024 * 1024 + 16)}"}`);
        default:
          break;
      }

      if (path === '/api/invoice' || path.startsWith('/api/invoice/')) {
        return handleInvoice({ method, path, body }, token, profile, res);
      }
      if (method !== 'GET') return sendJson(res, 405, {});

      if (path === '/api/info/status') {
        return sendJson(res, 200, {
          status: profile.behaviour !== 'status_false',
          version: '2.0',
          nif: profile.nif,
          nim: profile.nim,
          tokenValid: profile.tokenValid,
          serverDateTime: now().toISOString(),
          emcfList: [
            {
              nim: profile.nim,
              status: profile.emcfStatus ?? 'Actif',
              shopName: 'Boutique de test',
              address1: '1, avenue Exemple',
              address2: 'Gombe',
              address3: 'Kinshasa',
              contact1: '+243 800 000 000',
              contact2: null,
              contact3: null,
            },
          ],
        });
      }
      if (path === '/api/info/taxGroups') return sendJson(res, 200, taxGroups);
      if (path === '/api/info/currencyRates') {
        return sendJson(res, 200, [
          {
            type: 'USD',
            description: 'Dollar américain (valeur fictive)',
            date: '2026-10-18T00:00:00',
            rate: 1,
          },
        ]);
      }
      const list = path.startsWith('/api/info/')
        ? TYPE_LISTS[path.slice('/api/info/'.length)]
        : null;
      if (list) return sendJson(res, 200, list);
      return sendJson(res, 404, { title: 'Not Found' });
    };

    if (profile.behaviour === 'slow') {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!res.destroyed) respond();
      }, slowMs);
      timers.add(timer);
      return;
    }
    respond();
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const snapshot = (rec: StoredInvoice): FakeEdefInvoiceRecord => {
    refresh(rec);
    const { token: _token, type: _type, ...rest } = rec;
    return { ...rest, security: rec.security ? { ...rec.security } : null };
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setTaxGroups(groups) {
      taxGroups = { ...groups };
    },
    setToken(token, profile) {
      tokens.set(token, profile);
    },
    setInvoiceScenario(rn, scenario) {
      if (scenario === null) rnScenarios.delete(rn);
      else rnScenarios.set(rn, toList(scenario));
    },
    setRoundingPolicy(next) {
      policy = next;
    },
    advanceClock(ms) {
      clockOffsetMs += ms;
    },
    now,
    invoices: () => [...store.values()].map(snapshot),
    invoiceByUid(uid) {
      const rec = store.get(uid);
      return rec ? snapshot(rec) : null;
    },
    invoicesByRn: (rn) => [...store.values()].filter((r) => r.rn === rn).map(snapshot),
    callsTo: (kind) => requests.filter((r) => callKind(r) === kind),
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer);
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ── Aides ────────────────────────────────────────────────────────────────────

/** JSON analysé, ou `undefined` si le corps est absent ou illisible. */
function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toList(input: FakeEdefScenarioInput | undefined): readonly FakeEdefInvoiceScenario[] {
  if (input === undefined) return [];
  return typeof input === 'string' ? [input] : input;
}

function has(list: readonly FakeEdefInvoiceScenario[], name: FakeEdefInvoiceScenario): boolean {
  return list.includes(name);
}

/** Paramètre d'un scénario `nom:<valeur>`, ou `null`. */
function param(list: readonly FakeEdefInvoiceScenario[], name: string): string | null {
  const found = list.find((s) => s.startsWith(`${name}:`));
  return found ? found.slice(name.length + 1) : null;
}

function callKind(r: FakeEdefRequest): FakeEdefInvoiceCall | null {
  if (r.path === '/api/invoice') {
    if (r.method === 'POST') return 'submit';
    if (r.method === 'GET') return 'pending';
    return null;
  }
  const action = INVOICE_ACTION.exec(r.path);
  if (action && r.method === 'PUT') return action[2] === 'confirm' ? 'confirm' : 'cancel';
  if (INVOICE_DETAIL.exec(r.path) && r.method === 'GET') return 'details';
  return null;
}

/** Ligne du moteur depuis un `ItemDto` reçu ; `null` si illisible. */
function lineOf(raw: unknown): InvoiceLineInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const price = typeof item['price'] === 'number' ? decimalFromJsonNumber(item['price']) : null;
  const quantity =
    typeof item['quantity'] === 'number' && /^\d+(\.\d{1,3})?$/.test(String(item['quantity']))
      ? String(item['quantity'])
      : null;
  const group = typeof item['taxGroup'] === 'string' ? item['taxGroup'].toUpperCase() : null;
  const type = item['type'];
  if (price === null || quantity === null || group === null) return null;
  if (!(TAX_GROUP_LETTERS as readonly string[]).includes(group)) return null;
  if (type !== 'BIE' && type !== 'SER' && type !== 'TAX') return null;
  let specificTax: SpecificTax | null = null;
  const value = item['taxSpecificValue'];
  if (typeof value === 'string' && value.length > 0) {
    specificTax = value.endsWith('%')
      ? { kind: 'percent', rate: value.slice(0, -1) }
      : { kind: 'per_unit', amount: value };
  }
  return {
    unitPrice: price,
    quantity,
    taxGroup: group as TaxGroupLetter,
    itemType: type as ItemType,
    specificTax,
  };
}

/** Totaux du moteur au format JSON de l'API (nombres), taux inconnus à `null`. */
function jsonTotals(totals: InvoiceTotals, rates: TaxRateTable): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [field, value] of Object.entries(toEdefTotals(totals, rates))) {
    out[field] = value === null ? null : decimalToJsonNumber(value);
  }
  return out;
}

/** Un centime de plus (scénario `totals_offset`) — arithmétique de TEST, pas un calcul fiscal. */
function plusOneCent(value: number | null | undefined): number {
  const cents = Math.round((value ?? 0) * 100) + 1;
  return cents / 100;
}

/** `jj/MM/aaaa HH:mm:ss`, heure de Kinshasa (UTC+1) — format supposé (question DGI n° 5). */
function kinshasaDateTime(at: Date): string {
  const d = new Date(at.getTime() + 3_600_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json',
): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(JSON.stringify(body));
}

function serverError(res: ServerResponse): void {
  sendJson(res, 500, { title: 'Internal Server Error', status: 500 });
}

function businessError(res: ServerResponse, code: string, desc: string): void {
  sendJson(res, 200, { uid: null, errorCode: code, errorDesc: desc });
}

function pendingFull(res: ServerResponse): void {
  businessError(res, '1', 'Trop de demandes en attente sur cet e-MCF (faux serveur).');
}

function duplicate(res: ServerResponse, rn: string, uid: string): void {
  businessError(
    res,
    '63',
    `Une demande de numéro '${rn}' est déjà en attente, uid '${uid}' (faux serveur).`,
  );
}

function unknownOrFinalized(res: ServerResponse): void {
  businessError(res, '20', 'Demande inconnue, déjà finalisée, annulée ou expirée (faux serveur).');
}

/** Ne répond jamais : la connexion reste ouverte jusqu'au délai du client ou à `close()`. */
function hang(_res: ServerResponse): void {
  // Volontairement vide.
}

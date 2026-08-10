// ─────────────────────────────────────────────────────────────────────────────
// STOCKAGE OBJET — service GÉNÉRIQUE (S3 / MinIO / Spaces)
//
// Ce service ne connaît ni les avatars, ni les exports, ni les instantanés. Il
// connaît trois verbes sur un couple (bucket, clé). C'est délibéré : docs/24
// prévoit exactement les mêmes besoins pour `S3_BUCKET_EXPORTS` et
// `S3_BUCKET_SNAPSHOTS`, et un « AvatarStorageService » obligerait à tout
// réécrire au premier export.
//
// Ce qu'il ne fait PAS, et pourquoi :
//   - pas d'upload multipart : réservé aux objets > 5 Gio, hors de portée d'un
//     lot dont la charge maximale est de 2 Mio ;
//   - pas de listing de bucket : aucun besoin, et une énumération est
//     précisément la capacité qu'on ne veut pas rendre facile à appeler ;
//   - pas de création de bucket : `docker-compose.yml` (service `minio-init`)
//     et le provisioning Spaces s'en chargent. Créer un bucket depuis le
//     runtime applicatif donnerait à l'API des droits d'administration dont
//     elle n'a pas besoin.
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';

import { encodeS3Path, signV4 } from './sigv4.js';
import {
  resolveStorageConfig,
  type StorageAvailability,
  type StorageConfig,
} from './storage.config.js';

/** Levée quand le stockage est joignable mais refuse ou échoue. */
export class ObjectStorageError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ObjectStorageError';
  }
}

/** Levée quand `S3_*` est incomplet — l'API n'a jamais tenté d'appel. */
export class ObjectStorageUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ObjectStorageUnavailableError';
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string | null;
}

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);

  /** Délai de garde : sans lui, un MinIO injoignable fige la requête HTTP. */
  private readonly timeoutMs = 15_000;

  availability(): StorageAvailability {
    return resolveStorageConfig();
  }

  /** Nom du bucket des uploads, ou `null` si le stockage n'est pas configuré. */
  uploadsBucket(): string | null {
    const a = this.availability();
    return a.available ? a.config.bucketUploads : null;
  }

  async putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.send('PUT', bucket, key, { body, contentType });
    if (!res.ok) {
      throw new ObjectStorageError(
        `Écriture de l'objet refusée par le stockage (HTTP ${res.status}).`,
        res.status,
      );
    }
  }

  /** `null` quand l'objet n'existe pas — un 404 n'est pas une panne. */
  async getObject(bucket: string, key: string): Promise<StoredObject | null> {
    const res = await this.send('GET', bucket, key, {});
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ObjectStorageError(
        `Lecture de l'objet refusée par le stockage (HTTP ${res.status}).`,
        res.status,
      );
    }
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type'),
    };
  }

  /**
   * Suppression IDEMPOTENTE : S3 répond `204` que l'objet ait existé ou non.
   *
   * C'est ce qui permet à « retirer ma photo » de rester réparateur — un
   * enregistrement pointant vers un objet déjà disparu doit pouvoir être nettoyé
   * sans que l'utilisateur reste bloqué avec une photo qu'il ne peut pas retirer.
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    const res = await this.send('DELETE', bucket, key, {});
    if (!res.ok && res.status !== 404) {
      throw new ObjectStorageError(
        `Suppression de l'objet refusée par le stockage (HTTP ${res.status}).`,
        res.status,
      );
    }
  }

  private async send(
    method: 'GET' | 'PUT' | 'DELETE',
    bucket: string,
    key: string,
    opts: { body?: Buffer; contentType?: string },
  ): Promise<Response> {
    const availability = this.availability();
    if (!availability.available) throw new ObjectStorageUnavailableError(availability.reason);
    const cfg = availability.config;

    const { url, host, path } = this.addressOf(cfg, bucket, key);
    const headers = signV4({
      method,
      host,
      path,
      region: cfg.region,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      body: opts.body,
      contentType: opts.contentType,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers,
        // `undici` accepte un Buffer tel quel ; les typages de ce projet
        // n'embarquent pas la lib DOM qui déclarerait `BodyInit`.
        body: opts.body as never,
        signal: controller.signal,
      });
    } catch (cause) {
      // La clé N'EST PAS journalisée : elle est le jeton d'accès à l'objet
      // (docs/17 § Journalisation — « aucun token […] ne doit apparaître »).
      this.logger.warn(
        `Stockage objet injoignable (${method} ${bucket}) : ${(cause as Error).message}`,
      );
      throw new ObjectStorageError('Stockage objet injoignable.', null);
    } finally {
      clearTimeout(timer);
    }
  }

  private addressOf(
    cfg: StorageConfig,
    bucket: string,
    key: string,
  ): { url: string; host: string; path: string } {
    const base = new URL(cfg.endpoint);
    const segments = key.split('/');
    const host = cfg.forcePathStyle ? base.host : `${bucket}.${base.host}`;
    const path = cfg.forcePathStyle ? encodeS3Path([bucket, ...segments]) : encodeS3Path(segments);
    return { url: `${base.protocol}//${host}${path}`, host, path };
  }
}

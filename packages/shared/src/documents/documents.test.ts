import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_DEFAULT_FOLDERS,
  DOCUMENT_FILE_TYPES,
  DOCUMENT_LIMITS,
  DOCUMENT_LINK_ENTITY_TYPES,
  DocumentFolderAccessSchema,
  DocumentLinksSchema,
  DocumentListQuerySchema,
  DocumentSearchBodySchema,
  DocumentTagsSchema,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

const ID = 'a'.repeat(24);

describe('bibliothèque — constantes (ADR-0046 § 4)', () => {
  it('liens : sept natures d’entité, jamais `employee` (O5)', () => {
    expect(DOCUMENT_LINK_ENTITY_TYPES).toHaveLength(7);
    expect(DOCUMENT_LINK_ENTITY_TYPES as readonly string[]).not.toContain('employee');
  });

  it('PDF et images seulement ; borne commune de 1 Gio ; 30 envois par heure', () => {
    expect([...DOCUMENT_FILE_TYPES]).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
    ]);
    expect(DOCUMENT_LIMITS.storagePerOrganizationBytes).toBe(1024 ** 3);
    expect(DOCUMENT_LIMITS.uploadsPerHourPerUser).toBe(30);
    expect(DOCUMENT_LIMITS.folderDepth).toBe(5);
  });

  it('« Fiscal et administratif » est réservé à `treasury.read`', () => {
    expect(DOCUMENT_DEFAULT_FOLDERS.find((f) => f.readAction !== null)).toEqual({
      name: 'Fiscal et administratif',
      readAction: 'treasury.read',
    });
  });
});

describe('bibliothèque — briques de schéma', () => {
  it('étiquettes normalisées, dédoublonnées, dix au plus', () => {
    expect(DocumentTagsSchema.parse(['  Bail  Gombe ', 'bail gombe', 'DGI'])).toEqual([
      'bail gombe',
      'dgi',
    ]);
    expect(codes(DocumentTagsSchema.safeParse(['']))).toEqual(['DOCUMENT_TAG_INVALID']);
    expect(
      codes(DocumentTagsSchema.safeParse(Array.from({ length: 11 }, (_, i) => `t${i}`))),
    ).toEqual(['DOCUMENT_TAGS_TOO_MANY']);
  });

  it('liens sans doublon, entité connue', () => {
    expect(
      codes(
        DocumentLinksSchema.safeParse([
          { entityType: 'supplier', entityId: ID },
          { entityType: 'supplier', entityId: ID.toUpperCase() },
        ]),
      ),
    ).toEqual(['DOCUMENT_LINK_DUPLICATE']);
    expect(DocumentLinksSchema.safeParse([{ entityType: 'employee', entityId: ID }]).success).toBe(
      false,
    );
  });

  it('droits d’un dossier : trois règles de lecture, héritage par défaut', () => {
    expect(DocumentFolderAccessSchema.parse({ read: 'all', write: 'managers' })).toEqual({
      read: 'all',
      write: 'managers',
      inherit: true,
    });
    expect(
      DocumentFolderAccessSchema.parse({
        read: { action: 'treasury.read' },
        write: { userIds: ['u1', 'u1'] },
        inherit: false,
      }),
    ).toEqual({ read: { action: 'treasury.read' }, write: { userIds: ['u1'] }, inherit: false });
    expect(
      DocumentFolderAccessSchema.safeParse({ read: { userIds: [] }, write: 'managers' }).success,
    ).toBe(false);
    expect(
      codes(
        DocumentFolderAccessSchema.safeParse({ read: { action: 'Tresor' }, write: 'managers' }),
      ),
    ).toEqual(['FOLDER_ACTION_INVALID']);
  });

  it('§ 4.3 — la requête GET ne prend que des identifiants : un titre est refusé', () => {
    expect(
      DocumentListQuerySchema.safeParse({ entityType: 'supplier', entityId: ID }).success,
    ).toBe(true);
    expect(DocumentListQuerySchema.safeParse({ title: 'Statuts' }).success).toBe(false);
    expect(DocumentListQuerySchema.safeParse({ q: 'Statuts' }).success).toBe(false);
    expect(codes(DocumentListQuerySchema.safeParse({ entityType: 'supplier' }))).toEqual([
      'DOCUMENT_ENTITY_INCOMPLETE',
    ]);
  });

  it('§ 4.3 — la recherche passe par un corps strict', () => {
    expect(
      DocumentSearchBodySchema.parse({
        text: ' attestation ',
        tags: ['DGI'],
        nature: 'certificate',
      }),
    ).toEqual({ text: 'attestation', tags: ['dgi'], nature: 'certificate' });
    expect(DocumentSearchBodySchema.safeParse({ content: 'x' }).success).toBe(false);
    expect(
      codes(
        DocumentSearchBodySchema.safeParse({ expiresFrom: '2026-12-31', expiresTo: '2026-01-01' }),
      ),
    ).toEqual(['INVALID_RANGE']);
  });
});

// Test unitaire du contrôleur /ai/corrective-actions (S14a — agent D).
// Le service est mocké pour éviter toute dépendance à OpenAI.

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService } from './ai-actions.service.js';

function makeController(svcOverrides: Partial<AiActionsService> = {}): AiActionsController {
  const svc = {
    correctiveActions: vi.fn().mockResolvedValue({ actions: [], source: 'fallback' }),
    ...svcOverrides,
  } as unknown as AiActionsService;
  return new AiActionsController(svc);
}

describe('AiActionsController', () => {
  it('400 si le payload est invalide', async () => {
    const controller = makeController();
    await expect(controller.corrective({ templateSlug: '', lines: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('délègue au service et retourne son résultat', async () => {
    const controller = makeController({
      correctiveActions: vi.fn().mockResolvedValue({
        actions: [
          {
            ratio: 'dscr',
            severity: 'rouge',
            suggestion: 's',
            expected_impact: 'i',
          },
        ],
        source: 'fallback',
      }),
    });
    const res = await controller.corrective({
      templateSlug: 'x',
      drivers: {},
      lines: [
        {
          sheetId: 'ratios',
          lineId: 'dscr',
          label: 'DSCR',
          value: 0.9,
          format: 'number',
          seuil: { valeur: 1.25, direction: 'min', statut: 'rouge' },
        },
      ],
    });
    expect(res.actions).toHaveLength(1);
    expect(res.source).toBe('fallback');
  });
});

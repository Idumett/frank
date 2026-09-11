import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';
import { LocationContextV1Schema } from './contextSnapshotV1.js';

export const ProductActionKindV1Schema = z.enum([
  'none',
  'save_current_place',
  'update_saved_place',
  'delete_saved_place',
  'list_saved_places',
  'save_current_hazard',
  'resolve_hazard',
  'list_hazards',
  'where_am_i',
  'whats_nearby',
  'lost_assistance',
  'save_personal_memory',
  'delete_personal_memory',
]);

export const PersonalMemoryKindV1Schema = z.enum([
  'preference',
  'personal_fact',
  'routine',
  'accessibility_preference',
]);

export const ProductActionProposalV1Schema = z
  .object({
    schemaVersion: z.literal('1'),
    action: ProductActionKindV1Schema,
    placeName: z.string().trim().min(1).max(80).optional(),
    newPlaceName: z.string().trim().min(1).max(80).optional(),
    hazardType: z
      .enum(['pothole', 'uneven_surface', 'obstruction', 'roadworks', 'other'])
      .optional(),
    description: z.string().trim().min(1).max(300).optional(),
    memoryKind: PersonalMemoryKindV1Schema.optional(),
    memorySubject: z.string().trim().min(1).max(80).optional(),
    memoryValue: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (
      ['update_saved_place', 'delete_saved_place'].includes(
        proposal.action,
      ) &&
      !proposal.placeName
    ) {
      ctx.addIssue({ code: 'custom', path: ['placeName'], message: 'A place name is required' });
    }
    if (proposal.action === 'save_current_hazard' && !proposal.hazardType) {
      ctx.addIssue({ code: 'custom', path: ['hazardType'], message: 'A hazard type is required' });
    }
    if (
      ['save_personal_memory', 'delete_personal_memory'].includes(proposal.action) &&
      (!proposal.memoryKind || !proposal.memorySubject ||
        (proposal.action === 'save_personal_memory' && !proposal.memoryValue))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['memorySubject'],
        message: 'A personal memory kind, subject and value are required',
      });
    }
  });

const pendingBase = z.object({
  schemaVersion: z.literal('1'),
  ownerId: z.string().min(1).max(200),
  requestId: z.string().min(8).max(200),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
});

export const PendingProductActionV1Schema = z.discriminatedUnion('kind', [
  pendingBase.extend({
    kind: z.literal('name_place'),
    location: LocationContextV1Schema,
    capturedAt: IsoDateTimeSchema,
  }),
  pendingBase.extend({
    kind: z.literal('save_place'),
    name: z.string().trim().min(1).max(80),
    location: LocationContextV1Schema,
    capturedAt: IsoDateTimeSchema,
  }),
  pendingBase.extend({
    kind: z.literal('save_hazard'),
    hazardType: z.enum(['pothole', 'uneven_surface', 'obstruction', 'roadworks', 'other']),
    description: z.string().trim().min(1).max(300),
    location: LocationContextV1Schema,
    capturedAt: IsoDateTimeSchema,
  }),
  pendingBase.extend({
    kind: z.literal('delete'),
    entityType: z.enum(['known_place', 'hazard']),
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(300),
  }),
  pendingBase.extend({
    kind: z.literal('rename'),
    placeId: z.string().min(1).max(200),
    oldName: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
  }),
  pendingBase.extend({
    kind: z.literal('relocate'),
    placeId: z.string().min(1).max(200),
    placeName: z.string().min(1).max(80),
    location: LocationContextV1Schema,
    capturedAt: IsoDateTimeSchema,
  }),
  pendingBase.extend({
    kind: z.literal('resolve'),
    hazardId: z.string().min(1).max(200),
    description: z.string().min(1).max(300),
  }),
]);

export type ProductActionProposalV1 = z.infer<typeof ProductActionProposalV1Schema>;
export type PendingProductActionV1 = z.infer<typeof PendingProductActionV1Schema>;

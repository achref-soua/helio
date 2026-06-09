import { z } from 'zod';

/** The kind of support ticket a user can file from inside the app. */
export const SUPPORT_KINDS = ['BUG', 'FEEDBACK', 'QUESTION'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];
export const supportKindSchema = z.enum(SUPPORT_KINDS);

/** Lifecycle status of a ticket. */
export const SUPPORT_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const supportStatusSchema = z.enum(SUPPORT_STATUSES);

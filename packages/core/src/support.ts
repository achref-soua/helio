import { z } from 'zod';

/** The kind of bug report / feedback a user can file from inside the app. */
export const SUPPORT_KINDS = ['BUG', 'FEEDBACK', 'QUESTION'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];
export const supportKindSchema = z.enum(SUPPORT_KINDS);

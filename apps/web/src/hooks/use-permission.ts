'use client';

import { can, type Permission } from '@helio/core';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from '@/trpc/client';

/**
 * Client-side view of the permission matrix — for hiding nav entries and
 * buttons the server would refuse anyway. The server check (every router
 * calls requirePermission) stays authoritative; this is purely UX.
 *
 * `allowed` is false while the role is still loading, so gated UI appears
 * rather than disappears.
 */
export function usePermission(permission: Permission): {
  allowed: boolean;
  role: string | null;
} {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.me.queryOptions());
  const role = data?.memberRole ?? null;
  return { allowed: role !== null && can(role, permission), role };
}

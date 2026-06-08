'use client';

import { Button } from '@helio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helio/ui/components/dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Layers } from 'lucide-react';

import { useWorkspaceStore } from '@/stores/workspace';
import { useTRPC } from '@/trpc/client';

/** Returns the effective workspace id: the stored pick or the first workspace. */
export function useActiveWorkspaceId(): string | null {
  const trpc = useTRPC();
  const { workspaceId } = useWorkspaceStore();
  const { data } = useQuery(trpc.workspace.list.queryOptions());
  if (workspaceId && data?.some((workspace) => workspace.id === workspaceId)) return workspaceId;
  return data?.[0]?.id ?? null;
}

export function WorkspaceSwitcher() {
  const trpc = useTRPC();
  const { data: workspaces } = useQuery(trpc.workspace.list.queryOptions());
  const { setWorkspaceId } = useWorkspaceStore();
  const activeId = useActiveWorkspaceId();
  const active = workspaces?.find((workspace) => workspace.id === activeId);
  if (!workspaces || workspaces.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Layers aria-hidden className="size-4" />
          {active?.name ?? '…'}
          <ChevronDown aria-hidden className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onClick={() => setWorkspaceId(workspace.id)}>
            {workspace.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

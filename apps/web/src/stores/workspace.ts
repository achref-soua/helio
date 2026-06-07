import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  /** Selected workspace id; null until the user picks (UI falls back to the first workspace). */
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist((set) => ({ workspaceId: null, setWorkspaceId: (id) => set({ workspaceId: id }) }), {
    name: 'helio.workspace',
  }),
);

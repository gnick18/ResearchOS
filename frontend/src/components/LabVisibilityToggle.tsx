"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "@/lib/local-api";

interface LabVisibilityToggleProps {
  username: string;
}

/**
 * Tiny inline toggle for the current user's lab-mode goal visibility (#14).
 * Stored in users/_user_metadata.json via usersApi.setHideGoalsFromLab.
 */
export default function LabVisibilityToggle({ username }: LabVisibilityToggleProps) {
  const queryClient = useQueryClient();

  const { data: hidden = false } = useQuery({
    queryKey: ["users", "hide-goals-from-lab", username],
    queryFn: () => usersApi.getHideGoalsFromLab(username),
    enabled: !!username,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: (hide: boolean) => usersApi.setHideGoalsFromLab(username, hide),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["users", "hide-goals-from-lab", username],
      });
      // Lab roadmaps cache reads this; bust it so lab mode reflects the change.
      queryClient.invalidateQueries({ queryKey: ["lab", "goals"] });
    },
  });

  if (!username) return null;

  return (
    <label
      className="inline-flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none"
      title="When checked, your high-level goals won't appear in Lab Mode for other users."
    >
      <input
        type="checkbox"
        checked={hidden}
        onChange={(e) => mutation.mutate(e.target.checked)}
        disabled={mutation.isPending}
        className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0"
      />
      <span>Hide my goals from Lab Mode</span>
    </label>
  );
}

// Reports a failed mutation that has no error message of its own. Without
// this, an IPC call that rejects leaves the UI as it was and says nothing, so
// the user cannot tell the action failed (#267).
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/i18n/I18nProvider";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** The mutation shows its own error message; skip the generic toast. */
      reportsOwnError?: boolean;
    };
  }
}

// A subscription rather than MutationCache's onError option: the message is
// translated, and the QueryClient is created outside the I18nProvider.
export function useMutationErrorNotifier(): void {
  const { t } = useI18n();
  const qc = useQueryClient();

  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        if (event.mutation.meta?.reportsOwnError) return;
        // The cache holds every mutation, so the error is typed as `any`.
        const error: unknown = event.action.error;
        toast.error(t("common.actionFailed"), {
          description: error instanceof Error ? error.message : String(error),
        });
      }),
    [qc, t],
  );
}

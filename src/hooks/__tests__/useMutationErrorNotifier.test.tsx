// A mutation that fails is reported once: by the generic toast, unless it
// says it reports its own error (#267).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  type MutationMeta,
} from "@tanstack/react-query";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useMutationErrorNotifier } from "@/hooks/useMutationErrorNotifier";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}

function renderMutation(mutationFn: () => Promise<void>, meta?: MutationMeta) {
  return renderHook(
    () => {
      useMutationErrorNotifier();
      return useMutation({ mutationFn, meta });
    },
    { wrapper },
  );
}

beforeEach(() => toastError.mockReset());

describe("useMutationErrorNotifier", () => {
  it("reports a failed mutation with the error's message", async () => {
    const { result } = renderMutation(() =>
      Promise.reject(new Error("database is locked")),
    );
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Could not complete the action", {
      description: "database is locked",
    });
  });

  it("reports once when the mutation fails after a retry", async () => {
    const mutationFn = vi.fn(() => Promise.reject(new Error("busy")));
    const { result } = renderHook(
      () => {
        useMutationErrorNotifier();
        return useMutation({ mutationFn, retry: 1, retryDelay: 0 });
      },
      { wrapper },
    );
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a mutation that reports its own error", async () => {
    const { result } = renderMutation(() => Promise.reject(new Error("no")), {
      reportsOwnError: true,
    });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stays silent when the mutation succeeds", async () => {
    const { result } = renderMutation(() => Promise.resolve());
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastError).not.toHaveBeenCalled();
  });
});

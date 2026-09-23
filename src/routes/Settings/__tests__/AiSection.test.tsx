// The AI settings tab. Its job is to explain a folder the user fills in by
// hand, and to make the two destructive moves — switching models, re-tagging
// the library — deliberate ones.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AiStatus } from "@shared/ipc/schema";
import { AiSection } from "@/routes/Settings/AiSection";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  /** Set by the mocked events module so a test can push an ai:progress event. */
  emitProgress: { fn: null as ((p: unknown) => void) | null },
  aiStatus: vi.fn(),
  aiModelSelect: vi.fn(),
  aiSettingsSet: vi.fn(),
  aiIndexStart: vi.fn(),
  aiModelsOpen: vi.fn(),
  aiJobCancel: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    aiStatus: (): Promise<unknown> => mocks.aiStatus() as Promise<unknown>,
    aiModelSelect: (id: string | null): Promise<number> =>
      mocks.aiModelSelect(id) as Promise<number>,
    aiSettingsSet: (patch: unknown): Promise<unknown> =>
      mocks.aiSettingsSet(patch) as Promise<unknown>,
    aiIndexStart: (retagOnly?: boolean): Promise<void> =>
      mocks.aiIndexStart(retagOnly) as Promise<void>,
    aiModelsOpen: (): Promise<void> => mocks.aiModelsOpen() as Promise<void>,
    aiJobCancel: (): Promise<void> => mocks.aiJobCancel() as Promise<void>,
  },
  events: {
    onAiProgress: (cb: (p: unknown) => void) => {
      mocks.emitProgress.fn = cb;
      return Promise.resolve(() => {
        mocks.emitProgress.fn = null;
      });
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: string): void => {
      mocks.toastSuccess(m);
    },
  },
}));

const MODEL = {
  id: "clip-vit-base-patch32:",
  name: "clip-vit-base-patch32",
  variant: "",
  dim: 512,
  bytes: 350 * 1024 * 1024,
  installedAt: 1,
};

function status(patch: Partial<AiStatus> = {}): AiStatus {
  return {
    modelsDir: "/home/u/.config/Meguri/models",
    models: [MODEL],
    activeModelId: MODEL.id,
    settings: {
      vocabulary: ["cat", "beach"],
      threshold: 0.3,
      autoIndex: false,
    },
    backends: ["cpu"],
    activeBackend: "cpu",
    job: null,
    pending: 0,
    retagPending: false,
    ...patch,
  };
}

async function renderSection(s: AiStatus = status()) {
  mocks.aiStatus.mockResolvedValue(s);
  renderWithProviders(<AiSection />);
  await screen.findByText(s.modelsDir);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aiModelSelect.mockResolvedValue(0);
  mocks.aiSettingsSet.mockResolvedValue({
    vocabulary: ["cat", "beach"],
    threshold: 0.3,
    autoIndex: false,
  });
  mocks.aiIndexStart.mockResolvedValue(undefined);
});

describe("the models folder", () => {
  it("shows the path and opens it, since nothing else reveals where it is", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Open folder/i }));
    expect(mocks.aiModelsOpen).toHaveBeenCalled();
  });

  it("says what to put there when the folder is empty", async () => {
    await renderSection(status({ models: [], activeModelId: null }));
    expect(screen.getByText(/No models found/i)).toBeTruthy();
    // Nothing to configure without a model: the vocabulary stays hidden.
    expect(screen.queryByLabelText("Tag vocabulary")).toBeNull();
  });

  it("lists a model with its variant, width and size", async () => {
    await renderSection();
    expect(screen.getByText("clip-vit-base-patch32")).toBeTruthy();
    expect(screen.getByText(/fp32 · 512d · 350.0 MB/)).toBeTruthy();
  });
});

describe("switching models", () => {
  async function confirmTurnOff() {
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    // The warning names the consequence before anything is deleted.
    expect(await screen.findByText(/deletes every tag it added/i)).toBeTruthy();
    // Two buttons read "Turn off" now — the row's and the dialog's; the
    // dialog's is the last one rendered.
    const buttons = screen.getAllByRole("button", { name: "Turn off" });
    fireEvent.click(buttons[buttons.length - 1]);
  }

  it("asks first, and reports how many tags the switch dropped", async () => {
    mocks.aiModelSelect.mockResolvedValue(42);
    await renderSection();
    await confirmTurnOff();

    await waitFor(() => expect(mocks.aiModelSelect).toHaveBeenCalledWith(null));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Removed 42 AI tags."),
    );
  });

  it("says nothing when the switch dropped no tags", async () => {
    mocks.aiModelSelect.mockResolvedValue(0);
    await renderSection();
    await confirmTurnOff();
    await waitFor(() => expect(mocks.aiModelSelect).toHaveBeenCalled());
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("shows why a switch failed instead of swallowing it", async () => {
    mocks.aiModelSelect.mockRejectedValue(new Error("a job is running"));
    await renderSection();
    await confirmTurnOff();
    expect(await screen.findByText("a job is running")).toBeTruthy();
  });

  it("does nothing when the confirmation is declined", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(mocks.aiModelSelect).not.toHaveBeenCalled());
  });
});

describe("vocabulary and threshold", () => {
  it("keeps edits local until saved, and only then sends them", async () => {
    await renderSection();
    const box = screen.getByLabelText("Tag vocabulary");
    expect((box as HTMLTextAreaElement).value).toBe("cat\nbeach");

    fireEvent.change(box, { target: { value: "cat\nbeach\nsunset" } });
    // A keystroke is not a save: re-tagging the library is too heavy for that.
    expect(mocks.aiSettingsSet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.aiSettingsSet).toHaveBeenCalledWith({
        vocabulary: ["cat", "beach", "sunset"],
        threshold: 0.3,
      }),
    );
  });

  it("reports a rejected save rather than looking like nothing happened", async () => {
    mocks.aiSettingsSet.mockRejectedValue(new Error("Invalid IPC payload"));
    await renderSection();
    fireEvent.change(screen.getByLabelText("Tag vocabulary"), {
      target: { value: "cat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Invalid IPC payload")).toBeTruthy();
  });

  it("drops blank lines and over-long entries before sending them", async () => {
    await renderSection();
    fireEvent.change(screen.getByLabelText("Tag vocabulary"), {
      target: { value: `cat\n\n  \n${"x".repeat(100)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = mocks.aiSettingsSet.mock.calls[0][0] as {
        vocabulary: string[];
      };
      expect(patch.vocabulary).toEqual(["cat", "x".repeat(64)]);
    });
  });

  it("saves the threshold the slider was left at", async () => {
    await renderSection();
    fireEvent.change(screen.getByLabelText("Threshold"), {
      target: { value: "0.55" },
    });
    expect(screen.getByText("0.55")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.aiSettingsSet).toHaveBeenCalledWith({
        vocabulary: ["cat", "beach"],
        threshold: 0.55,
      }),
    );
  });

  it("blocks indexing while there are unsaved edits", async () => {
    await renderSection(status({ pending: 5 }));
    fireEvent.change(screen.getByLabelText("Tag vocabulary"), {
      target: { value: "cat" },
    });
    expect(
      screen.getByRole("button", { name: /Analyze new files/i }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Re-tag/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says the tags are out of date without changing them on its own", async () => {
    await renderSection(status({ retagPending: true }));
    expect(screen.getByText(/not in the tags yet/i)).toBeTruthy();
    expect(mocks.aiIndexStart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Re-tag/i }));
    await waitFor(() => expect(mocks.aiIndexStart).toHaveBeenCalledWith(true));
  });
});

describe("indexing", () => {
  it("offers to analyze only while something is pending", async () => {
    await renderSection(status({ pending: 0 }));
    expect(screen.getByText(/Every file has been analyzed/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Analyze new files/i }),
    ).toHaveProperty("disabled", true);
  });

  it("starts an embed run and shows the progress of a running job", async () => {
    await renderSection(status({ pending: 12 }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze new files/i }));
    await waitFor(() => expect(mocks.aiIndexStart).toHaveBeenCalledWith(false));
  });

  it("follows the job reported on ai:progress over the cached status", async () => {
    await renderSection(status({ pending: 4 }));
    expect(
      screen.getByRole("button", { name: /Analyze new files/i }),
    ).toBeTruthy();

    // A job started elsewhere (auto-index after a scan) takes over the row…
    act(() => {
      mocks.emitProgress.fn?.({
        job: {
          kind: "index",
          label: "embed",
          done: 2,
          total: 4,
          workspaceId: "w",
        },
      });
    });
    expect(await screen.findByText("2 / 4")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Analyze new files/i }),
    ).toBeNull();

    // …and its end hands the buttons back.
    act(() => mocks.emitProgress.fn?.({ job: null }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Analyze new files/i }),
      ).toBeTruthy(),
    );
  });

  it("shows the reason a job failed", async () => {
    await renderSection();
    act(() => mocks.emitProgress.fn?.({ job: null, error: "no active model" }));
    expect(await screen.findByText(/Failed: no active model/)).toBeTruthy();
  });

  it("replaces the run buttons with a stop button while a job runs", async () => {
    await renderSection(
      status({
        pending: 3,
        job: {
          kind: "index",
          label: "embed",
          done: 1,
          total: 3,
          workspaceId: "w",
        },
      }),
    );
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(mocks.aiJobCancel).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Analyze new files/i }),
    ).toBeNull();
  });
});

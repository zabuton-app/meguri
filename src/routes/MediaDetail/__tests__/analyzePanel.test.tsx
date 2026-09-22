// The per-file AI panel, and the strip of neighbours under it. The panel
// reports what the model recognized and lets the user keep some of it — as
// manual tags on this file, or in the vocabulary so every file is scored
// against it from then on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { AiCandidate, TagInfo } from "@shared/ipc/schema";
import { useI18n } from "@/i18n/I18nProvider";
import { AnalyzePanel } from "@/routes/MediaDetail/AnalyzePanel";
import { SimilarFiles } from "@/routes/MediaDetail/SimilarFiles";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  aiAnalyzeFile: vi.fn(),
  aiVocabularyAdd: vi.fn(),
  aiSimilar: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    aiAnalyzeFile: (id: number, ws: string): Promise<unknown> =>
      mocks.aiAnalyzeFile(id, ws) as Promise<unknown>,
    aiVocabularyAdd: (entries: string[]): Promise<unknown> =>
      mocks.aiVocabularyAdd(entries) as Promise<unknown>,
    aiSimilar: (id: number, ws: string, limit?: number): Promise<unknown> =>
      mocks.aiSimilar(id, ws, limit) as Promise<unknown>,
  },
  events: {},
}));

function candidate(
  entry: string,
  score: number,
  inVocabulary = false,
): AiCandidate {
  return { entry, score, similarity: score, inVocabulary };
}

// The panel pre-ticks the top three, so "lamp" starts unticked.
const CANDIDATES = [
  candidate("cat", 0.4),
  candidate("indoor", 0.2, true),
  candidate("sofa", 0.1),
  candidate("lamp", 0.05),
];

function tag(name: string): TagInfo {
  return { id: 1, name, namespace: "", source: "manual", score: null };
}

function Panel({
  tags,
  onAdd,
}: {
  tags: TagInfo[];
  onAdd: (name: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  return <AnalyzePanel id={7} wsId="ws" tags={tags} onAdd={onAdd} t={t} />;
}

function renderPanel(tags: TagInfo[] = []) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<Panel tags={tags} onAdd={onAdd} />);
  return { onAdd };
}

/** Render, run one analysis, and wait for the list. */
async function analyzed(tags: TagInfo[] = []) {
  const handles = renderPanel(tags);
  fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await screen.findByText("cat");
  return handles;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aiAnalyzeFile.mockResolvedValue(CANDIDATES);
  mocks.aiVocabularyAdd.mockResolvedValue(["cat"]);
  mocks.aiSimilar.mockResolvedValue([]);
});

describe("AnalyzePanel", () => {
  it("analyzes only when asked, since it decodes the file to do it", () => {
    renderPanel();
    expect(mocks.aiAnalyzeFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeTruthy();
  });

  it("lists what the model recognized, with its confidence", async () => {
    await analyzed();
    expect(mocks.aiAnalyzeFile).toHaveBeenCalledWith(7, "ws");
    expect(screen.getByText("40%")).toBeTruthy();
    // Entries the vocabulary already covers are marked, not hidden: they are
    // still evidence of what the model saw.
    expect(screen.getByText("in vocabulary")).toBeTruthy();
  });

  it("adds the ticked entries as manual tags, and only those", async () => {
    const { onAdd } = await analyzed();
    fireEvent.click(screen.getByRole("button", { name: /Add \d+ as tags/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(3));
    expect(onAdd.mock.calls.map((c) => c[0] as string).sort()).toEqual([
      "cat",
      "indoor",
      "sofa",
    ]);
    // Unticked, so it stays off the file.
    expect(onAdd).not.toHaveBeenCalledWith("lamp");
  });

  it("takes an entry ticked by hand too", async () => {
    const { onAdd } = await analyzed();
    fireEvent.click(screen.getByRole("checkbox", { name: /lamp/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add \d+ as tags/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("lamp"));
  });

  it("forgets the previous file's candidates when the file changes", async () => {
    // What index.tsx does with its key: one file's candidates must never be
    // offered as tags for the next one.
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderWithProviders(
      <Panel key="ws:7" tags={[]} onAdd={onAdd} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("cat");

    rerender(<Panel key="ws:8" tags={[]} onAdd={onAdd} />);
    expect(screen.queryByText("cat")).toBeNull();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeTruthy();
  });

  it("shows why adding to the vocabulary failed", async () => {
    mocks.aiVocabularyAdd.mockRejectedValue(new Error("config is read-only"));
    await analyzed();
    fireEvent.click(
      screen.getByRole("button", { name: /Add \d+ to vocabulary/ }),
    );
    expect(await screen.findByText("config is read-only")).toBeTruthy();
  });

  it("does not offer a tag the file already carries", async () => {
    await analyzed([tag("cat")]);
    const box = screen.getByRole("checkbox", { name: /cat/ });
    expect(box).toHaveProperty("disabled", true);
    expect(box).toHaveProperty("checked", true);
    expect(screen.getByText("added")).toBeTruthy();
  });

  it("adds to the vocabulary only what is not in it already", async () => {
    await analyzed();
    fireEvent.click(
      screen.getByRole("button", { name: /Add \d+ to vocabulary/ }),
    );
    await waitFor(() => expect(mocks.aiVocabularyAdd).toHaveBeenCalled());
    const sent = mocks.aiVocabularyAdd.mock.calls[0][0] as string[];
    expect(sent).toContain("cat");
    // "indoor" is ticked by default but already in the vocabulary.
    expect(sent).not.toContain("indoor");
  });

  it("says so when the model recognized nothing", async () => {
    mocks.aiAnalyzeFile.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Nothing was recognized.")).toBeTruthy();
  });

  it("shows why the analysis failed", async () => {
    mocks.aiAnalyzeFile.mockRejectedValue(
      new Error("could not decode the file"),
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("could not decode the file")).toBeTruthy();
  });
});

describe("SimilarFiles", () => {
  function Wrapper() {
    const { t } = useI18n();
    return (
      <SimilarFiles id={7} wsId="ws" mediaBase="http://127.0.0.1:1" t={t} />
    );
  }

  it("links to each neighbour and shows how close it is", async () => {
    mocks.aiSimilar.mockResolvedValue([
      { workspaceId: "ws", id: 9, score: 0.91 },
      { workspaceId: "other", id: 3, score: 0.74 },
    ]);
    renderWithProviders(<Wrapper />);
    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("/file/9");
    expect(screen.getByText("91")).toBeTruthy();
    // A neighbour in another workspace keeps its own workspace in the link.
    expect(links[1].getAttribute("href")).toContain("other");
  });

  it("reads an empty result as a file that has not been analyzed", async () => {
    renderWithProviders(<Wrapper />);
    expect(await screen.findByText("Not analyzed yet.")).toBeTruthy();
  });

  it("is refetched once an analysis has given the file a vector", async () => {
    function Both() {
      const { t } = useI18n();
      return (
        <>
          <AnalyzePanel
            id={7}
            wsId="ws"
            tags={[]}
            onAdd={vi.fn().mockResolvedValue(undefined)}
            t={t}
          />
          <SimilarFiles id={7} wsId="ws" mediaBase="http://127.0.0.1:1" t={t} />
        </>
      );
    }
    renderWithProviders(<Both />);
    expect(await screen.findByText("Not analyzed yet.")).toBeTruthy();

    // The analysis stores the embedding this list needs, so the empty answer
    // it cached a moment ago must not survive it.
    mocks.aiSimilar.mockResolvedValue([
      { workspaceId: "ws", id: 9, score: 0.8 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("80")).toBeTruthy();
  });
});

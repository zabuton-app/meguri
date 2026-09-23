// Settings: on-device AI. Nothing is bundled and nothing is downloaded — the
// user puts a model directory into the models folder, so much of this screen is
// about that folder: where it is, what was found in it, and what the model is
// allowed to tag.
//
// Two things here are destructive and deliberately not automatic: switching
// models clears the tags of the model being left, and a re-tag pass rewrites
// every AI tag in the library. Both are behind a press, and the second is only
// ever suggested.
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AiJobProgress } from "@/components/AiJobProgress";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import { useAiProgress, useAiStatus } from "@/hooks/useAiStatus";
import {
  AI_THRESHOLD_MAX,
  AI_THRESHOLD_MIN,
  MAX_AI_VOCABULARY,
  MAX_AI_VOCABULARY_ENTRY,
} from "@shared/ipc/schema";
import { AiModelList } from "./AiModelList";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * What the textarea holds, as the IPC layer will accept it. Clamped here rather
 * than left to fail validation in main: a pasted paragraph is a plausible
 * mistake, and "Save does nothing" is a poor way to report it.
 */
function parseVocabulary(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().slice(0, MAX_AI_VOCABULARY_ENTRY))
    .filter(Boolean)
    .slice(0, MAX_AI_VOCABULARY);
}

export function AiSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { status, job, refresh, applySettings } = useAiStatus();
  const jobError = useAiProgress();

  // The vocabulary and threshold are edited locally and saved on demand: every
  // save is a change the tags do not follow until a re-tag pass is run, so it
  // must not happen on every keystroke or slider step. `draft` is null until
  // the first edit, so a background refresh is picked up right up to the moment
  // the user starts typing over it.
  const [draft, setDraft] = useState<{
    vocabulary: string;
    threshold: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(() => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    void api
      .aiSettingsSet({
        vocabulary: parseVocabulary(draft.vocabulary),
        threshold: draft.threshold,
      })
      .then((settings) => {
        applySettings(settings);
        // Only if nothing was typed while the save was in flight: dropping the
        // draft then would throw those keystrokes away silently.
        setDraft((d) => (d === draft ? null : d));
      })
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false));
  }, [draft, applySettings]);

  const selectModel = useCallback(
    async (id: string | null) => {
      // The tags of the model being left are deleted: meta_tags carries no
      // record of which model wrote a tag, so keeping them would leave tags
      // nobody can attribute. The count is only known afterwards, so it is
      // reported rather than promised.
      const ok = await confirm({
        title: id
          ? t("settings.aiSwitchTitle")
          : t("settings.aiSwitchOffTitle"),
        message: id
          ? t("settings.aiSwitchBody")
          : t("settings.aiSwitchOffBody"),
        confirmText: id ? t("settings.aiUse") : t("settings.aiDisable"),
        destructive: true,
      });
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        const cleared = await api.aiModelSelect(id);
        if (cleared > 0) toast.success(t("ai.tagsCleared", { count: cleared }));
        await refresh();
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [confirm, refresh, t],
  );

  const setAutoIndex = useCallback(
    (next: boolean) => {
      setError(null);
      void api
        .aiSettingsSet({ autoIndex: next })
        .then(applySettings)
        .catch((e: unknown) => setError(message(e)));
    },
    [applySettings],
  );

  const startIndex = useCallback((retagOnly: boolean) => {
    setError(null);
    setBusy(true);
    void api
      .aiIndexStart(retagOnly)
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false));
  }, []);

  if (!status) {
    return (
      <section className="flex items-center justify-center rounded-md border border-border bg-surface px-4 py-6">
        <Loader2 className="size-4 animate-spin text-muted" />
      </section>
    );
  }

  const vocabulary = draft?.vocabulary ?? status.settings.vocabulary.join("\n");
  const threshold = draft?.threshold ?? status.settings.threshold;
  const dirty = draft !== null;
  const running = job !== null;
  const activeModel = status.models.find((m) => m.id === status.activeModelId);

  return (
    <>
      {/* What this is, and that it stays on this machine */}
      <section className="flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3">
        <span className="text-sm font-semibold text-bright-fg">
          {t("settings.ai")}
        </span>
        <span className="text-xs text-muted">{t("settings.aiDesc")}</span>
      </section>

      {/* The models folder */}
      <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-bright-fg">
            {t("settings.aiModelsFolder")}
          </span>
          <span className="text-xs text-muted">
            {t("settings.aiModelsFolderDesc")}
          </span>
          <code className="mt-1 select-text truncate text-xs text-muted">
            {status.modelsDir}
          </code>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void api.aiModelsOpen().catch(() => undefined)}
          >
            <FolderOpen className="size-4" />
            {t("settings.aiOpenFolder")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => void refresh()}
            aria-label={t("settings.aiRefresh")}
            title={t("settings.aiRefresh")}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </section>

      {/* Models found in it, one row per weight variant */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
        <span className="text-sm font-semibold text-bright-fg">
          {t("settings.aiModels")}
        </span>
        <AiModelList
          models={status.models}
          activeModelId={status.activeModelId}
          activeBackend={status.activeBackend}
          disabled={busy || running}
          onSelect={(id) => void selectModel(id)}
        />
      </section>

      {error && (
        <section className="rounded-md border border-error bg-surface px-4 py-3 text-xs text-error">
          {error}
        </section>
      )}

      {activeModel && (
        <>
          {/* Vocabulary */}
          <section className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-bright-fg">
                {t("settings.aiVocabulary")}
              </span>
              <span className="text-xs text-muted">
                {t("settings.aiVocabularyDesc")}
              </span>
            </div>
            <textarea
              value={vocabulary}
              onChange={(e) =>
                setDraft({ vocabulary: e.target.value, threshold })
              }
              spellCheck={false}
              rows={8}
              aria-label={t("settings.aiVocabulary")}
              className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-primary"
            />
          </section>

          {/* Threshold */}
          <section className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-bright-fg">
                  {t("settings.aiThreshold")}
                </span>
                <span className="text-xs text-muted">
                  {t("settings.aiThresholdDesc")}
                </span>
              </div>
              <span className="shrink-0 font-mono text-sm text-fg">
                {threshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={AI_THRESHOLD_MIN}
              max={AI_THRESHOLD_MAX}
              step={0.01}
              value={threshold}
              aria-label={t("settings.aiThreshold")}
              onChange={(e) =>
                setDraft({ vocabulary, threshold: Number(e.target.value) })
              }
              className="w-full accent-[var(--color-primary)]"
            />
          </section>

          {/* Save, and the notice that saved settings are not in the tags yet */}
          {(dirty || status.retagPending) && (
            <section className="flex flex-col gap-2 rounded-md border border-warning bg-surface px-4 py-3">
              {status.retagPending && !dirty && (
                <div className="flex items-start gap-2 text-xs text-fg">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>{t("settings.aiRetagPending")}</span>
                </div>
              )}
              {dirty && (
                <div className="flex items-center justify-end">
                  <Button size="sm" onClick={save} disabled={busy || running}>
                    {t("settings.aiSave")}
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Auto-index */}
          <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-bright-fg">
                {t("settings.aiAutoIndex")}
              </span>
              <span className="text-xs text-muted">
                {t("settings.aiAutoIndexDesc")}
              </span>
            </div>
            <Switch
              checked={status.settings.autoIndex}
              onCheckedChange={setAutoIndex}
              aria-label={t("settings.aiAutoIndex")}
            />
          </section>

          {/* Running the job */}
          <section className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {status.pending > 0
                  ? t("ai.pending", { count: status.pending })
                  : t("ai.pendingNone")}
              </span>
              <div className="flex items-center gap-1.5">
                {running ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      void api.aiJobCancel().catch(() => undefined)
                    }
                  >
                    <X className="size-4" />
                    {t("settings.aiCancel")}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => startIndex(true)}
                      disabled={busy || dirty}
                    >
                      <RefreshCw className="size-4" />
                      {t("settings.aiRetag")}
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => startIndex(false)}
                      disabled={busy || dirty || status.pending === 0}
                    >
                      <Sparkles className="size-4" />
                      {t("settings.aiIndexNow")}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {job && <AiJobProgress job={job} />}

            {jobError && (
              <p className="text-xs text-error">
                {t("ai.jobFailed", { error: jobError })}
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}

// In-app confirmation dialog. Provides useConfirm(), which returns a
// Promise<boolean> as a replacement for window.confirm. Place ConfirmProvider
// at the app root.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

export interface ConfirmCheckbox {
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  /** Optional opt-in checkbox shown above the buttons (e.g. "also delete data"). */
  checkbox?: ConfirmCheckbox;
}

/** Result when a checkbox is present: the confirm flag plus the checkbox state. */
export interface ConfirmResult {
  confirmed: boolean;
  checked: boolean;
}

// Overloaded: with a checkbox the caller gets the checkbox state too; without it,
// the plain boolean form is preserved so existing callers stay unchanged.
type ConfirmFn = {
  (
    opts: ConfirmOptions & { checkbox: ConfirmCheckbox },
  ): Promise<ConfirmResult>;
  (opts: ConfirmOptions): Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmFn>((() =>
  Promise.resolve(false)) as unknown as ConfirmFn);

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

type State = ConfirmOptions & { resolve: (v: boolean | ConfirmResult) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<State | null>(null);
  const [checked, setChecked] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setChecked(opts.checkbox?.defaultChecked ?? false);
    return new Promise<boolean | ConfirmResult>((resolve) =>
      setState({ ...opts, resolve }),
    );
  }, []) as ConfirmFn;

  const close = useCallback(
    (confirmed: boolean) => {
      setState((s) => {
        if (s) s.resolve(s.checkbox ? { confirmed, checked } : confirmed);
        return null;
      });
    },
    [checked],
  );

  // Esc cancels / Enter confirms. Focus the confirm button when opened.
  useEffect(() => {
    if (!state) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {state.title && (
              <h2 className="mb-1 text-sm font-semibold text-bright-fg">
                {state.title}
              </h2>
            )}
            <p className="whitespace-pre-line text-sm text-fg">
              {state.message}
            </p>
            {state.checkbox && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-error"
                />
                <span>
                  {state.checkbox.label}
                  {state.checkbox.hint && (
                    <span className="mt-0.5 block text-xs text-muted">
                      {state.checkbox.hint}
                    </span>
                  )}
                </span>
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => close(false)}>
                {state.cancelText ?? t("common.cancel")}
              </Button>
              <Button
                ref={okRef}
                size="sm"
                variant={state.destructive ? "destructive" : "default"}
                onClick={() => close(true)}
              >
                {state.confirmText ?? t("common.ok")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

"use client";

import { Check, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export const TOAST_DURATION_MS = 6000;
/** Errors stay longer: they usually ask for something (Try again) and are read more slowly. */
export const ERROR_TOAST_DURATION_MS = 10_000;
/** Matches the exit animation in ToastViewport. */
const EXIT_MS = 160;

export interface ToastOptions {
  message: string;
  undo?: { label?: string; onUndo: () => void | Promise<void> };
  /** Any other single action, e.g. "Try again" on an error. Ignored when `undo` is set. */
  action?: { label: string; onAction: () => void | Promise<void> };
  variant?: "success" | "error";
}

interface ToastState extends ToastOptions {
  id: number;
  /** Set while the exit animation runs; the toast is gone once it ends. */
  leaving?: boolean;
}

export function toastDuration(variant: ToastOptions["variant"]): number {
  return variant === "error" ? ERROR_TOAST_DURATION_MS : TOAST_DURATION_MS;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

interface ToastApi {
  show: (options: ToastOptions) => void;
  dismiss: () => void;
}

interface ToastInternals {
  toast: ToastState | null;
  viewports: readonly string[];
  register: (id: string) => () => void;
  pause: () => void;
  resume: () => void;
}

const ApiContext = createContext<ToastApi | null>(null);
const InternalsContext = createContext<ToastInternals | null>(null);

/** Only the most recently mounted viewport shows the toast, so one inside an open sheet takes over. */
export function activeViewport(viewports: readonly string[]): string | null {
  return viewports.length > 0 ? viewports[viewports.length - 1] : null;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [viewports, setViewports] = useState<readonly string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Plays the exit animation, then removes the toast unless a newer one replaced it. */
  const hide = useCallback(() => {
    if (prefersReducedMotion()) {
      setToast(null);
      return;
    }
    const leavingId = counter.current;
    setToast((current) =>
      current && current.id === leavingId
        ? { ...current, leaving: true }
        : current,
    );
    setTimeout(
      () =>
        setToast((current) =>
          current && current.id === leavingId ? null : current,
        ),
      EXIT_MS,
    );
  }, []);

  const startTimer = useCallback(
    (variant: ToastOptions["variant"]) => {
      clearTimer();
      timer.current = setTimeout(hide, toastDuration(variant));
    },
    [clearTimer, hide],
  );

  const show = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      setToast({ ...options, id: counter.current });
      startTimer(options.variant);
    },
    [startTimer],
  );

  const dismiss = useCallback(() => {
    clearTimer();
    hide();
  }, [clearTimer, hide]);

  const register = useCallback((id: string) => {
    setViewports((list) => [...list.filter((v) => v !== id), id]);
    return () => setViewports((list) => list.filter((v) => v !== id));
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);
  const internals = useMemo<ToastInternals>(
    () => ({
      toast,
      viewports,
      register,
      pause: clearTimer,
      resume: () => toast && !toast.leaving && startTimer(toast.variant),
    }),
    [toast, viewports, register, clearTimer, startTimer],
  );

  return (
    <ApiContext.Provider value={api}>
      <InternalsContext.Provider value={internals}>
        {children}
      </InternalsContext.Provider>
    </ApiContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}

/**
 * Renders the current toast. Mount one per page and one inside each sheet or dialog: the
 * latest mounted viewport wins, which keeps Undo inside an open focus trap.
 */
export function ToastViewport({ inSheet = false }: { inSheet?: boolean }) {
  const internals = useContext(InternalsContext);
  const api = useContext(ApiContext);
  const id = useId();
  const t = useTranslations("common.toast");
  const register = internals?.register;

  useEffect(() => register?.(id), [register, id]);

  if (!internals || !api) return null;
  const { toast, viewports, pause, resume } = internals;
  const visible = toast !== null && activeViewport(viewports) === id;
  const isError = toast?.variant === "error";
  const Icon = isError ? TriangleAlert : Check;
  const action = toast?.undo
    ? {
        label: toast.undo.label ?? t("undo"),
        ariaLabel: t("undoLabel", { message: toast.message }),
        run: toast.undo.onUndo,
      }
    : toast?.action
      ? {
          label: toast.action.label,
          ariaLabel: undefined,
          run: toast.action.onAction,
        }
      : null;

  const card = visible && (
    <div
      key={toast.id}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={cn(
        "bg-popover text-popover-foreground pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border py-2 pr-2 pl-3 text-sm shadow-lg",
        toast.leaving
          ? "animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards duration-150"
          : "animate-in fade-in slide-in-from-bottom-2 duration-200",
        "motion-reduce:animate-none",
        // Errors are amber, never red (the token is scoped to .theme-50f).
        "theme-50f",
        isError && "border-destructive/50",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          isError ? "text-destructive" : "text-brand animate-toast-pop",
        )}
      />
      <span className={cn("min-w-0 flex-1", isError && "text-destructive")}>
        {toast.message}
      </span>
      {action && (
        <button
          type="button"
          aria-label={action.ariaLabel}
          onClick={async () => {
            api.dismiss();
            await action.run();
          }}
          className="text-brand hover:bg-accent focus-visible:ring-ring/50 min-h-9 shrink-0 rounded-md px-3 font-medium outline-none focus-visible:ring-[3px] active:scale-95 motion-reduce:active:scale-100"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={api.dismiss}
        className="text-muted-foreground hover:bg-accent focus-visible:ring-ring/50 flex size-9 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px]"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-4 z-[100] flex justify-center",
        // In a sheet there is no bottom nav below it; on a computer the sheet is a transformed dialog,
        // so `fixed` places the toast at the bottom of the dialog itself.
        inSheet
          ? "bottom-[max(1rem,env(safe-area-inset-bottom))]"
          : "bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] lg:inset-x-auto lg:right-4 lg:bottom-4 lg:justify-end",
      )}
    >
      {/* Both regions stay mounted so screen readers know them before anything is announced:
          errors interrupt (alert), successes wait their turn (status). */}
      <div role="status" aria-live="polite" className="contents">
        {!isError && card}
      </div>
      <div role="alert" className="contents">
        {isError && card}
      </div>
    </div>
  );
}

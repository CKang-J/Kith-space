import { useEffect, useState, type ReactNode } from "react";
import { getDesktopBridge } from "./desktopBridge.ts";
import {
  desktopRequiresPersonalSetupCheck,
  initializePersonalSetup,
  loadPersonalSetupStatus,
  type PersonalSetupHuman,
  type PersonalSetupInput,
} from "./personalSetup.ts";
import { FirstRunSetup } from "./views/FirstRunSetup.tsx";

interface DesktopSetupBoundaryProps {
  children: ReactNode;
}

type BoundaryState =
  | { mode: "loading" }
  | { mode: "form"; human?: PersonalSetupHuman | null }
  | { mode: "loadError"; error: string }
  | { mode: "complete" };

export function DesktopSetupBoundary({ children }: DesktopSetupBoundaryProps) {
  const bridge = getDesktopBridge();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BoundaryState>({ mode: "loading" });

  useEffect(() => {
    if (!desktopRequiresPersonalSetupCheck(bridge)) return;

    let cancelled = false;
    setState({ mode: "loading" });
    loadPersonalSetupStatus().then((status) => {
      if (!cancelled) setState(status.initialized
        ? { mode: "complete" }
        : { mode: "form", human: status.human });
    }).catch((reason) => {
      if (!cancelled) setState({ mode: "loadError", error: errorMessage(reason) });
    });
    return () => { cancelled = true; };
  }, [bridge, attempt]);

  if (!desktopRequiresPersonalSetupCheck(bridge) || state.mode === "complete") return children;

  const initialize = async (input: PersonalSetupInput) => {
    await initializePersonalSetup(input);
    setState({ mode: "complete" });
  };

  return (
    <FirstRunSetup
      key={state.mode === "form" ? state.human?.id ?? "form" : state.mode}
      mode={state.mode}
      initialHuman={state.mode === "form" ? state.human : undefined}
      loadError={state.mode === "loadError" ? state.error : undefined}
      onInitialize={initialize}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error && reason.message
    ? reason.message
    : "Kith-space could not check first-run setup.";
}

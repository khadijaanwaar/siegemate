import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GameController } from "../core/gameController";
import type { SceneEngine } from "../scene/sceneEngine";
import { readReplayHash, type ReplayGame } from "./replay";
import { ReplayDriver, type ReplayState } from "./replayDriver";

/** How long the opening position is shown before playback starts. */
const AUTOPLAY_DELAY_MS = 1200;
export const BROKEN_LINK_NOTICE = "That replay link is broken or incomplete. Here is the menu instead.";

export interface ReplayHost {
  controller: GameController;
  engine: () => SceneEngine | null;
  /** The armies have loaded and the menu could show. */
  ready: boolean;
  introPlaying: boolean;
  /** The shell switches to the board: attract off, battleground set, phase "playing". */
  onEnter: (game: ReplayGame) => void;
  /** Back to the menu. */
  onLeave: () => void;
  notify: (message: string) => void;
  /** Set while a replay owns the board, for the shell's event handlers (nothing saved, nothing recorded). */
  activeRef: React.MutableRefObject<boolean>;
}

export interface ReplayControls {
  toggle(): void;
  stepBack(): void;
  stepForward(): void;
  toStart(): void;
  toEnd(): void;
  /** Play on from this position against the computer (null when the position is over). */
  continueHere: (() => void) | null;
  /** "Play your own game": leave the replay for the menu. */
  leave(): void;
}

/** Where the viewer sits: behind the human's army against the computer, white otherwise. */
function seat(shared: ReplayGame): "white" | "black" {
  return shared.mode === "ai" && shared.playerColor === "b" ? "black" : "white";
}

function clearHash(): void {
  try {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  } catch {
    // An opaque origin: the hash just stays.
  }
}

/**
 * Replay mode: a `#r=` link opens the shared game on the board with its
 * armies and battleground and plays it back. Works offline (the hash never
 * reaches the network) and keeps its hands off the viewer's own saved match,
 * record and army choice.
 */
export function useReplay(host: ReplayHost): {
  game: ReplayGame | null;
  state: ReplayState | null;
  controls: ReplayControls | null;
} {
  const { controller, engine, ready, introPlaying, onEnter, onLeave, notify, activeRef } = host;
  const [pending, setPending] = useState<{ present: boolean; game: ReplayGame | null }>(() =>
    typeof window === "undefined" ? { present: false, game: null } : readReplayHash(window.location.hash),
  );
  const [game, setGame] = useState<ReplayGame | null>(null);
  const [state, setState] = useState<ReplayState | null>(null);
  const driverRef = useRef<ReplayDriver | null>(null);
  const autoplay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostRef = useRef({ engine, onEnter, onLeave, notify });
  hostRef.current = { engine, onEnter, onLeave, notify };

  const stop = useCallback((): void => {
    if (autoplay.current) clearTimeout(autoplay.current);
    autoplay.current = null;
    driverRef.current?.dispose();
    driverRef.current = null;
    activeRef.current = false;
    setGame(null);
    setState(null);
  }, [activeRef]);

  const begin = useCallback(
    (shared: ReplayGame): void => {
      stop();
      const scene = hostRef.current.engine();
      scene?.skipIntro();
      scene?.setAttract(false);
      scene?.setShowcase(false);
      scene?.setTacticalView(false);
      scene?.setInteractive(false);
      scene?.setRotateBoard(false);
      // Straight to the engine: through the settings these would become the viewer's own choice.
      scene?.setArmySkins(shared.armies);
      scene?.setCameraPreset(seat(shared));
      const driver = new ReplayDriver(controller, shared, setState);
      driverRef.current = driver;
      activeRef.current = true;
      setGame(shared);
      hostRef.current.onEnter(shared);
      driver.seek(0);
      autoplay.current = setTimeout(() => {
        autoplay.current = null;
        if (driverRef.current === driver) void driver.play();
      }, AUTOPLAY_DELAY_MS);
    },
    [controller, stop, activeRef],
  );

  // A link opened cold waits for the armies; a broken one lands on the menu with a word.
  useEffect(() => {
    if (!ready || !pending.present) return;
    setPending({ present: false, game: null });
    if (pending.game) {
      begin(pending.game);
    } else {
      clearHash();
      hostRef.current.notify(BROKEN_LINK_NOTICE);
    }
  }, [ready, pending, begin]);

  // A link pasted into a tab that is already open.
  useEffect(() => {
    const onHash = (): void => {
      const next = readReplayHash(window.location.hash);
      if (next.present) setPending(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // The fly-in may start after the replay did (it is kicked off when the armies
  // land): cut it short, then take the board back from it.
  const sawIntro = useRef(false);
  useEffect(() => {
    if (!activeRef.current || !game) return;
    const scene = hostRef.current.engine();
    if (introPlaying) {
      sawIntro.current = true;
      scene?.skipIntro();
    } else if (sawIntro.current) {
      sawIntro.current = false;
      scene?.setInteractive(false);
      scene?.setCameraPreset(seat(game));
    }
  }, [introPlaying, game, activeRef]);

  useEffect(() => () => stop(), [stop]);

  // Dev and test builds only: what the replay shows, for the e2e specs.
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.MODE === "test")) return;
    (window as unknown as { __replay: unknown }).__replay = {
      state: () => driverRef.current?.state ?? null,
      armies: () => hostRef.current.engine()?.getArmySkins() ?? null,
      active: () => activeRef.current,
    };
  }, [activeRef]);

  const controls = useMemo<ReplayControls | null>(() => {
    const driver = driverRef.current;
    if (!driver || !game || !state) return null;
    const halt = (): void => {
      if (autoplay.current) clearTimeout(autoplay.current);
      autoplay.current = null;
    };
    /**
     * Leaving a finished position: the end-of-game shot has dollied onto the
     * fallen king and softened the focus, so the viewer's seat is restored.
     */
    const leavingTheEnd = (jump: () => void): void => {
      const wasOver = controller.getSnapshot().status === "over";
      jump();
      if (wasOver && controller.getSnapshot().status !== "over") {
        const scene = hostRef.current.engine();
        scene?.setShowcase(false);
        scene?.setCameraPreset(seat(game));
      }
    };
    return {
      toggle: () => {
        halt();
        leavingTheEnd(() => driver.toggle());
      },
      stepBack: () => {
        halt();
        leavingTheEnd(() => driver.stepBack());
      },
      stepForward: () => {
        halt();
        driver.pause();
        void driver.stepForward();
      },
      toStart: () => {
        halt();
        leavingTheEnd(() => driver.seek(0));
      },
      toEnd: () => {
        halt();
        driver.seek(driver.state.total);
      },
      continueHere: driver.canContinue()
        ? () => {
            if (driver.state.busy) return;
            const options = driver.continueOptions();
            const save = controller.exportSave();
            stop();
            clearHash();
            controller.resume({ ...save, options, clock: { whiteMs: 0, blackMs: 0 } });
            const scene = hostRef.current.engine();
            scene?.setShowcase(false);
            scene?.setInteractive(true);
            scene?.setCameraPreset(options.playerColor === "b" ? "black" : "white");
          }
        : null,
      leave: () => {
        stop();
        clearHash();
        hostRef.current.onLeave();
      },
    };
    // `state` is the trigger: the controls are rebuilt whenever the board moves on.
  }, [controller, game, state, stop]);

  return { game, state, controls };
}

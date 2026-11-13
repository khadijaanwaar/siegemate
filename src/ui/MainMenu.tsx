import { useId, useState, type ReactNode } from "react";
import { Clapperboard, Eye, Glasses, Play, Settings as SettingsIcon, Swords, Users } from "lucide-react";

import { APP_NAME, TAGLINE } from "../brand";
import type { PlayerStats } from "../core/stats";
import type { DemoOptions, Difficulty, Faction } from "../core/types";
import { Crest } from "./Heraldry";
import { MusterSection, type MusterChoice } from "./Muster";
import { RecordStrip } from "./RecordStrip";

export interface MatchConfig {
  mode: "ai" | "hotseat" | "demo";
  difficulty: Difficulty;
  playerColor: Faction;
  clockMinutes: number | null;
  demo?: DemoOptions;
}

interface MainMenuProps {
  onStart: (config: MatchConfig) => void;
  onOpenSettings: () => void;
  /** Armies and battleground — settled here, before the first move. */
  muster: MusterChoice;
  onMuster: (choice: MusterChoice) => void;
  attract: boolean;
  onInteract: () => void;
  /** Present when this browser can show the game on a real table (Quest Browser). */
  onStartMixedReality?: (config: MatchConfig) => void;
  /** The player's record against the computer (hidden until the first game). */
  stats?: PlayerStats;
}

type Mode = MatchConfig["mode"];

const MODES: { mode: Mode; label: string; name: string; icon: ReactNode }[] = [
  { mode: "ai", label: "Computer", name: "Play the computer", icon: <Swords size={18} aria-hidden="true" /> },
  { mode: "hotseat", label: "Friend", name: "Play a friend on this device", icon: <Users size={18} aria-hidden="true" /> },
  { mode: "demo", label: "Watch", name: "Watch the computer play itself", icon: <Clapperboard size={18} aria-hidden="true" /> },
];

const LEVELS: Difficulty[] = ["easy", "medium", "hard"];

/** The engine's three strengths, named in the game's own ranks. */
const STRENGTH_NAME: Record<Difficulty, string> = { easy: "Squire", medium: "Knight", hard: "Warlord" };

const SIDE_NAME: Record<Faction, string> = { w: "Ivory", b: "Obsidian" };

const DEMO_SPEEDS: { label: string; value: number }[] = [
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

const CLOCKS: { label: string; name: string; value: number | null }[] = [
  { label: "Off", name: "No clock", value: null },
  { label: "5 min", name: "5 minutes each", value: 5 },
  { label: "10 min", name: "10 minutes each", value: 10 },
  { label: "15 min", name: "15 minutes each", value: 15 },
];

export function MainMenu({
  onStart,
  onOpenSettings,
  muster,
  onMuster,
  attract,
  onInteract,
  onStartMixedReality,
  stats,
}: MainMenuProps) {
  const [tab, setTab] = useState<Mode>("ai");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerColor, setPlayerColor] = useState<Faction>("w");
  const [clock, setClock] = useState<number | null>(null);
  const [demoWhite, setDemoWhite] = useState<Difficulty>("medium");
  const [demoBlack, setDemoBlack] = useState<Difficulty>("hard");
  const [demoSpeed, setDemoSpeed] = useState<number>(1);
  const [demoLoop, setDemoLoop] = useState<boolean>(true);

  const config = (): MatchConfig => ({
    mode: tab,
    difficulty,
    playerColor,
    clockMinutes: tab === "demo" ? null : clock,
    demo: tab === "demo" ? { white: demoWhite, black: demoBlack, speed: demoSpeed, autoRematch: demoLoop } : undefined,
  });
  const start = (): void => onStart(config());
  const record = stats && stats.total.wins + stats.total.losses + stats.total.draws > 0 ? stats : null;

  return (
    <div
      className="mc-menu mc-modal-pad pointer-events-auto absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      data-attract={attract}
      onPointerDown={onInteract}
      onPointerMove={onInteract}
    >
      <div className="mc-menu-card mc-rise">
        <div className="mc-menu-lead">
          <header className="mc-menu-head">
            <h1 className="mc-wordmark mc-menu-mark">{APP_NAME}</h1>
            <p className="mc-menu-tagline">{TAGLINE}</p>
          </header>

          {record ? (
            <div className="mc-menu-record">
              <RecordStrip stats={record} />
            </div>
          ) : null}

          <div className="mc-menu-actions">
            {onStartMixedReality ? (
              <button
                type="button"
                className="mc-btn mc-btn-primary mc-btn-lg mc-menu-xr"
                onClick={() => onStartMixedReality(config())}
              >
                <Glasses size={20} aria-hidden="true" /> Play on your table
              </button>
            ) : null}
            <button
              type="button"
              className={`mc-btn mc-btn-lg ${onStartMixedReality ? "mc-btn-gold-outline" : "mc-btn-primary"}`}
              onClick={start}
              aria-label={tab === "demo" ? "Start watching" : onStartMixedReality ? "Play on screen" : "Play"}
            >
              {tab === "demo" ? (
                <>
                  <Eye size={20} aria-hidden="true" /> Watch
                </>
              ) : (
                <>
                  <Play size={20} aria-hidden="true" /> Play
                </>
              )}
            </button>
            <button type="button" className="mc-btn mc-btn-lg mc-menu-settings" onClick={onOpenSettings}>
              <SettingsIcon size={18} aria-hidden="true" /> Settings
            </button>
          </div>
        </div>

        <div className="mc-menu-setup">
          <div className="mc-seg" role="group" aria-label="Game mode">
            {MODES.map((entry) => (
              <button
                key={entry.mode}
                type="button"
                className="mc-seg-btn"
                data-active={tab === entry.mode}
                aria-pressed={tab === entry.mode}
                aria-label={entry.name}
                onClick={() => setTab(entry.mode)}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

          <div className="mc-menu-scroll mc-scroll mc-scroll-shade">
            {tab === "ai" ? (
              <>
                <OptionGroup label="Strength">
                  {LEVELS.map((level) => (
                    <Option
                      key={level}
                      active={difficulty === level}
                      name={`${STRENGTH_NAME[level]} (${level})`}
                      onClick={() => setDifficulty(level)}
                    >
                      {STRENGTH_NAME[level]}
                    </Option>
                  ))}
                </OptionGroup>

                <OptionGroup label="Your side" columns={2}>
                  {(["w", "b"] as Faction[]).map((color) => (
                    <Option
                      key={color}
                      active={playerColor === color}
                      name={`Play as ${SIDE_NAME[color]}${color === "w" ? " (moves first)" : ""}`}
                      onClick={() => setPlayerColor(color)}
                    >
                      <Crest faction={color} size={20} active={playerColor === color} />
                      {SIDE_NAME[color]}
                    </Option>
                  ))}
                </OptionGroup>
              </>
            ) : null}

            {tab === "demo" ? (
              <>
                <OptionGroup label="Ivory" marker={<SideMark side="w" />}>
                  {LEVELS.map((level) => (
                    <Option
                      key={level}
                      active={demoWhite === level}
                      name={`Ivory engine: ${STRENGTH_NAME[level]} (${level})`}
                      onClick={() => setDemoWhite(level)}
                    >
                      {STRENGTH_NAME[level]}
                    </Option>
                  ))}
                </OptionGroup>

                <OptionGroup label="Obsidian" marker={<SideMark side="b" />}>
                  {LEVELS.map((level) => (
                    <Option
                      key={level}
                      active={demoBlack === level}
                      name={`Obsidian engine: ${STRENGTH_NAME[level]} (${level})`}
                      onClick={() => setDemoBlack(level)}
                    >
                      {STRENGTH_NAME[level]}
                    </Option>
                  ))}
                </OptionGroup>

                <OptionGroup label="Speed" columns={4}>
                  {DEMO_SPEEDS.map((option) => (
                    <Option
                      key={option.label}
                      active={demoSpeed === option.value}
                      name={`Speed ${option.label}`}
                      onClick={() => setDemoSpeed(option.value)}
                    >
                      {option.label}
                    </Option>
                  ))}
                </OptionGroup>

                <button
                  type="button"
                  role="switch"
                  aria-checked={demoLoop}
                  className="mc-switch-row"
                  onClick={() => setDemoLoop((loop) => !loop)}
                >
                  <span>Loop duels</span>
                  <span className="mc-switch" data-on={demoLoop} aria-hidden="true">
                    <span className="mc-switch-knob" />
                  </span>
                </button>
              </>
            ) : (
              <OptionGroup label="Clock" columns={4}>
                {CLOCKS.map((option) => (
                  <Option
                    key={option.label}
                    active={clock === option.value}
                    name={option.name}
                    onClick={() => setClock(option.value)}
                  >
                    {option.label}
                  </Option>
                ))}
              </OptionGroup>
            )}

            <MusterSection choice={muster} onChange={onMuster} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A labelled row of mutually exclusive choices. */
function OptionGroup({
  label,
  marker,
  columns = 3,
  children,
}: {
  label: string;
  marker?: ReactNode;
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="mc-field">
      <p id={id} className="mc-label">
        {marker}
        {label}
      </p>
      <div className="mc-options" data-columns={columns} role="group" aria-labelledby={id}>
        {children}
      </div>
    </div>
  );
}

function Option({
  active,
  name,
  onClick,
  children,
}: {
  active: boolean;
  /** Accessible name; always contains the visible label. */
  name: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="mc-option" data-active={active} aria-pressed={active} aria-label={name} onClick={onClick}>
      {children}
    </button>
  );
}

/** The side's colour code, matching the band painted under its figures. */
function SideMark({ side }: { side: Faction }) {
  return <span className="mc-side-dot" data-side={side} aria-hidden="true" />;
}

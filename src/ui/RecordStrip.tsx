import { Flame, Trophy } from "lucide-react";

import { type PlayerStats, winRate } from "../core/stats";
import type { Difficulty } from "../core/types";

const STRENGTH: Record<Difficulty, string> = { easy: "Squire", medium: "Knight", hard: "Warlord" };

interface RecordStripProps {
  stats: PlayerStats;
  /** Light text on dark (the menu) or dark text on parchment (the game-over card). */
  tone: "dark" | "parchment";
}

/** The player's record against the computer: W-L-D, win rate, streaks, per strength. */
export function RecordStrip({ stats, tone }: RecordStripProps) {
  const { total } = stats;
  const games = total.wins + total.losses + total.draws;
  if (games === 0) return null;
  const rate = winRate(total);
  const ink = tone === "dark" ? "text-[#d9c49a]" : "text-[#4a3a24]";
  const muted = tone === "dark" ? "text-[#8f7d5c]" : "text-[#7d6236]";

  return (
    <div className={`mc-record ${ink}`} aria-label="Your record against the computer">
      <p className="mc-display text-[0.62rem] tracking-[0.3em]">
        <span className={muted}>RECORD </span>
        {total.wins}W · {total.losses}L · {total.draws}D
        {rate !== null ? <span className={muted}> · {rate}% won</span> : null}
      </p>
      <p className={`mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.72rem] ${muted}`}>
        {stats.streak > 0 ? (
          <span className={`inline-flex items-center gap-1 ${ink}`}>
            <Flame size={12} /> {stats.streak} in a row
          </span>
        ) : null}
        {stats.bestStreak > 1 ? <span>best streak {stats.bestStreak}</span> : null}
        {stats.fastestWinMoves !== null ? (
          <span className="inline-flex items-center gap-1">
            <Trophy size={12} /> fastest win {stats.fastestWinMoves} moves
          </span>
        ) : null}
      </p>
      <p className={`mt-1 text-[0.68rem] ${muted}`}>
        {(Object.keys(STRENGTH) as Difficulty[])
          .filter((difficulty) => {
            const record = stats.byDifficulty[difficulty];
            return record.wins + record.losses + record.draws > 0;
          })
          .map((difficulty) => {
            const record = stats.byDifficulty[difficulty];
            return `${STRENGTH[difficulty]} ${record.wins}-${record.losses}-${record.draws}`;
          })
          .join(" · ")}
      </p>
    </div>
  );
}

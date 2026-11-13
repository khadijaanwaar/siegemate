import { Flame } from "lucide-react";
import type { ReactNode } from "react";

import { type PlayerStats, winRate } from "../core/stats";

interface RecordStripProps {
  stats: PlayerStats;
}

/** The player's record against the computer, as five figures: W, L, D, win rate and current streak. */
export function RecordStrip({ stats }: RecordStripProps) {
  const { total } = stats;
  const games = total.wins + total.losses + total.draws;
  if (games === 0) return null;
  const rate = winRate(total);

  return (
    <dl className="mc-record" aria-label="Your record against the computer">
      <Figure label="Won" value={total.wins} />
      <Figure label="Lost" value={total.losses} />
      <Figure label="Drawn" value={total.draws} />
      <Figure label="Win rate" value={rate === null ? "–" : `${rate}%`} />
      <Figure
        label="Streak"
        value={
          stats.streak > 0 ? (
            <>
              <Flame size={16} className="mc-record-flame" aria-hidden="true" />
              {stats.streak}
            </>
          ) : (
            0
          )
        }
      />
    </dl>
  );
}

/** One figure: the label first in the markup (as a definition list wants it), the number first on screen. */
function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mc-record-cell">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

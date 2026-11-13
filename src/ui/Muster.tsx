import { useId, type ReactNode } from "react";
import { Lock } from "lucide-react";

import { ARENA_CARDS, ARMY_CARDS, ARMY_SKINS, ARMY_SKIN_ORDER, type ArmySkinId } from "../assets/generated";
import type { Faction } from "../core/types";
import { ARENA_LOOKS, ARENA_ORDER, type ArenaTheme } from "../scene/arena";

/**
 * The war-table choices: which army each side musters and which ground they
 * fight on. Both are settled *before* the first move — swapping an army mid-duel
 * would tear down and re-download every figure on the board, and swapping the
 * ground would re-stage the hall underneath pieces that are already fighting.
 * So these pickers live in the menu, and the in-match panel shows them locked.
 */
export interface MusterChoice {
  skins: Record<Faction, ArmySkinId>;
  arena: ArenaTheme;
}

const SIDE_NAME: Record<Faction, string> = { w: "Ivory", b: "Obsidian" };

/**
 * One side's army choice: a row of cards, one per skin, each its painting and
 * its name. The painting is decoration laid over the livery gradient, never
 * instead of it, so a card whose art is still downloading still reads as that
 * army's colours.
 */
export function ArmyPicker({
  side,
  name,
  chosen,
  onChoose,
}: {
  side: Faction;
  name: string;
  chosen: ArmySkinId;
  onChoose: (skin: ArmySkinId) => void;
}) {
  return (
    <div className="mc-subfield">
      <p className="mc-sublabel" aria-hidden="true">
        <SideDot side={side} />
        {name}
      </p>
      <div className="mc-options" data-columns={3} role="group" aria-label={`${name} army`}>
        {ARMY_SKIN_ORDER.map((skin) => (
          <button
            key={skin}
            type="button"
            className="mc-army-card"
            data-active={chosen === skin}
            aria-pressed={chosen === skin}
            onClick={() => onChoose(skin)}
          >
            <span className="mc-army-swatch" data-army={skin}>
              <img className="mc-army-art" src={ARMY_CARDS[skin]} alt="" loading="lazy" decoding="async" />
            </span>
            <span>{ARMY_SKINS[skin].label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The ground the board is staged on: a painted card per map, over its palette gradient. */
export function ArenaPicker({ chosen, onChoose }: { chosen: ArenaTheme; onChoose: (theme: ArenaTheme) => void }) {
  return (
    <div className="mc-options" data-columns={3}>
      {ARENA_ORDER.map((theme) => (
        <button
          key={theme}
          type="button"
          className="mc-arena-card"
          data-active={chosen === theme}
          aria-pressed={chosen === theme}
          onClick={() => onChoose(theme)}
        >
          <span className="mc-arena-swatch" data-arena={theme}>
            <img className="mc-arena-art" src={ARENA_CARDS[theme]} alt="" loading="lazy" decoding="async" />
          </span>
          <span>{ARENA_LOOKS[theme].label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The full war table — armies for both sides plus the battleground. Used on the
 * main menu before a duel and inside settings while no duel is running.
 */
export function MusterSection({
  choice,
  onChange,
}: {
  choice: MusterChoice;
  onChange: (choice: MusterChoice) => void;
}) {
  const groundId = useId();
  return (
    <>
      <div className="mc-field">
        <p className="mc-label">Armies</p>
        <ArmyPicker
          side="w"
          name={SIDE_NAME.w}
          chosen={choice.skins.w}
          onChoose={(skin) => onChange({ ...choice, skins: { ...choice.skins, w: skin } })}
        />
        <ArmyPicker
          side="b"
          name={SIDE_NAME.b}
          chosen={choice.skins.b}
          onChoose={(skin) => onChange({ ...choice, skins: { ...choice.skins, b: skin } })}
        />
      </div>

      <div className="mc-field" role="group" aria-labelledby={groundId}>
        <p id={groundId} className="mc-label">
          Battleground
        </p>
        <ArenaPicker chosen={choice.arena} onChoose={(arena) => onChange({ ...choice, arena })} />
      </div>
    </>
  );
}

/**
 * The same three choices, read-only, for a duel already under way: it states
 * what is on the board and how to change it.
 */
export function MusterLocked({ choice }: { choice: MusterChoice }) {
  return (
    <div className="mc-muster-locked">
      <p className="mc-label">
        <Lock size={14} aria-hidden="true" />
        Armies and battleground
      </p>
      <dl className="mc-locked-list">
        <LockedRow marker={<SideDot side="w" />} name={SIDE_NAME.w} value={ARMY_SKINS[choice.skins.w].label} />
        <LockedRow marker={<SideDot side="b" />} name={SIDE_NAME.b} value={ARMY_SKINS[choice.skins.b].label} />
        <LockedRow
          marker={<span className="mc-arena-dot" data-arena={choice.arena} />}
          name="Battleground"
          value={ARENA_LOOKS[choice.arena].label}
        />
      </dl>
      <p className="mc-note">Locked during a duel. Start a new duel to change them.</p>
    </div>
  );
}

function LockedRow({ marker, name, value }: { marker: ReactNode; name: string; value: string }) {
  return (
    <div className="mc-locked-row">
      {marker}
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The side's colour code, matching the band painted under its figures. */
function SideDot({ side }: { side: Faction }) {
  return <span className="mc-side-dot" data-side={side} aria-hidden="true" />;
}

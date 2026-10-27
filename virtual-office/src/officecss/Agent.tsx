import type { OfficeCharacter } from "../office/stateMachine";

interface Props {
  character: OfficeCharacter;
  slot: number;
  total: number;
  onClick: () => void;
}

/**
 * A single CSS character (no WebGL). Built from layered DIVs: head (with hair
 * and skin tone), torso (shirt colour), legs (trouser colour). Gender nudges
 * proportions. The whole figure is positioned on the floor by `slot`, and its
 * lifecycle `phase` drives CSS classes that animate walk-in / working / leave.
 * Clickable to open the blow-up inspector.
 */
export function Agent({ character, slot, total, onClick }: Props) {
  const a = character.appearance;
  // Spread agents across the front of the room; evenly spaced consoles.
  const spread = 72; // percent of room width used
  const left = total <= 1 ? 50 : (50 - spread / 2) + (spread * slot) / (total - 1);
  const female = a.gender === "female";

  const cls = [
    "agent",
    "agent--" + character.phase,
    "agent--" + character.role,
    female ? "agent--f" : "agent--m",
  ].join(" ");

  const vars: Record<string, string> = {
    "--skin": a.skinTone,
    "--hair": a.hairColor,
    "--shirt": a.shirtColor,
    "--trouser": a.trouserColor,
    "--left": left + "%",
  };

  return (
    <button type="button" className={cls} style={vars as React.CSSProperties} onClick={onClick} title={"Inspect " + character.agentName}>
      <span className="agent__label">{character.labelText}</span>
      <span className="agent__figure">
        <span className={"agent__hair agent__hair--" + a.hairStyle} />
        <span className="agent__head" />
        <span className="agent__torso" />
        <span className="agent__arm agent__arm--l" />
        <span className="agent__arm agent__arm--r" />
        <span className="agent__leg agent__leg--l" />
        <span className="agent__leg agent__leg--r" />
      </span>
      <span className="agent__console" />
      <span className="agent__shadow" />
    </button>
  );
}
import { join } from "node:path";

import type { ReactElement, ReactNode } from "react";

import { type MenuEntry, menuOn } from "../../components/ContextMenu";
import { Icon, Keys } from "../../components/ui";
import type { Combo } from "../../keys/keymaps";
import { ASSETS } from "../../lib/assets";
import { useTheme } from "../../theme";
import { ELLIPSIS, HOVER, MONO_STYLE, useBench } from "../parts";
import type { NavSection } from "../state";

export const ICON_COLUMN = 17;
export const ROW_GAP = 10;
export const INSET = 8;

export type Lead = { readonly kind: "icon"; readonly name: string } | { readonly kind: "node"; readonly node: ReactNode } | { readonly kind: "logo"; readonly name: string } | { readonly kind: "dot"; readonly color: string } | { readonly kind: "none" };

function LeadView({ lead }: { readonly lead: Lead }): ReactElement {
  const { p } = useTheme();
  const box = { display: "flex", alignItems: "center", justifyContent: "center", width: ICON_COLUMN, height: ICON_COLUMN, flexShrink: 0, pointerEvents: "none" } as const;
  switch (lead.kind) {
    case "icon":
      return <div style={box}><Icon name={lead.name} size={ICON_COLUMN} color={p.muted} /></div>;
    case "logo":
      return <div style={box}><img src={join(ASSETS, "icons", `${lead.name}.svg`)} objectFit="contain" style={{ width: 16, height: 16 }} /></div>;
    case "node":
      return <div style={box}>{lead.node}</div>;
    case "dot":
      return <div style={box}><div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: lead.color }} /></div>;
    case "none":
      return <div style={box} />;
    default: {
      const unhandled: never = lead;
      return unhandled;
    }
  }
}

/** The one sidebar row: a gray icon in a fixed column, the label, and something quiet on the right. */
export function SideRow({ lead, label, note = "", noteColor = null, side = "", combo = "", on = false, mono = false, indent = 0, height = 32, onClick, menu, trailing }: {
  readonly lead: Lead;
  readonly label: string;
  readonly note?: string;
  readonly noteColor?: string | null;
  readonly side?: string;
  readonly combo?: Combo;
  readonly on?: boolean;
  readonly mono?: boolean;
  readonly indent?: number;
  readonly height?: number;
  readonly onClick: () => void;
  readonly menu?: () => readonly MenuEntry[];
  readonly trailing?: ReactNode;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div {...menuOn(() => menu?.() ?? [], onClick)} role="button" aria-selected={on} aria-label={label} style={{ display: "flex", alignItems: "center", gap: ROW_GAP, ...(note ? { minHeight: height, paddingTop: 4, paddingBottom: 4 } : { height }), flexShrink: 0, paddingLeft: INSET + indent, paddingRight: INSET, borderRadius: 8, cursor: "pointer", hover: HOVER, ...(on ? { backgroundColor: p.sel } : {}) }}>
      <LeadView lead={lead} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, pointerEvents: "none" }}>
        <div style={{ color: on ? p.text : p.text3, ...ELLIPSIS, ...(mono ? { fontSize: 12, ...MONO_STYLE } : {}) }}>{label}</div>
        {note && <div style={{ fontSize: 11.5, lineHeight: 15, color: noteColor ?? p.faint, ...ELLIPSIS }}>{note}</div>}
      </div>
      {side && <div style={{ flexShrink: 0, fontSize: 12, color: p.faint, pointerEvents: "none", ...(mono ? { fontSize: 11, ...MONO_STYLE } : {}) }}>{side}</div>}
      {trailing}
      {combo && <Keys combo={combo} />}
    </div>
  );
}

export function useSectionOpen(id: NavSection): { readonly open: boolean; readonly toggle: () => void } {
  const { wb } = useBench();
  const closed = wb.s.navClosed;
  const open = !closed.includes(id);
  return { open, toggle: () => wb.patch({ navClosed: open ? [...closed, id] : closed.filter((section) => section !== id) }) };
}

/** A section's heading: small faint text with a chevron, so it never reads as one of its own rows. */
export function Heading({ id, title, count }: { readonly id: NavSection; readonly title: string; readonly count: string }): ReactElement {
  const { p } = useTheme();
  const { open, toggle } = useSectionOpen(id);
  return (
    <div onClick={toggle} role="button" aria-expanded={open} aria-label={title} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, marginTop: 4, flexShrink: 0, paddingLeft: INSET, paddingRight: INSET, borderRadius: 6, cursor: "pointer", hover: HOVER }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.faint, pointerEvents: "none" }}>{title}</div>
      <Icon name={open ? "disclosure" : "forward"} size={10} color={p.faint} />
      <div style={{ flexGrow: 1 }} />
      {count && <div style={{ fontSize: 12, color: p.faint, pointerEvents: "none" }}>{count}</div>}
    </div>
  );
}

/** A heading and, while open, its rows, with room after them before the next heading. */
/** Space under an open section, before the next heading. */
export const SECTION_GAP = 10;

export function SideSection({ id, title, count, children }: { readonly id: NavSection; readonly title: string; readonly count: string; readonly children: ReactNode }): ReactElement {
  const { open } = useSectionOpen(id);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: "100%", paddingBottom: open ? SECTION_GAP : 0 }}>
      <Heading id={id} title={title} count={count} />
      {open && children}
    </div>
  );
}

export function Faint({ text, indent = 0 }: { readonly text: string; readonly indent?: number }): ReactElement {
  const { p } = useTheme();
  return <div style={{ paddingBottom: 4, paddingLeft: INSET + ICON_COLUMN + ROW_GAP + indent, paddingRight: INSET, fontSize: 11.5, lineHeight: 18, color: p.faint, ...ELLIPSIS }}>{text}</div>;
}

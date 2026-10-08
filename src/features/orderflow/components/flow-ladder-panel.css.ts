import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../../theme.css';

export const shell = style({
    display: 'flex', flexDirection: 'column', flex: 1,
    minHeight: 0, minWidth: 0, overflow: 'hidden',
    fontFamily: vars.font.mono, color: vars.color.foreground,
});
export const toolbar = style({
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5,
    padding: '5px 7px', borderBottom: '1px solid ' + vars.color.border,
    flexShrink: 0, fontSize: '0.66rem',
});
const buttonBase = style({
    color: vars.color.foreground, background: vars.color.panel,
    border: '1px solid ' + vars.color.border,
    borderRadius: vars.radius.sm, padding: '3px 7px',
    cursor: 'pointer', fontFamily: vars.font.mono, fontSize: '0.66rem',
});
export const button = styleVariants({
    normal: [buttonBase],
    active: [buttonBase, { background: vars.color.muted }],
});
export const title = style({
    color: vars.color.accent, fontWeight: 700, fontSize: '0.69rem',
    marginRight: 6,
});
export const status = style({ marginLeft: 'auto', fontSize: '0.64rem', color: vars.color.mutedForeground });
export const notice = style({
    padding: '4px 8px', fontSize: '0.62rem', flexShrink: 0,
    borderBottom: '1px solid ' + vars.color.border, color: vars.color.mutedForeground,
});
export const scroll = style({
    flex: 1, overflow: 'auto', minHeight: 0,
    scrollbarGutter: 'stable',
});
export const table = style({
    minWidth: 650, fontVariantNumeric: 'tabular-nums',
});
export const row = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(65px,1fr) minmax(62px,1fr) minmax(55px,0.9fr) minmax(85px,1.25fr) minmax(55px,0.9fr) minmax(62px,1fr) minmax(65px,1fr) minmax(60px,0.9fr)',
    width: '100%',
    height: 27, alignItems: 'center', gap: 0,
    borderBottom: '1px solid ' + vars.color.border,
    fontSize: '0.67rem',
});
export const header = style([
    row, { fontSize: '0.62rem', fontWeight: 700,
        background: vars.color.panel, position: 'sticky', top: 0, zIndex: 2,
    },
]);
export const numeric = style({
    position: 'relative', display: 'flex', alignItems: 'center',
    justifyContent: 'flex-end', minWidth: 0,
    height: '100%', padding: '0 5px', overflow: 'hidden',
});
export const value = style({ position: 'relative', zIndex: 1 });
export const meter = style({
    position: 'absolute', right: 0, top: '18%', bottom: '18%',
    opacity: 0.22, pointerEvents: 'none',
});
export const price = style([
    numeric, {
        justifyContent: 'center',
        fontWeight: 700,
        color: vars.color.foreground,
        background: vars.color.panel,
        borderLeft: '1px solid ' + vars.color.border,
        borderRight: '1px solid ' + vars.color.border,
    },
]);
export const lastRow = style({
    background: vars.color.muted,
    outline: '1px solid ' + vars.color.accent,
    outlineOffset: '-1px',
});
export const buy = style({ color: vars.color.up });
export const sell = style({ color: vars.color.down });
export const empty = style({
    padding: 20, textAlign: 'center', color: vars.color.mutedForeground,
    fontSize: '0.75rem',
});

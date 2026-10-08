import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../../theme.css';

export const shell = style({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
});
export const switcher = style({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    padding: '4px 7px',
    borderBottom: `1px solid ${vars.color.border}`,
    background: vars.color.panel,
    flexShrink: 0,
});
const base = style({
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    padding: '3px 8px',
    cursor: 'pointer',
    color: vars.color.mutedForeground,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: 'transparent',
});
export const tab = styleVariants({
    normal: [base],
    active: [base, {
        background: vars.color.muted,
        color: vars.color.foreground,
        fontWeight: 700,
    }],
});
export const hint = style({
    marginLeft: 'auto',
    color: vars.color.mutedForeground,
    fontSize: '0.63rem',
});

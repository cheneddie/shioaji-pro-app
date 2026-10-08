import { style } from '@vanilla-extract/css';
import { vars } from '../../../theme.css';

export const canvas = style({
    position: 'absolute',
    inset: 0,
    zIndex: 3,
    pointerEvents: 'none',
});
export const actions = style({
    position: 'absolute',
    zIndex: 6,
    top: 5,
    left: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    border: '1px solid ' + vars.color.border,
    borderRadius: vars.radius.sm,
    padding: '3px 6px',
    background: vars.color.panel,
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    fontSize: '0.63rem',
    pointerEvents: 'auto',
});

export const actionButton = style({
    cursor: 'pointer',
    border: '1px solid ' + vars.color.border,
    background: vars.color.background,
    color: vars.color.foreground,
});

// src/features/orderflow/components/footprint-panel.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../../theme.css';

export const wrap = style({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
});

export const toolbar = style({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '2px',
    padding: `4px ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

const buttonBase = style({
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    fontWeight: 500,
    padding: '2px 7px',
    cursor: 'pointer',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: vars.radius.sm,
    color: vars.color.mutedForeground,
    ':hover': { color: vars.color.foreground },
});

export const button = styleVariants({
    normal: [buttonBase],
    active: [
        buttonBase,
        {
            color: vars.color.foreground,
            background: vars.color.muted,
        },
    ],
});

export const select = style({
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    color: vars.color.foreground,
    background: vars.color.panel,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '2px 4px',
});

export const input = style({
    width: '48px',
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    color: vars.color.foreground,
    background: vars.color.panel,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '2px 4px',
});

export const separator = style({
    width: '1px',
    height: '16px',
    background: vars.color.border,
    margin: '0 3px',
});

export const badge = style({
    marginLeft: 'auto',
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    color: vars.color.accent,
    letterSpacing: '0.04em',
});

export const health = style({
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    color: vars.color.mutedForeground,
});

export const host = style({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
});

export const status = style({
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
});

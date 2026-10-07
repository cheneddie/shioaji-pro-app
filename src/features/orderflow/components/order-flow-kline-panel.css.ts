// src/features/orderflow/components/order-flow-kline-panel.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../../theme.css';

export const wrap = style({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
});

export const toolbar = style({
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: `4px ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

const buttonBase = style({
    fontFamily: vars.font.mono,
    fontSize: '0.7rem',
    fontWeight: 500,
    padding: '2px 9px',
    cursor: 'pointer',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: vars.radius.sm,
    color: vars.color.mutedForeground,
    ':hover': { color: vars.color.foreground },
});

export const button = styleVariants({
    normal: [buttonBase],
    active: [buttonBase, { color: vars.color.foreground, background: vars.color.muted }],
});

export const badge = style({
    marginLeft: 'auto',
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    color: vars.color.accent,
    letterSpacing: '0.04em',
});

export const host = style({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
});

export const status = style({
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
});

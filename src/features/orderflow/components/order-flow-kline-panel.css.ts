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

export const indicatorPanel = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))',
    gap: '5px 8px',
    padding: `6px ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    background: vars.color.panel,
    flexShrink: 0,
});

export const indicatorCheck = style({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    color: vars.color.foreground,
});

export const indicatorControl = style({
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    color: vars.color.mutedForeground,
});

export const indicatorField = style({
    width: '100%',
    minWidth: 0,
    fontFamily: vars.font.mono,
    fontSize: '0.65rem',
    color: vars.color.foreground,
    background: vars.color.background,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '2px 4px',
});

export const host = style({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
});

export const bubbleLayer = style({
    position: 'absolute',
    inset: 0,
    zIndex: 4,
    pointerEvents: 'none',
});

export const bubbleTooltip = style({
    position: 'absolute',
    zIndex: 5,
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    padding: '4px 6px',
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.border}`,
    background: vars.color.panelRaised,
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    lineHeight: 1.35,
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
});

export const status = style({
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
});

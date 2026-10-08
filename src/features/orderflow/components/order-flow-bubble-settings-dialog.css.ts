import { style } from '@vanilla-extract/css';
import { vars } from '../../../theme.css';

export const overlay = style({
    position: 'fixed', inset: 0, zIndex: 16000,
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    background: 'rgba(0,0,0,0.55)',
});
export const dialog = style({
    width: 'min(620px, 94vw)', maxHeight: '85vh', overflow: 'auto',
    padding: 14,
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.border}`,
    background: vars.color.panel,
    color: vars.color.foreground,
    boxShadow: '0 14px 50px rgba(0,0,0,0.4)',
});
export const header = style({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingBottom: 10, marginBottom: 10,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.88rem', fontWeight: 700,
});
export const grid = style({
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))',
    gap: 10, alignItems: 'end',
});
export const field = style({
    display: 'flex', flexDirection: 'column', gap: 4,
    fontSize: '0.72rem',
});
export const input = style({
    width: '100%', minWidth: 0, padding: '6px 8px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    color: vars.color.foreground,
    background: vars.color.background,
});
export const action = style({
    cursor: 'pointer', padding: '6px 10px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: vars.color.muted,
    color: vars.color.foreground,
});
export const note = style({
    fontSize: '0.67rem', color: vars.color.mutedForeground,
    marginTop: 12,
});

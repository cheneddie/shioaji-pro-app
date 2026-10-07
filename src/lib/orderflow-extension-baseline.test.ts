// Development 0: protect native panel routing before Order Flow extension work.
// This intentionally checks the production router source without exporting/refactoring
// BlockBody solely for tests.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOCK_META, type BlockType } from './workspace';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const protectedPanels = [
    { type: 'chart', component: 'CandleChart' },
    { type: 'flash', component: 'LiveFlashOrder' },
    { type: 'volprofile', component: 'VolProfile' },
    { type: 'depth', component: 'DepthLadder' },
    { type: 'tape', component: 'TickTape' },
] as const satisfies ReadonlyArray<{ type: BlockType; component: string }>;

function switchCaseBody(type: BlockType): string {
    const marker = `case '${type}':`;
    const start = appSource.indexOf(marker);
    expect(start, `missing BlockBody route for ${type}`).toBeGreaterThanOrEqual(0);
    const next = appSource.indexOf("\n        case '", start + marker.length);
    return appSource.slice(start, next === -1 ? appSource.length : next);
}

describe('Order Flow extension native-panel baseline', () => {
    it.each(protectedPanels)(
        'keeps $type registered and routed to $component',
        ({ type, component }) => {
            expect(BLOCK_META[type]).toBeDefined();
            expect(switchCaseBody(type)).toContain(`<${component}`);
        },
    );

    it('does not register future Order Flow panels during Development 0', () => {
        expect('orderflow_kline' in BLOCK_META).toBe(false);
        expect('footprint' in BLOCK_META).toBe(false);
        expect('flowladder' in BLOCK_META).toBe(false);
    });
});

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

    it('keeps Development 3 K-line and adds Development 4 Footprint without future panels', () => {
        expect(BLOCK_META.orderflow_kline).toMatchObject({
            category: 'market',
            pinnable: true,
            singleton: false,
        });
        expect(switchCaseBody('orderflow_kline')).toContain('<OrderFlowKlinePanel');
        expect(BLOCK_META.footprint).toMatchObject({
            category: 'market',
            pinnable: true,
            singleton: false,
        });
        expect(switchCaseBody('footprint')).toContain('<FootprintPanel');
        expect('flowladder' in BLOCK_META).toBe(false);
    });

    it('keeps Footprint isolated from native panels and direct market subscriptions', () => {
        const source = readFileSync(
            new URL('../features/orderflow/components/footprint-panel.tsx', import.meta.url),
            'utf8',
        );
        expect(source).not.toContain("from '../../../components/candle-chart'");
        expect(source).not.toContain("from '../../../components/flash-order'");
        expect(source).not.toContain("from '../../../components/vol-profile'");
        expect(source).not.toContain("from '../../../lib/stream'");
        expect(source).not.toContain('retainQuote');
        expect(source).toContain('getOrderFlowRuntime');
        expect(source).toContain('runtime.subscribeTicks');
        expect(source).toMatch(/runtime\s*\.\s*loadHistory\s*\(/);
    });

    it('keeps the Order Flow K-line isolated from native execution, indicator and drawing implementations', () => {
        const source = readFileSync(
            new URL('../features/orderflow/components/order-flow-kline-panel.tsx', import.meta.url),
            'utf8',
        );
        expect(source).not.toContain("from '../../../components/candle-chart'");
        expect(source).not.toContain('placeQuickOrder');
        expect(source).not.toContain('ChartDrawingTools');
        expect(source).not.toContain('IndicatorDialog');
        expect(source).toContain("from 'lightweight-charts'");
        expect(source).toContain('getOrderFlowRuntime');
        expect(source).toContain('React StrictMode runs setup -> cleanup -> setup');
    });
});

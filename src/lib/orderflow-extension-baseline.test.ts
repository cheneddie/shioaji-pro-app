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

    it('keeps Development 3–7 independent Order Flow panels registered without touching native routes', () => {
        expect(BLOCK_META.orderflow_kline).toMatchObject({
            category: 'market',
            pinnable: true,
            singleton: false,
        });
        expect(switchCaseBody('orderflow_kline')).toContain('<OrderFlowWorkspacePanel');
        const switcher = readFileSync(
            new URL('../features/orderflow/components/order-flow-workspace-panel.tsx', import.meta.url),
            'utf8',
        );
        expect(switcher).toContain('<OrderFlowKlinePanel');
        expect(switcher).toContain('<FootprintPanel');
        expect(switcher).toContain('<CandleChart');
        expect(switcher).toContain("view === 'native'");
        expect(BLOCK_META.footprint).toMatchObject({
            category: 'market',
            pinnable: true,
            singleton: false,
        });
        expect(switchCaseBody('footprint')).toContain('<FootprintPanel');
        expect(BLOCK_META.flowladder).toMatchObject({
            category: 'market', pinnable: true, singleton: false,
        });
        expect(switchCaseBody('flowladder')).toContain('<FlowLadderPanel');
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

    it('keeps Development 5 Bubble inside Order Flow K-line and outside native indicators', () => {
        const kline = readFileSync(
            new URL('../features/orderflow/components/order-flow-kline-panel.tsx', import.meta.url),
            'utf8',
        );
        const bubble = readFileSync(
            new URL('../features/orderflow/components/order-flow-bubble-indicator.tsx', import.meta.url),
            'utf8',
        );
        expect(kline).toContain('OrderFlowBubbleIndicator');
        expect(kline).not.toContain("from '../../../lib/indicator-defs'");
        expect(bubble).toContain('getOrderFlowRuntime');
        expect(bubble).toContain('runtime.subscribeTicks');
        expect(bubble).toMatch(/runtime\s*\.\s*loadHistory\s*\(/);
        expect(bubble).not.toContain("from '../../../lib/stream'");
        expect(bubble).not.toContain('retainQuote');
        expect('flowladder' in BLOCK_META).toBe(true);
    });

    it('rejects unsupported combo contracts before mounting Flow Ladder', () => {
        const guard = appSource.slice(appSource.indexOf('function comboBlockMessage('));
        expect(guard).toContain("if (type === 'flowladder')");
        expect(guard).toContain('組合商品報價不支援單商品逐價位');
    });

    it('keeps Flow Ladder read-only and on the shared runtime', () => {
        const source = readFileSync(
            new URL('../features/orderflow/components/flow-ladder-panel.tsx', import.meta.url),
            'utf8',
        );
        expect(source).toContain('getOrderFlowRuntime');
        expect(source).toContain('runtime.subscribe');
        expect(source).not.toContain('retainQuote');
        expect(source).not.toContain("from '../../../lib/stream'");
        expect(source).not.toContain('placeOrder');
        expect(source).not.toContain('placeQuickOrder');
        expect(source).not.toContain("from '../../../components/flash-order'");
        expect(source).not.toContain("from '../../../components/depth-ladder'");
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

// src/features/orderflow/components/order-flow-bubble-indicator.test.tsx

import {
    act,
    create,
    type ReactTestRenderer,
} from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';
import {
    DEFAULT_BUBBLE_SETTINGS,
} from '../domain/bubble';

const runtime = vi.hoisted(() => {
    let tickListener: ((tick: unknown) => void) | null = null;
    const release = vi.fn();
    const offTick = vi.fn();
    return {
        release,
        offTick,
        retain: vi.fn(() => release),
        subscribeTicks: vi.fn(
            (listener: (tick: unknown) => void) => {
                tickListener = listener;
                return offTick;
            },
        ),
        loadHistory: vi.fn(),
        emit(tick: unknown) {
            tickListener?.(tick);
        },
        reset() {
            tickListener = null;
            release.mockClear();
            offTick.mockClear();
            this.retain.mockClear();
            this.subscribeTicks.mockClear();
            this.loadHistory.mockReset();
        },
    };
});

vi.mock('../runtime/order-flow-runtime', () => ({
    getOrderFlowRuntime: () => runtime,
}));

vi.mock('./order-flow-bubble-layer', () => ({
    OrderFlowBubbleLayer: ({
        candidates,
    }: {
        candidates: unknown[];
    }) => (
        <div
            data-testid='bubble-layer'
            data-count={candidates.length}
        />
    ),
}));

import { OrderFlowBubbleIndicator } from './order-flow-bubble-indicator';

const contract: ContractInfo = {
    region: 'TW',
    exchange: 'TAIFEX',
    code: 'TXFR1',
    security_type: 'FUT',
    target_code: 'TXFJ6',
    name: '臺股期貨',
    currency: 'TWD',
    limit_up: 0,
    limit_down: 0,
    reference: 100,
    day_trade: 'Yes',
    update_date: '2026-10-08',
    category: 'TXF',
    margin_trading_balance: 0,
    short_selling_balance: 0,
    tick: 1,
    underlying_kind: 'I',
};

const colors = {
    up: '#f00',
    upVol: '#f008',
    down: '#0f0',
    downVol: '#0f08',
    text: '#aaa',
    grid: '#222',
    crosshair: '#39f',
    border: '#333',
    labelBg: '#111',
};

const dummyRef = { current: null };

async function flush() {
    for (let index = 0; index < 5; index += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

describe('OrderFlowBubbleIndicator runtime lifecycle', () => {
    beforeEach(() => {
        runtime.reset();
        runtime.loadHistory.mockResolvedValue({
            date: '2026-10-08',
            ticks: [
                {
                    datetime: '2026-10-08 09:00:01.000',
                    eventTimeMs: Date.UTC(
                        2026,
                        9,
                        8,
                        9,
                        0,
                        1,
                    ),
                    price: 100,
                    volume: 10,
                    tickType: 1,
                    side: 'buy',
                },
            ],
        });
    });

    it('hydrates history through the shared runtime and releases ownership', async () => {
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(
                <OrderFlowBubbleIndicator
                    contract={contract}
                    timeframeMinutes={1}
                    dayOnly={false}
                    runtimeSession='all'
                    historyRevision={0}
                    settings={{
                        ...DEFAULT_BUBBLE_SETTINGS,
                        enabled: true,
                    }}
                    hostRef={dummyRef}
                    chartRef={dummyRef}
                    candleRef={dummyRef}
                    colors={colors}
                />,
            );
        });
        await flush();

        expect(runtime.retain).toHaveBeenCalledTimes(1);
        expect(runtime.subscribeTicks).toHaveBeenCalledTimes(1);
        expect(runtime.loadHistory).toHaveBeenCalledTimes(1);
        expect(
            view.root.findByProps({
                'data-testid': 'bubble-layer',
            }).props['data-count'],
        ).toBe(1);

        await act(async () => view.unmount());
        expect(runtime.offTick).toHaveBeenCalledTimes(1);
        expect(runtime.release).toHaveBeenCalledTimes(1);
    });

    it('consumes live ticks from the same runtime consumer path', async () => {
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(
                <OrderFlowBubbleIndicator
                    contract={contract}
                    timeframeMinutes={1}
                    dayOnly={false}
                    runtimeSession='all'
                    historyRevision={0}
                    settings={{
                        ...DEFAULT_BUBBLE_SETTINGS,
                        enabled: true,
                    }}
                    hostRef={dummyRef}
                    chartRef={dummyRef}
                    candleRef={dummyRef}
                    colors={colors}
                />,
            );
        });
        await flush();

        await act(async () => {
            runtime.emit({
                code: 'TXFR1',
                date: '2026/10/08',
                time: '09:00:02.000',
                price: 101,
                volume: 5,
                totalVolume: 15,
                tickType: 2,
                simtrade: false,
                intradayOdd: false,
                raw: {},
            });
            await new Promise((resolve) =>
                setTimeout(resolve, 60),
            );
        });

        expect(
            view.root.findByProps({
                'data-testid': 'bubble-layer',
            }).props['data-count'],
        ).toBe(2);

        await act(async () => view.unmount());
    });
});

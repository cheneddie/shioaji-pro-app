// src/features/orderflow/components/footprint-panel.test.tsx

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';

const runtime = vi.hoisted(() => {
    let tickListener: ((tick: unknown) => void) | null = null;
    let snapshotListener: (() => void) | null = null;
    const release = vi.fn();
    const offTick = vi.fn();
    const offHealth = vi.fn();
    return {
        release,
        offTick,
        offHealth,
        retain: vi.fn(() => release),
        subscribeTicks: vi.fn((listener: (tick: unknown) => void) => {
            tickListener = listener;
            return offTick;
        }),
        subscribe: vi.fn((listener: () => void) => {
            snapshotListener = listener;
            return offHealth;
        }),
        getSnapshot: vi.fn(() => ({
            health: { streamStatus: 'live' },
        })),
        loadHistory: vi.fn(),
        emitTick(tick: unknown) {
            tickListener?.(tick);
        },
        emitHealth() {
            snapshotListener?.();
        },
        reset() {
            tickListener = null;
            snapshotListener = null;
            release.mockClear();
            offTick.mockClear();
            offHealth.mockClear();
            this.retain.mockClear();
            this.subscribeTicks.mockClear();
            this.subscribe.mockClear();
            this.getSnapshot.mockClear();
            this.loadHistory.mockReset();
        },
    };
});

vi.mock('../runtime/order-flow-runtime', () => ({
    getOrderFlowRuntime: () => runtime,
}));

vi.mock('../runtime/order-flow-history', () => ({
    nextOrderFlowHistoryRevision: () => 1,
}));

vi.mock('../../../lib/theme-store', () => ({
    useThemeSettings: () => ({ mode: 'dark', convention: 'tw' }),
    getChartColors: () => ({
        up: '#f00',
        upVol: '#f008',
        down: '#0f0',
        downVol: '#0f08',
        text: '#aaa',
        grid: '#222',
        crosshair: '#39f',
        border: '#333',
        labelBg: '#111',
    }),
}));

vi.mock('./footprint-grid', () => ({
    FootprintGrid: ({
        bars,
    }: {
        bars: Array<{ volume: number }>;
    }) => (
        <div
            data-testid='footprint-grid'
            data-bars={bars.length}
            data-volume={bars.reduce(
                (sum, bar) => sum + bar.volume,
                0,
            )}
        />
    ),
}));

import { FootprintPanel } from './footprint-panel';

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

describe('FootprintPanel lifecycle', () => {
    beforeEach(() => {
        runtime.reset();
        localStorage.clear();
        runtime.loadHistory.mockResolvedValue({
            date: '2026-10-08',
            ticks: [
                {
                    datetime: '2026-10-08 09:00:01.000',
                    eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 1),
                    price: 100,
                    volume: 2,
                    tickType: 1,
                    side: 'buy',
                },
            ],
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads history through the shared runtime and renders footprint bars', async () => {
        render(
            <FootprintPanel
                panelId='fp-1'
                contract={contract}
                sessionMode='all'
            />,
        );
        await waitFor(() =>
            expect(
                screen.getByTestId('footprint-grid'),
            ).toHaveAttribute('data-bars', '1'),
        );
        expect(runtime.retain).toHaveBeenCalledTimes(1);
        expect(runtime.loadHistory).toHaveBeenCalledTimes(1);
        expect(runtime.subscribeTicks).toHaveBeenCalledTimes(1);
    });

    it('applies deduped live ticks without opening another runtime', async () => {
        render(
            <FootprintPanel
                panelId='fp-2'
                contract={contract}
                sessionMode='all'
            />,
        );
        await waitFor(() =>
            expect(
                screen.getByTestId('footprint-grid'),
            ).toHaveAttribute('data-volume', '2'),
        );

        act(() => {
            runtime.emitTick({
                code: 'TXFR1',
                date: '2026/10/08',
                time: '09:00:02.000',
                price: 101,
                volume: 3,
                totalVolume: 5,
                tickType: 2,
                simtrade: false,
                intradayOdd: false,
                raw: {},
            });
        });

        await waitFor(() =>
            expect(
                screen.getByTestId('footprint-grid'),
            ).toHaveAttribute('data-volume', '5'),
        );
        expect(runtime.retain).toHaveBeenCalledTimes(1);
    });

    it('releases the shared runtime on unmount', async () => {
        const view = render(
            <FootprintPanel
                panelId='fp-3'
                contract={contract}
                sessionMode='all'
            />,
        );
        await waitFor(() =>
            expect(runtime.loadHistory).toHaveBeenCalled(),
        );
        view.unmount();
        expect(runtime.offTick).toHaveBeenCalledTimes(1);
        expect(runtime.offHealth).toHaveBeenCalledTimes(1);
        expect(runtime.release).toHaveBeenCalledTimes(1);
    });
});

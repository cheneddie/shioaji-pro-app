// src/features/orderflow/components/footprint-panel.test.tsx

import {
    act,
    create,
    type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';

const memoryStorage = new Map<string, string>();
const localStorageStub: Storage = {
    get length() {
        return memoryStorage.size;
    },
    clear() {
        memoryStorage.clear();
    },
    getItem(key: string) {
        return memoryStorage.get(key) ?? null;
    },
    key(index: number) {
        return [...memoryStorage.keys()][index] ?? null;
    },
    removeItem(key: string) {
        memoryStorage.delete(key);
    },
    setItem(key: string, value: string) {
        memoryStorage.set(key, String(value));
    },
};
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageStub,
});


const runtime = vi.hoisted(() => {
    let tickListener: ((tick: unknown) => void) | null = null;
    let snapshotListener: (() => void) | null = null;
    const release = vi.fn();
    const offTick = vi.fn();
    const offHealth = vi.fn();
    const retain = vi.fn(() => release);
    const subscribeTicks = vi.fn(
        (listener: (tick: unknown) => void) => {
            tickListener = listener;
            return offTick;
        },
    );
    const subscribe = vi.fn((listener: () => void) => {
        snapshotListener = listener;
        return offHealth;
    });
    const getSnapshot = vi.fn(() => ({
        health: { streamStatus: 'live' },
    }));
    const loadHistory = vi.fn();

    return {
        release,
        offTick,
        offHealth,
        retain,
        subscribeTicks,
        subscribe,
        getSnapshot,
        loadHistory,
        bufferedTicks: vi.fn(() => ({ ticks: [], truncated: false })),
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
            retain.mockClear();
            subscribeTicks.mockClear();
            subscribe.mockClear();
            getSnapshot.mockClear();
            loadHistory.mockReset();
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

async function mountPanel(panelId: string): Promise<ReactTestRenderer> {
    let view!: ReactTestRenderer;
    await act(async () => {
        view = create(
            <FootprintPanel
                panelId={panelId}
                contract={contract}
                sessionMode='all'
            />,
        );
        await Promise.resolve();
        await Promise.resolve();
    });
    return view;
}

function gridProps(view: ReactTestRenderer) {
    return view.root.findByProps({
        'data-testid': 'footprint-grid',
    }).props as Record<string, unknown>;
}

describe('FootprintPanel lifecycle', () => {
    afterEach(() => vi.restoreAllMocks());

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-08T02:00:00Z'));
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

    it('loads history through the shared runtime and renders footprint bars', async () => {
        const view = await mountPanel('fp-1');
        expect(gridProps(view)['data-bars']).toBe(1);
        expect(runtime.retain).toHaveBeenCalledTimes(1);
        expect(runtime.loadHistory).toHaveBeenCalledTimes(1);
        expect(runtime.subscribeTicks).toHaveBeenCalledTimes(1);
        await act(async () => view.unmount());
    });

    it('applies live ticks without opening another runtime', async () => {
        const view = await mountPanel('fp-2');
        expect(gridProps(view)['data-volume']).toBe(2);

        await act(async () => {
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
            await new Promise((resolve) => setTimeout(resolve, 40));
        });

        expect(gridProps(view)['data-volume']).toBe(5);
        expect(runtime.retain).toHaveBeenCalledTimes(1);
        await act(async () => view.unmount());
    });

    it('continues rendering even if localStorage rejects preference writes', async () => {
        const denied = vi.spyOn(localStorage, 'setItem')
            .mockImplementation(() => { throw new Error('QuotaExceededError'); });
        try {
            const view = await mountPanel('fp-denied-storage');
            expect(gridProps(view)['data-bars']).toBe(1);
            expect(runtime.retain).toHaveBeenCalledTimes(1);
            await act(async () => view.unmount());
            expect(runtime.release).toHaveBeenCalledTimes(1);
        } finally {
            denied.mockRestore();
        }
    });

    it('releases the shared runtime on unmount', async () => {
        const view = await mountPanel('fp-3');
        expect(runtime.loadHistory).toHaveBeenCalledTimes(1);
        await act(async () => view.unmount());
        expect(runtime.offTick).toHaveBeenCalledTimes(1);
        expect(runtime.offHealth).toHaveBeenCalledTimes(1);
        expect(runtime.release).toHaveBeenCalledTimes(1);
    });
});

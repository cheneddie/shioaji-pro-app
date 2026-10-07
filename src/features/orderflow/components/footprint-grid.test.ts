// src/features/orderflow/components/footprint-grid.test.ts

import { describe, expect, it } from 'vitest';
import {
    footprintHeatAlpha,
    resolveFootprintLod,
    shouldRenderFootprintLevel,
} from './footprint-grid';

describe('Footprint LOD', () => {
    it('uses full numbers only when bars and price rows are readable', () => {
        expect(resolveFootprintLod(90, 14)).toBe('detail');
        expect(resolveFootprintLod(71, 14)).toBe('heatmap');
        expect(resolveFootprintLod(90, 11)).toBe('heatmap');
    });

    it('falls back to candle summary when cells are too dense', () => {
        expect(resolveFootprintLod(17, 12)).toBe('summary');
        expect(resolveFootprintLod(40, 2)).toBe('summary');
    });
});


describe('Footprint presentation controls', () => {
    it('uses minimum volume as a render-only threshold', () => {
        expect(
            shouldRenderFootprintLevel({ totalVolume: 9 }, 10),
        ).toBe(false);
        expect(
            shouldRenderFootprintLevel({ totalVolume: 10 }, 10),
        ).toBe(true);
        expect(
            shouldRenderFootprintLevel({ totalVolume: 1 }, Number.NaN),
        ).toBe(true);
    });

    it('scales heat alpha without changing volume semantics', () => {
        expect(footprintHeatAlpha(0, 100)).toBeCloseTo(0.08);
        expect(footprintHeatAlpha(1, 100)).toBeCloseTo(0.36);
        expect(footprintHeatAlpha(1, 50)).toBeCloseTo(0.18);
        expect(footprintHeatAlpha(2, 100)).toBeCloseTo(0.36);
        expect(footprintHeatAlpha(-1, 100)).toBeCloseTo(0.08);
        expect(footprintHeatAlpha(1, 0)).toBe(0);
    });
});

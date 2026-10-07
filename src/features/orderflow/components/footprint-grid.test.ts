// src/features/orderflow/components/footprint-grid.test.ts

import { describe, expect, it } from 'vitest';
import { resolveFootprintLod } from './footprint-grid';

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

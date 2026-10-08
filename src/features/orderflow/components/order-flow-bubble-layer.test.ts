// src/features/orderflow/components/order-flow-bubble-layer.test.ts

import { describe, expect, it } from 'vitest';
import {
    bubbleRadius,
    hitTestBubble,
} from '../domain/bubble';

describe('Order Flow Bubble layer math contract', () => {
    it('keeps a positive radius for tiny visible trades', () => {
        expect(
            bubbleRadius(
                1,
                100,
                {
                    minimumRadius: 1,
                    scalePercent: 100,
                },
                10,
            ),
        ).toBeGreaterThanOrEqual(1);
    });

    it('uses real circle radius for pointer hit testing', () => {
        const rendered = [{
            x: 50,
            y: 50,
            radius: 12,
            candidate: {
                timestamp: 60,
                price: 100,
                side: 'sell' as const,
                volume: 20,
                rawValue: 20,
            },
        }];
        expect(hitTestBubble(rendered, 62, 50)).not.toBeNull();
        expect(hitTestBubble(rendered, 63, 50)).toBeNull();
    });
});

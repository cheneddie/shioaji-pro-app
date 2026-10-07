// src/features/orderflow/components/order-flow-bubble-layer.tsx

import type {
    IChartApi,
    ISeriesApi,
    UTCTimestamp,
} from 'lightweight-charts';
import {
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import type { ChartColors } from '../../../lib/theme-store';
import {
    bubbleRadius,
    bubbleScaleMaximum,
    hitTestBubble,
    type BubbleCandidate,
    type BubbleSettings,
    type RenderedBubble,
} from '../domain/bubble';
import * as styles from './order-flow-kline-panel.css';

function barWidthFromCoordinates(values: number[]) {
    const unique = [...new Set(values)]
        .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let index = 1; index < unique.length; index += 1) {
        const gap = unique[index]! - unique[index - 1]!;
        if (gap > 0) gaps.push(gap);
    }
    if (gaps.length === 0) return 12;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] ?? 12;
}

export function OrderFlowBubbleLayer({
    hostRef,
    chartRef,
    candleRef,
    candidates,
    settings,
    colors,
}: {
    hostRef: RefObject<HTMLDivElement | null>;
    chartRef: RefObject<IChartApi | null>;
    candleRef: RefObject<ISeriesApi<'Candlestick'> | null>;
    candidates: BubbleCandidate[];
    settings: BubbleSettings;
    colors: ChartColors;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderedRef = useRef<RenderedBubble[]>([]);
    const frameRef = useRef<number | null>(null);
    const [hovered, setHovered] =
        useState<RenderedBubble | null>(null);

    useEffect(() => {
        if (!settings.enabled) {
            renderedRef.current = [];
            setHovered(null);
            return;
        }
        const host = hostRef.current;
        const canvas = canvasRef.current;
        const chart = chartRef.current;
        const candle = candleRef.current;
        if (!host || !canvas || !chart || !candle) return;

        const draw = () => {
            frameRef.current = null;
            const width = Math.max(1, host.clientWidth);
            const height = Math.max(1, host.clientHeight);
            const dpr = Math.max(
                1,
                window.devicePixelRatio || 1,
            );
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);

            const timeScale = chart.timeScale();
            const projected = candidates.flatMap((candidate) => {
                const x = timeScale.timeToCoordinate(
                    candidate.timestamp as UTCTimestamp,
                );
                const y = candle.priceToCoordinate(
                    candidate.price,
                );
                if (
                    x === null ||
                    y === null ||
                    x < 0 ||
                    x > width ||
                    y < 0 ||
                    y > height
                ) {
                    return [];
                }
                return [{ candidate, x, y }];
            });
            const barWidth = barWidthFromCoordinates(
                projected.map((item) => item.x),
            );
            const visible = projected.map(
                (item) => item.candidate,
            );

            const rendered: RenderedBubble[] = [];
            for (const item of projected) {
                const maximum = bubbleScaleMaximum(
                    item.candidate,
                    visible,
                    settings.scaleMode,
                );
                const radius = bubbleRadius(
                    item.candidate.volume,
                    maximum,
                    settings,
                    barWidth,
                );
                const color =
                    item.candidate.side === 'buy'
                        ? colors.up
                        : colors.down;

                ctx.save();
                ctx.globalAlpha = settings.opacity / 100;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(
                    item.x,
                    item.y,
                    radius,
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
                ctx.restore();

                ctx.save();
                ctx.globalAlpha = 0.72;
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(
                    item.x,
                    item.y,
                    radius,
                    0,
                    Math.PI * 2,
                );
                ctx.stroke();
                ctx.restore();

                rendered.push({
                    x: item.x,
                    y: item.y,
                    radius,
                    candidate: item.candidate,
                });
            }
            renderedRef.current = rendered;
        };

        const schedule = () => {
            if (frameRef.current !== null) return;
            frameRef.current =
                window.requestAnimationFrame(draw);
        };

        draw();
        const timeScale = chart.timeScale();
        timeScale.subscribeVisibleLogicalRangeChange(
            schedule,
        );
        const resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(host);

        const onMove = (event: MouseEvent) => {
            const rect = host.getBoundingClientRect();
            const hit = hitTestBubble(
                renderedRef.current,
                event.clientX - rect.left,
                event.clientY - rect.top,
            );
            setHovered((current) =>
                current === hit ? current : hit,
            );
        };
        const onLeave = () => setHovered(null);
        host.addEventListener('mousemove', onMove);
        host.addEventListener('mouseleave', onLeave);

        return () => {
            timeScale.unsubscribeVisibleLogicalRangeChange(
                schedule,
            );
            resizeObserver.disconnect();
            host.removeEventListener('mousemove', onMove);
            host.removeEventListener('mouseleave', onLeave);
            if (frameRef.current !== null) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            renderedRef.current = [];
        };
    }, [
        hostRef,
        chartRef,
        candleRef,
        candidates,
        settings,
        colors,
    ]);

    if (!settings.enabled) return null;

    return (
        <>
            <canvas
                ref={canvasRef}
                aria-label='Order Flow Bubble indicator'
                className={styles.bubbleLayer}
            />
            {hovered && (
                <div
                    className={styles.bubbleTooltip}
                    style={{
                        left: hovered.x + hovered.radius + 8,
                        top: hovered.y,
                    }}
                >
                    <div>
                        {hovered.candidate.side === 'buy'
                            ? 'BUY'
                            : 'SELL'}
                    </div>
                    <div>
                        P {hovered.candidate.price}
                    </div>
                    <div>
                        V {hovered.candidate.volume}
                    </div>
                </div>
            )}
        </>
    );
}

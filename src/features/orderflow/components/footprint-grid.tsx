// src/features/orderflow/components/footprint-grid.tsx

import { useEffect, useRef } from 'react';
import type { ChartColors } from '../../../lib/theme-store';
import type { ContractInfo } from '../../../lib/types/contract';
import { formatToTick } from '../../../lib/utils/ticksize';
import type { FootprintBar, FootprintLevel } from '../domain/contracts';
import type { FootprintDisplayMode } from '../domain/footprint';

export type FootprintLod = 'detail' | 'heatmap' | 'summary';

export function resolveFootprintLod(
    barWidth: number,
    rowHeight: number,
): FootprintLod {
    if (barWidth >= 72 && rowHeight >= 12) return 'detail';
    if (barWidth >= 18 && rowHeight >= 2.5) return 'heatmap';
    return 'summary';
}

export function shouldRenderFootprintLevel(
    level: Pick<FootprintLevel, 'totalVolume'>,
    minimumVolume: number,
): boolean {
    const threshold = Number.isFinite(minimumVolume)
        ? Math.max(1, minimumVolume)
        : 1;
    return level.totalVolume >= threshold;
}

export function footprintHeatAlpha(
    intensity: number,
    opacityPercent: number,
): number {
    const normalizedIntensity = Number.isFinite(intensity)
        ? Math.max(0, Math.min(1, intensity))
        : 0;
    const normalizedOpacity = Number.isFinite(opacityPercent)
        ? Math.max(0, Math.min(100, opacityPercent)) / 100
        : 1;
    return (0.08 + normalizedIntensity * 0.28) * normalizedOpacity;
}

function alphaFill(
    ctx: CanvasRenderingContext2D,
    color: string,
    alpha: number,
) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = color;
    return () => ctx.restore();
}

function levelColor(
    level: FootprintLevel,
    colors: ChartColors,
): string {
    if (level.delta > 0) return colors.up;
    if (level.delta < 0) return colors.down;
    return colors.text;
}

function formatCompact(value: number) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (abs >= 10_000) return `${Math.round(value / 1_000)}k`;
    return String(Math.round(value));
}

function drawSummary(
    ctx: CanvasRenderingContext2D,
    bars: FootprintBar[],
    x0: number,
    barWidth: number,
    plotTop: number,
    plotBottom: number,
    minPrice: number,
    maxPrice: number,
    colors: ChartColors,
) {
    const span = Math.max(1e-9, maxPrice - minPrice);
    const y = (price: number) =>
        plotBottom -
        ((price - minPrice) / span) * (plotBottom - plotTop);

    bars.forEach((bar, index) => {
        const x = x0 + index * barWidth + barWidth / 2;
        const color = bar.close >= bar.open ? colors.up : colors.down;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y(bar.high));
        ctx.lineTo(x, y(bar.low));
        ctx.stroke();

        const bodyTop = Math.min(y(bar.open), y(bar.close));
        const bodyBottom = Math.max(y(bar.open), y(bar.close));
        ctx.fillRect(
            x - Math.max(1, barWidth * 0.22),
            bodyTop,
            Math.max(2, barWidth * 0.44),
            Math.max(2, bodyBottom - bodyTop),
        );
    });
}

export function FootprintGrid({
    bars,
    contract,
    colors,
    mode,
    visibleBars,
    minimumVolume,
    opacity,
    showPoc,
    showDeltaPoc,
    showImbalance,
}: {
    bars: FootprintBar[];
    contract: ContractInfo;
    colors: ChartColors;
    mode: FootprintDisplayMode;
    visibleBars: number;
    minimumVolume: number;
    opacity: number;
    showPoc: boolean;
    showDeltaPoc: boolean;
    showImbalance: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const host = canvas?.parentElement;
        if (!canvas || !host) return;

        const draw = () => {
            const width = Math.max(1, host.clientWidth);
            const height = Math.max(1, host.clientHeight);
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.font = "10px 'JetBrains Mono', monospace";
            ctx.textBaseline = 'middle';

            const view = bars.slice(-Math.max(1, visibleBars));
            if (view.length === 0) return;

            const axisWidth = 58;
            const timeHeight = 18;
            const plotTop = 4;
            const plotBottom = Math.max(plotTop + 1, height - timeHeight);
            const plotWidth = Math.max(1, width - axisWidth);
            const barWidth = plotWidth / view.length;

            const prices = [
                ...new Set(
                    view.flatMap((bar) => bar.levels.map((level) => level.price)),
                ),
            ].sort((a, b) => a - b);
            if (prices.length === 0) return;
            const minPrice = prices[0]!;
            const maxPrice = prices[prices.length - 1]!;
            const rowHeight = (plotBottom - plotTop) / prices.length;
            const lod = resolveFootprintLod(barWidth, rowHeight);

            ctx.strokeStyle = colors.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(axisWidth, plotTop);
            ctx.lineTo(axisWidth, plotBottom);
            ctx.moveTo(axisWidth, plotBottom);
            ctx.lineTo(width, plotBottom);
            ctx.stroke();

            if (lod === 'summary') {
                drawSummary(
                    ctx,
                    view,
                    axisWidth,
                    barWidth,
                    plotTop,
                    plotBottom,
                    minPrice,
                    maxPrice,
                    colors,
                );
            } else {
                const priceIndex = new Map(
                    prices.map((price, index) => [price, index] as const),
                );
                const maxLevelVolume = Math.max(
                    1,
                    ...view.flatMap((bar) =>
                        bar.levels.map((level) => level.totalVolume),
                    ),
                );

                view.forEach((bar, barIndex) => {
                    const x = axisWidth + barIndex * barWidth;
                    for (const level of bar.levels) {
                        const index = priceIndex.get(level.price);
                        if (index === undefined) continue;
                        if (
                            !shouldRenderFootprintLevel(
                                level,
                                minimumVolume,
                            )
                        ) {
                            continue;
                        }
                        const y =
                            plotBottom - (index + 1) * rowHeight;
                        const intensity =
                            level.totalVolume / maxLevelVolume;
                        const restore = alphaFill(
                            ctx,
                            levelColor(level, colors),
                            footprintHeatAlpha(intensity, opacity),
                        );
                        ctx.fillRect(
                            x + 0.5,
                            y + 0.5,
                            Math.max(0, barWidth - 1),
                            Math.max(0, rowHeight - 1),
                        );
                        restore();

                        if (
                            showPoc &&
                            bar.pocPrice !== undefined &&
                            level.price === bar.pocPrice
                        ) {
                            ctx.strokeStyle = colors.crosshair;
                            ctx.setLineDash([]);
                            ctx.strokeRect(
                                x + 1,
                                y + 1,
                                Math.max(0, barWidth - 2),
                                Math.max(0, rowHeight - 2),
                            );
                        }
                        if (
                            showDeltaPoc &&
                            bar.deltaPocPrice !== undefined &&
                            level.price === bar.deltaPocPrice
                        ) {
                            ctx.strokeStyle = colors.text;
                            ctx.setLineDash([3, 2]);
                            ctx.strokeRect(
                                x + 2,
                                y + 2,
                                Math.max(0, barWidth - 4),
                                Math.max(0, rowHeight - 4),
                            );
                            ctx.setLineDash([]);
                        }

                        if (showImbalance) {
                            if (
                                level.sellImbalance ||
                                level.sellHorizontalImbalance
                            ) {
                                ctx.fillStyle = colors.down;
                                ctx.fillRect(
                                    x + 1,
                                    y + 1,
                                    3,
                                    Math.max(1, rowHeight - 2),
                                );
                            }
                            if (
                                level.buyImbalance ||
                                level.buyHorizontalImbalance
                            ) {
                                ctx.fillStyle = colors.up;
                                ctx.fillRect(
                                    x + barWidth - 4,
                                    y + 1,
                                    3,
                                    Math.max(1, rowHeight - 2),
                                );
                            }
                        }

                        if (lod !== 'detail') continue;
                        ctx.fillStyle = colors.text;
                        if (mode === 'bidask') {
                            ctx.textAlign = 'right';
                            ctx.fillText(
                                formatCompact(level.sellVolume),
                                x + barWidth / 2 - 3,
                                y + rowHeight / 2,
                            );
                            ctx.textAlign = 'left';
                            ctx.fillText(
                                formatCompact(level.buyVolume),
                                x + barWidth / 2 + 3,
                                y + rowHeight / 2,
                            );
                        } else {
                            const value =
                                mode === 'delta'
                                    ? level.delta
                                    : level.totalVolume;
                            ctx.fillStyle =
                                mode === 'delta'
                                    ? levelColor(level, colors)
                                    : colors.text;
                            ctx.textAlign = 'center';
                            ctx.fillText(
                                formatCompact(value),
                                x + barWidth / 2,
                                y + rowHeight / 2,
                            );
                        }
                    }
                    if (barIndex > 0) {
                        ctx.strokeStyle = colors.grid;
                        ctx.beginPath();
                        ctx.moveTo(x, plotTop);
                        ctx.lineTo(x, plotBottom);
                        ctx.stroke();
                    }
                });

                const labelEvery = Math.max(
                    1,
                    Math.ceil(12 / Math.max(1, rowHeight)),
                );
                ctx.fillStyle = colors.text;
                ctx.textAlign = 'right';
                prices.forEach((price, index) => {
                    if (index % labelEvery !== 0) return;
                    const y =
                        plotBottom - (index + 0.5) * rowHeight;
                    ctx.fillText(
                        formatToTick(contract, price, {
                            grouping: false,
                        }),
                        axisWidth - 5,
                        y,
                    );
                });
            }

            ctx.fillStyle = colors.text;
            ctx.textAlign = 'center';
            const timeEvery = Math.max(
                1,
                Math.ceil(54 / Math.max(1, barWidth)),
            );
            view.forEach((bar, index) => {
                if (
                    index % timeEvery !== 0 &&
                    index !== view.length - 1
                ) {
                    return;
                }
                const date = new Date(bar.timestamp * 1000);
                const label = `${String(date.getUTCHours()).padStart(
                    2,
                    '0',
                )}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
                ctx.fillText(
                    label,
                    axisWidth + index * barWidth + barWidth / 2,
                    plotBottom + timeHeight / 2,
                );
            });
        };

        draw();
        const observer = new ResizeObserver(draw);
        observer.observe(host);
        return () => observer.disconnect();
    }, [
        bars,
        contract,
        colors,
        mode,
        visibleBars,
        minimumVolume,
        opacity,
        showPoc,
        showDeltaPoc,
        showImbalance,
    ]);

    return (
        <canvas
            ref={canvasRef}
            aria-label='Footprint chart'
            style={{ display: 'block', width: '100%', height: '100%' }}
        />
    );
}

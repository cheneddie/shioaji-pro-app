import { createPortal } from 'react-dom';
import type { BubbleSettings } from '../domain/bubble';
import * as styles from './order-flow-bubble-settings-dialog.css';

export function OrderFlowBubbleSettingsDialog({
    settings, onPatch, onClose,
}: {
    settings: BubbleSettings;
    onPatch: (patch: Partial<BubbleSettings>) => void;
    onClose: () => void;
}) {
    const numeric = (key: keyof BubbleSettings, min: number, max?: number, step = 1) => (
        <label className={styles.field} key={key}>
            {({
                minimumVolume: '最小成交量',
                maximumVolume: '最大成交量（0 = 不限制）',
                minimumRadius: '最小半徑',
                opacity: '透明度 %',
                chargeWindowSeconds: 'N 秒',
                scalePercent: '氣泡放大 %',
            } as Record<string, string>)[key]}
            <input className={styles.input} type='number'
                min={min} max={max} step={step}
                value={settings[key] as number}
                onChange={(e) => onPatch({ [key]: Number(e.target.value) })} />
        </label>
    );
    return createPortal(
        <div className={styles.overlay}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className={styles.dialog} role='dialog' aria-modal='true'
                aria-label='成交氣泡指標設定'>
                <div className={styles.header}>
                    <span>Order Flow · 成交氣泡設定</span>
                    <button type='button' className={styles.action}
                        onClick={onClose}>完成</button>
                </div>
                <div className={styles.grid}>
                    <label className={styles.field}>
                        啟用指標
                        <input type='checkbox' aria-label='啟用成交氣泡'
                            checked={settings.enabled}
                            onChange={(e) => onPatch({ enabled: e.target.checked })} />
                    </label>
                    <label className={styles.field}>
                        成交類型
                        <select className={styles.input} value={settings.filterMode}
                            onChange={(e) => onPatch({ filterMode: e.target.value as BubbleSettings['filterMode'] })}>
                            <option value='cumulative'>累積 Delta</option>
                            <option value='single'>單筆成交</option>
                            <option value='charge'>N 秒同向</option>
                        </select>
                    </label>
                    <label className={styles.field}>
                        買賣方向
                        <select className={styles.input} value={settings.direction}
                            onChange={(e) => onPatch({ direction: e.target.value as BubbleSettings['direction'] })}>
                            <option value='all'>全部</option>
                            <option value='buy'>買</option>
                            <option value='sell'>賣</option>
                        </select>
                    </label>
                    <label className={styles.field}>
                        比例基準
                        <select className={styles.input} value={settings.scaleMode}
                            onChange={(e) => onPatch({ scaleMode: e.target.value as BubbleSettings['scaleMode'] })}>
                            <option value='visible'>可視範圍</option>
                            <option value='bar'>單根 K</option>
                        </select>
                    </label>
                    {numeric('minimumVolume', 1)}
                    {numeric('maximumVolume', 0)}
                    {numeric('minimumRadius', 0.5, undefined, 0.5)}
                    {numeric('opacity', 5, 100, 5)}
                    {settings.filterMode === 'charge' && numeric('chargeWindowSeconds', 1, 3600)}
                    {numeric('scalePercent', 0.01, undefined, 1)}
                </div>
                <div className={styles.note}>
                    成交氣泡僅統計有效主動買賣成交；中性 Tick 不強制歸類。
                    放大縮小跟隨 K 棒間距，指標設定不寫入原生技術指標清單。
                </div>
            </div>
        </div>,
        document.body,
    );
}

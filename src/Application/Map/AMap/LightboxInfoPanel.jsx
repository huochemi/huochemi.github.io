import React, { useEffect, useState } from 'react';
import styles from './LightboxInfoPanel.module.css';

// takenAt 为 ISO 8601 无时区字符串（拍摄地当地时间），直接切片展示，
// 不经过 Date 对象以免引入时区转换（与 MapChildren.formatTakenAtFull 语义一致）
const formatTakenAtFull = (takenAt) =>
  takenAt ? takenAt.slice(0, 16).replace('T', ' ') : '';

const formatCoord = (v) => (typeof v === 'number' ? v.toFixed(6) : '');

// WGS84 → GCJ02 转换结果缓存（key: "lat,lng"），
// 高德 URI API 要求 GCJ02 坐标，直接用 WGS84 拼链接会偏移数百米
const gcjCache = new Map();

/**
 * Lightbox 右侧信息面板（方案 B，docs/plans/2026-09-27-lightbox-info-panel.md）
 *
 * @param {object} AMap - 高德 JS API 对象（供 convertFrom 坐标转换）
 * @param {object} photo - 当前照片（lat/lng/takenAt，WGS84）
 * @param {string} groupName - 所属文件夹名（dirName）
 * @param {string} groupDescription - 文件夹描述（仅文件夹分组模式有）
 * @param {boolean} open - 面板展开态（父组件的 "ⓘ" 按钮控制）
 */
function LightboxInfoPanel({ AMap, photo, groupName, groupDescription, open }) {
  // 当前照片转换后的 GCJ02 坐标；null 表示未转换完成/失败（不渲染高德链接）
  const [gcj02, setGcj02] = useState(null);
  // 复制按钮的"已复制"反馈态
  const [copied, setCopied] = useState(false);

  const hasCoord =
    photo && typeof photo.lat === 'number' && typeof photo.lng === 'number';

  // 当前照片坐标变化时转换 GCJ02（官方 convertFrom，与 MapChildren marker 用同一通道）
  useEffect(() => {
    if (!open || !hasCoord) {
      setGcj02(null);
      return;
    }

    const key = `${photo.lat},${photo.lng}`;
    const cached = gcjCache.get(key);
    if (cached) {
      setGcj02(cached);
      return;
    }

    setGcj02(null);
    if (!AMap) return;

    let cancelled = false;
    AMap.convertFrom([[photo.lng, photo.lat]], 'gps', (status, result) => {
      if (cancelled) return;
      if (result.info === 'ok' && result.locations?.length) {
        const loc = result.locations[0];
        const val = { lng: loc.lng, lat: loc.lat };
        gcjCache.set(key, val);
        setGcj02(val);
      }
      // 转换失败时保持 null：宁缺毋假，偏移的链接比没有更有害
    });

    return () => {
      cancelled = true;
    };
  }, [AMap, open, photo, hasCoord]);

  const handleCopy = async () => {
    if (!hasCoord) return;
    try {
      await navigator.clipboard.writeText(
        `${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（如非 HTTPS 环境）时静默失败
    }
  };

  if (!photo) return null;

  const amapUrl = gcj02
    ? `https://uri.amap.com/marker?position=${gcj02.lng},${gcj02.lat}&name=${encodeURIComponent(
        '拍摄位置',
      )}`
    : null;

  return (
    <div
      className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.section}>
        <div className={styles.label}>拍摄时间</div>
        <div className={styles.value}>
          {formatTakenAtFull(photo.takenAt) || '—'}
        </div>
      </div>

      {hasCoord && (
        <div className={styles.section}>
          <div className={styles.label}>GPS 坐标（WGS84）</div>
          <div className={styles.coordRow}>
            <span className={styles.value}>
              {formatCoord(photo.lat)}, {formatCoord(photo.lng)}
            </span>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopy}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          {amapUrl ? (
            <a
              className={styles.amapLink}
              href={amapUrl}
              target="_blank"
              rel="noreferrer"
            >
              在高德地图中查看 ↗
            </a>
          ) : (
            <span className={styles.coordHint}>坐标转换中…</span>
          )}
        </div>
      )}

      {(groupName || groupDescription) && (
        <div className={styles.section}>
          <div className={styles.label}>所属文件夹</div>
          {groupName && <div className={styles.value}>{groupName}</div>}
          {groupDescription && (
            <div className={styles.desc}>{groupDescription}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default LightboxInfoPanel;

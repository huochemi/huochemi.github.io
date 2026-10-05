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

// 外部参考链接的类别标签（点位级，见 docs/plans/2026-10-05-point-references.md）。
// 只决定显示文字：未收录的 kind 原样显示，不做猜测也不隐藏——坏数据要看得见。
const REF_KIND_LABELS = {
  data: '数据',
  chart: '航图',
  article: '文章',
};

/**
 * Lightbox 右侧信息面板（方案 B，docs/plans/2026-09-27-lightbox-info-panel.md）
 *
 * @param {object} AMap - 高德 JS API 对象（供 convertFrom 坐标转换）
 * @param {object} photo - 当前照片（lat/lng/takenAt，WGS84）
 * @param {string} groupName - 所属文件夹名（dirName）
 * @param {string} groupDescription - 文件夹描述（仅文件夹分组模式有）
 * @param {Array} groupReferences - 点位级外部参考链接（可选字段，缺省即该点位无链接）
 * @param {boolean} isCover - 是否为所属文件夹的封面（封面不可删除）
 * @param {boolean} open - 面板展开态（父组件的 "ⓘ" 按钮控制）
 */
function LightboxInfoPanel({
  AMap,
  photo,
  groupName,
  groupDescription,
  groupReferences,
  isCover,
  open,
}) {
  // 当前照片转换后的 GCJ02 坐标；null 表示未转换完成/失败（不渲染高德链接）
  const [gcj02, setGcj02] = useState(null);
  // 复制按钮的"已复制"反馈态
  const [copied, setCopied] = useState(false);
  // 删除命令复制按钮的"已复制"反馈态（与坐标复制相互独立）
  const [cmdCopied, setCmdCopied] = useState(false);

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

  const isVideo = photo.type === 'video';

  // 删除命令：由 UI 已有字段组装，不含本机路径（公网 bundle 不留本机信息）。
  // 需在站点仓库根目录执行，文案在下方说明。
  const deleteCommand =
    groupName && photo.fileName
      ? `npm run del-photo -- "${groupName}" "${photo.fileName}"`
      : '';

  const handleCopyCommand = async () => {
    if (!deleteCommand) return;
    try {
      await navigator.clipboard.writeText(deleteCommand);
      setCmdCopied(true);
      setTimeout(() => setCmdCopied(false), 1500);
    } catch {
      // 剪贴板不可用（如非 HTTPS 环境）时静默失败
    }
  };

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

      {photo.fileName && (
        <div className={styles.section}>
          <div className={styles.label}>文件名</div>
          <div className={styles.value}>{photo.fileName}</div>
        </div>
      )}

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

      {/* 延伸阅读：点位级外部参考链接（docs/plans/2026-10-05-point-references.md）。
          刻意不校验、不过滤——缺 label 就是空标题、缺 url 就是坏链接，肉眼可见才会被修；
          静默跳过坏数据反而藏住笔误。无 references 时整个区块不渲染（不留空壳）。 */}
      {groupReferences?.length > 0 && (
        <div className={styles.section}>
          <div className={styles.label}>延伸阅读</div>
          {groupReferences.map((ref, index) => (
            <a
              key={`${index}-${ref.url}`}
              className={styles.refLink}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className={styles.refKind}>
                {REF_KIND_LABELS[ref.kind] ?? ref.kind}
              </span>
              <span className={styles.refLabel}>{ref.label}</span>
            </a>
          ))}
        </div>
      )}

      {/* 删除区块（docs/plans/2026-09-30-photo-deletion-workflow.md）：
          封面不可删除（脚本也会按 index_photo 硬拦），故封面态不给复制按钮 */}
      {deleteCommand && (
        <div className={styles.section}>
          <div className={styles.label}>
            {isVideo ? '删除这个视频' : '删除这张照片'}
          </div>
          {isCover ? (
            <>
              <div className={styles.coverBadge}>
                {isVideo ? '封面视频 · 不可删除' : '封面照片 · 不可删除'}
              </div>
              <div className={styles.desc}>
                封面提供本组在地图上的坐标与缩略图来源，删除会让整组失去定位。
                如需更换封面，请先修改该文件夹 index.json 的{' '}
                <code className={styles.code}>index_photo</code>{' '}
                并指向一张带 GPS 的照片或视频，再删除这张。
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.copyCmdBtn}
                onClick={handleCopyCommand}
              >
                {cmdCopied ? '已复制' : '复制删除命令'}
              </button>
              <code className={styles.cmdPreview}>{deleteCommand}</code>
              <div className={styles.desc}>
                在站点仓库根目录的终端粘贴执行：删除这个文件与它的派生图
                {isVideo ? '（含转码视频）' : ''}。原文件会直接删除、
                不进回收站，请确认后再执行；删除后需自行执行一次{' '}
                <code className={styles.code}>npm run photos</code>{' '}
                更新 output.json。
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default LightboxInfoPanel;

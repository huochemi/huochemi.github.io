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
// 参考点位的"来源"走同一套 references，最常见的类别是视频（拍车视频）与图片。
const REF_KIND_LABELS = {
  data: '数据',
  chart: '航图',
  article: '文章',
  video: '视频',
  image: '图片',
};

/**
 * Lightbox 右侧信息面板（方案 B，docs/plans/2026-09-27-lightbox-info-panel.md）
 *
 * @param {object} AMap - 高德 JS API 对象（供 convertFrom 坐标转换）
 * @param {object} photo - 当前照片（lat/lng/takenAt，实拍为 WGS84）
 * @param {string} groupName - 所属文件夹名（dirName）
 * @param {string} groupDescription - 文件夹描述（仅文件夹分组模式有）
 * @param {Array} groupReferences - 点位级外部参考链接（可选字段，缺省即该点位无链接）
 * @param {string} groupPinKind - 点位阶段标记（'ref' = 还没去过的参考点位，缺省即实拍）。
 *   必须是**组级**而非照片级的字段——参考图是 photos[] 的项，项上没有它
 * @param {boolean} isCover - 是否为所属文件夹的封面（封面不可删除）
 * @param {boolean} open - 面板展开态（父组件的 "ⓘ" 按钮控制）
 */
function LightboxInfoPanel({
  AMap,
  photo,
  groupName,
  groupDescription,
  groupReferences,
  groupPinKind,
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
  // 参考点位（PinKind 'ref'，还没去过的点位）：坐标是建点位时人工标注的 GCJ02
  const isRef = groupPinKind === 'ref';

  // 坐标通道分两条（口径必须与 MapChildren 的 marker 落点一致，否则链接与图钉会错位）：
  //  - 实拍点位：照片 EXIF 是 WGS84 ⇒ convertFrom 转成 GCJ02 再用
  //  - 参考点位：本来就是 GCJ02 ⇒ **直接使用，绝不能再进 convertFrom**（二次偏移）
  useEffect(() => {
    if (!open || !hasCoord) {
      setGcj02(null);
      return;
    }

    if (isRef) {
      setGcj02({ lng: photo.lng, lat: photo.lat });
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
  }, [AMap, open, photo, hasCoord, isRef]);

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
  //
  // ⚠️ 参考点位**不给**这条命令：del-photo 只认原图仓 / 派生图体系，参考图既不在
  // 原图仓、也没有派生图，照给必然失败（见 docs/plans/2026-10-07-ref-places.md 洞 #1）。
  const deleteCommand =
    !isRef && groupName && photo.fileName
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

  // 链接里显示的地点名：实拍态沿用原文案「拍摄位置」（零回归）；
  // 参考点位用点位名，用户在高德里一眼能认出是哪个点位
  const linkName = isRef ? groupName || '参考点位' : '拍摄位置';

  const amapUrl = gcj02
    ? `https://uri.amap.com/marker?position=${gcj02.lng},${gcj02.lat}&name=${encodeURIComponent(
        linkName,
      )}`
    : null;

  // 「导航到此」（2026-10-07 从高德官方 URI API 文档核实参数形态）：
  //  - 起点（from）留空 ⇒ 移动端自动使用当前位置（官方明确该自动定位仅移动端生效）
  //  - callnative=1 仅移动端会尝试唤起高德 App；官方提示微信/QQ 内置浏览器无法调起，
  //    所以到现场要用系统浏览器/Safari 打开站点。PC 端只会打开网页版路线规划页
  //  - 坐标必须是 GCJ02（上面两条通道已统一）；不做"是否装了 App"的探测（S3）
  // 实拍点位共用这个按钮（去过的点位也可能再去），不是参考点位专属
  const navUrl = gcj02
    ? `https://uri.amap.com/navigation?to=${gcj02.lng},${gcj02.lat},${encodeURIComponent(
        linkName,
      )}&mode=car&policy=0&src=huochemi&callnative=1`
    : null;

  return (
    <div
      className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.section}>
        <div className={styles.label}>拍摄时间</div>
        <div className={styles.value}>
          {isRef ? '未知（参考图）' : formatTakenAtFull(photo.takenAt) || '—'}
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
          {/* 参考点位的坐标是**人工标注的点位坐标**（GCJ02），不是某张图自带的
              EXIF 定位——标题必须说实话，否则以后自己都会被骗（宁缺毋假） */}
          <div className={styles.label}>
            {isRef ? '点位坐标（人工标注，GCJ02）' : 'GPS 坐标（WGS84）'}
          </div>
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
          {isRef && (
            <div className={styles.desc}>
              该点位还没有实拍照片，这个坐标是建点位时人工标注的；该点位的参考图
              共享它（不是"每张图各自的定位"）。
            </div>
          )}
          {amapUrl ? (
            <div className={styles.actionRow}>
              <a
                className={styles.amapLink}
                href={amapUrl}
                target="_blank"
                rel="noreferrer"
              >
                在高德地图中查看 ↗
              </a>
              {/* 导航按钮：实拍点位同样出现（去过的点位也可能再去），非参考点位专属 */}
              {navUrl && (
                <a
                  className={styles.navLink}
                  href={navUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  导航到此 ↗
                </a>
              )}
            </div>
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
          静默跳过坏数据反而藏住笔误。无 references 时整个区块不渲染（不留空壳）。
          参考点位把标题换成「参考来源」：那些链接就是这批参考图的出处（同为 references
          字段，不新增第二种结构）。 */}
      {groupReferences?.length > 0 && (
        <div className={styles.section}>
          <div className={styles.label}>
            {isRef ? '参考来源' : '延伸阅读'}
          </div>
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
          封面不可删除（脚本也会按 index_photo 硬拦），故封面态不给复制按钮。
          参考点位不会走到这里——上面组装 deleteCommand 时已为它置空（洞 #1） */}
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

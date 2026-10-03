import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { Marker } from '@uiw/react-amap';

import output from '../../output.json';
import styles from './MapChildren.module.css'; // 使用 CSS Modules 引入引入抽屉与相册网格样式
import CityChips from './CityChips';
import LightboxInfoPanel from './LightboxInfoPanel';

// 数据异常时的显式报错（不是静默兜底）：缺坐标的照片不进 marker 列表。
// 关键约束：undefined 一旦进入 AMap.convertFrom 的坐标数组，可能导致整批转换失败、
// 所有 marker 都不渲染，所以宁可丢掉这一项并且报出来。
const reportMissingCoord = (label) => {
  console.error(
    `[数据异常] ${label} 缺坐标，已跳过该 marker（请重跑 npm run photos）`,
  );
};

function flattenPhotos(data) {
  return data.flatMap((group) => {
    if (!group.photos || group.photos.length === 0) {
      if (group.lat === undefined || group.lng === undefined) {
        reportMissingCoord(`${group.dirName}/${group.fileName}`);
        return [];
      }
      return [
        {
          lat: group.lat,
          lng: group.lng,
          takenAt: group.takenAt,
          fileName: group.fileName,
          thumbnailLink: group.thumbnailLink,
          displayLink: group.displayLink,
          webViewLink: group.webViewLink,
          dirName: group.dirName,
          // 组级封面名（= 本项自身）。照片分组模式下必须由数据自带，
          // 因为选中项就是照片本身，无法反查所属组的封面（详见 ⓘ 面板封面判定）
          coverFileName: group.fileName,
          // 组级当前不写 device（文件夹内混机时单一值无意义），
          // 此处透传仅为两个分支结构对称，实际取到 undefined
          device: group.device,
        },
      ];
    }

    // 坐标一律取照片自身的值，不做 `photo.lat ?? group.lat` 回退：回退会把"还没补
    // 坐标的中间态"伪装成"已降级"，让缺坐标的照片被钉到封面坐标上、在地图上表现为
    // 假位置。管线的预检已保证产出数据里不存在缺坐标项，这里只作数据异常兜底。
    return group.photos.flatMap((photo) => {
      if (photo.lat === undefined || photo.lng === undefined) {
        reportMissingCoord(`${group.dirName}/${photo.fileName}`);
        return [];
      }
      return [
        {
          lat: photo.lat,
          lng: photo.lng,
          takenAt: photo.takenAt,
          device: photo.device,
          fileName: photo.fileName,
          thumbnailLink: photo.thumbnailLink,
          displayLink: photo.displayLink,
          webViewLink: photo.webViewLink,
          dirName: group.dirName,
          coverFileName: group.fileName,
        },
      ];
    });
  });
}

const groupByFolder = output;
const groupByPhoto = flattenPhotos(groupByFolder);

// takenAt 为 ISO 8601 无时区字符串（拍摄地当地时间），直接切片展示，
// 不经过 Date 对象以免引入时区转换
// 完整格式 "2024-05-01 14:32"（Lightbox 胶囊用）
const formatTakenAtFull = (takenAt) =>
  takenAt ? takenAt.slice(0, 16).replace('T', ' ') : '';
// 短格式 "14:32"（缩略图角标用，卡片空间有限只显示时刻）
const formatTakenAtShort = (takenAt) =>
  takenAt ? takenAt.slice(11, 16) : '';

// 从 fileName 扩展名推导原始格式（如 "IMG_5165.HEIC" → "HEIC"）。
// 扩展名本身就是格式的事实源，故不在 output.json 另加 format 字段
// （见 docs/plans/2026-09-30-photo-format-badge.md）
const formatFileExt = (fileName) => {
  const i = fileName ? fileName.lastIndexOf('.') : -1;
  return i >= 0 ? fileName.slice(i + 1).toUpperCase() : '';
};

// 拍摄设备类型（output.json 的 device 字段，管线从 EXIF 归一而来）→ 角标图标。
// 用内联 SVG 而非 emoji：彩色 emoji 的配色固定在位图字体里、不受 CSS color 控制，
// 📷 的深灰机身叠在角标半透明黑底 + 深色照片上明度差≈0，等于隐形；SVG 以
// stroke="currentColor" 继承角标白色，任何底图、任何平台都清晰。图标样式沿用
// 本文件 Lightbox 图标的既有惯例（viewBox 24 / fill none / strokeWidth 2）。
// 只放图标不放品牌型号文本（角标空间有限）；role + aria-label 是为保住
// emoji 时代屏幕阅读器会念出的「camera」语义——本图标是设备信息的唯一载体，
// 与既有装饰性图标的 aria-hidden 刻意区别
// （见 docs/plans/2026-09-30-photo-device-badge-svg-icon.md）
const DeviceBadgeIcon = ({ device }) => {
  if (device !== 'phone' && device !== 'camera') return null;

  const isPhone = device === 'phone';

  return (
    <svg
      className={styles.photoBadgeIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      role="img"
      aria-label={isPhone ? '手机拍摄' : '相机拍摄'}
    >
      {isPhone ? (
        <>
          <rect x="7.5" y="2.5" width="9" height="19" rx="2.5" />
          <path d="M11 18.6h2" />
        </>
      ) : (
        <>
          <rect x="3" y="7" width="18" height="13" rx="2.5" />
          <circle cx="12" cy="13.5" r="3.6" />
        </>
      )}
    </svg>
  );
};

// 缩略图角标文本段："14:32 · HEIC"；缺项自动省略，皆缺返回空串
// （与 markerTooltip 同惯例：filter(Boolean) + join，不渲染 "undefined ·"）。
// 设备图标不在此函数内——SVG 是元素、无法进 join，改由 DeviceBadgeIcon 渲染
const thumbnailBadgeText = (photo) =>
  [formatTakenAtShort(photo.takenAt), formatFileExt(photo.fileName)]
    .filter(Boolean)
    .join(' · ');

// Marker 悬停 tooltip 文案（AMap 原生 title），按分组模式给语义：
// 文件夹模式显示「文件夹名（共 N 张）」，照片模式显示「文件名 · 拍摄时间」。
// 判别式用 photo.photos 而非 localStorage：分组模式的 item 是 output.json
// 顶层对象、带 photos 数组；照片模式的 item 由 flattenPhotos 产出、无该字段。
// 字段缺失时宁缺毋假（filter(Boolean) + join），不渲染 "undefined ·"。
const markerTooltip = (photo, photoCount) => {
  if (photo.photos) {
    return photo.dirName
      ? `${photo.dirName}（共 ${photoCount} 张）`
      : `共 ${photoCount} 张`;
  }
  return [photo.fileName, formatTakenAtFull(photo.takenAt)]
    .filter(Boolean)
    .join(' · ');
};

const allPhotos =
  localStorage.getItem('hcm_group_by') === 'photo'
    ? groupByPhoto
    : groupByFolder;

const MapChildren = ({ AMap, mapInstance, container }) => {
  const [photos, setPhotos] = useState([]);
  // 选中的文件夹/照片组对象
  const [selectedGroup, setSelectedGroup] = useState(null);
  // 当前打开的大图索引（null 表示未开启 Lightbox）
  const [lightboxIndex, setLightboxIndex] = useState(null);
  // 高清大图加载状态标志
  const [isLargeImageLoaded, setIsLargeImageLoaded] = useState(false);
  // Lightbox 信息面板展开态（"ⓘ" 按钮控制，默认收起）
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (!AMap || !mapInstance) return;

    AMap.convertFrom(
      allPhotos.map((file) => [file.lng, file.lat]),
      'gps',
      (status, result) => {
        if (result.info !== 'ok') {
          console.error('AMap.convertFrom failed:', result);
          return;
        }
        const photos = result.locations.map((resLnglat, index) => ({
          ...allPhotos[index],
          lnglat: resLnglat,
        }));

        setPhotos(photos);
      },
    );
  }, [AMap, mapInstance, container]);

  // 初始视野自动包住全部照片 marker：必须在 React commit（marker 已
  // 渲染到地图上）之后调 setFitView，否则找不到 overlay 会静默空转，
  // 视野停在 Map/index.jsx hardcode 的兜底位置。photos 只从空变为有值
  // 一次（初始加载），不会在用户交互后反复触发跳视野。
  useEffect(() => {
    if (!mapInstance || photos.length === 0) return;
    mapInstance.setFitView();
  }, [mapInstance, photos]);

  // 计算当前抽屉要展示的照片列表
  // 用 useMemo 缓存引用：否则每次渲染都产生新数组，
  // 会触发 react-hooks/exhaustive-deps 警告（CI 中 warning 会升级为 error）
  const photoList = useMemo(() => {
    if (!selectedGroup) return [];
    return localStorage.getItem('hcm_group_by') === 'photo'
      ? [selectedGroup]
      : selectedGroup.photos || [selectedGroup];
  }, [selectedGroup]);

  // 切换上一张大图
  const handlePrevPhoto = useCallback(() => {
    if (photoList.length === 0) return;
    setIsLargeImageLoaded(false); // 重置大图加载状态
    setLightboxIndex((prevIndex) =>
      prevIndex === 0 ? photoList.length - 1 : prevIndex - 1,
    );
  }, [photoList.length]);

  // 切换下一张大图
  const handleNextPhoto = useCallback(() => {
    if (photoList.length === 0) return;
    setIsLargeImageLoaded(false); // 重置大图加载状态
    setLightboxIndex((prevIndex) =>
      prevIndex === photoList.length - 1 ? 0 : prevIndex + 1,
    );
  }, [photoList.length]);

  // 关闭大图 Lightbox
  const handleCloseLightbox = useCallback(() => {
    setLightboxIndex(null);
    setIsLargeImageLoaded(false);
    setInfoOpen(false); // 面板状态一并重置
  }, []);

  // 1. 预加载机制：后台静默请求当前照片的前一张与后一张大图
  useEffect(() => {
    if (lightboxIndex === null || photoList.length <= 1) return;

    const prevIndex = (lightboxIndex - 1 + photoList.length) % photoList.length;
    const nextIndex = (lightboxIndex + 1) % photoList.length;

    [prevIndex, nextIndex].forEach((idx) => {
      const targetPhoto = photoList[idx];
      // 预加载展示图（约几百 KB），而非原始文件（数 MB）
      const targetUrl =
        targetPhoto?.displayLink || targetPhoto?.webViewLink || targetPhoto?.thumbnailLink;
      if (targetUrl) {
        const img = new Image();
        img.src = targetUrl;
      }
    });
  }, [lightboxIndex, photoList]);

  // 监听键盘事件（左右方向键切图、Esc 键关闭）
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        handlePrevPhoto();
      } else if (e.key === 'ArrowRight') {
        handleNextPhoto();
      } else if (e.key === 'Escape') {
        handleCloseLightbox();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxIndex, handlePrevPhoto, handleNextPhoto, handleCloseLightbox]);

  const currentPhoto = photoList[lightboxIndex];

  // 当前照片所属组的封面名：文件夹分组模式下取组对象的 fileName（= 封面），
  // 照片分组模式下取 flattenPhotos 下发的 coverFileName。两者都不能用
  // selectedGroup.fileName 兜底判定——照片模式下它就是照片自身，会恒等。
  const coverFileName = selectedGroup
    ? selectedGroup.coverFileName || selectedGroup.fileName
    : undefined;

  return (
    <>
      {/* 顶部城市跳转胶囊条（数据源 src/Application/cities.js，用户手动维护） */}
      <CityChips mapInstance={mapInstance} />

      {/* 渲染地图 Marker */}
      {photos.map((photo, index) => {
        const photoCount =
          localStorage.getItem('hcm_group_by') === 'photo'
            ? 1
            : photo.photos?.length || 1;

        return (
          <Marker
            key={index}
            title={markerTooltip(photo, photoCount)}
            position={photo.lnglat}
            content={`
              <div class="hcm-photo-pin">
                <div class="hcm-photo-wrapper">
                  <img class="hcm-marker-image" src="${photo.thumbnailLink}">
                  <span class="hcm-photo-count">${photoCount}</span>
                </div>
              </div>
            `}
            anchor="bottom-center"
            onClick={() => {
              // 点击选中 Marker，打开抽屉
              setSelectedGroup(photo);
              // 平移地图让选中的 Marker 居中
              if (mapInstance && photo.lnglat) {
                mapInstance.panTo(photo.lnglat);
              }
            }}
          />
        );
      })}

      {/* 底部抽屉面板 (Bottom Sheet Drawer) */}
      {selectedGroup && (
        <div
          className={styles.drawerOverlay}
          onClick={() => setSelectedGroup(null)}
        >
          <div
            className={styles.drawerContent}
            onClick={(e) => e.stopPropagation()} // 阻止冒泡，避免点击抽屉内部关闭
          >
            {/* 顶部 Header */}
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitle}>
                {/* 标题显示文件夹名（dirName），缺失时回退通用文案 */}
                <span className={styles.drawerName}>
                  {selectedGroup.dirName || '照片列表'}
                </span>
                <span className={styles.drawerBadge}>
                  {photoList.length} 张
                </span>
              </div>
              <button
                className={styles.drawerClose}
                onClick={() => setSelectedGroup(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* 照片列表展平区域 (CSS Grid 瀑布流/自适应网格) */}
            <div className={styles.drawerBody}>
              <div className={styles.photoGrid}>
                {photoList.map((p, idx) => (
                  <div
                    key={idx}
                    className={styles.photoCard}
                    onClick={() => {
                      setIsLargeImageLoaded(false);
                      setLightboxIndex(idx);
                    }}
                  >
                    <img
                      src={p.thumbnailLink}
                      alt={`photo-${idx}`}
                      className={styles.photoThumb}
                      loading="lazy"
                    />
                    {/* 方案 B：缩略图左下角角标 = 拍摄时刻 · 原始格式 · 设备图标 */}
                    {(p.takenAt || p.fileName || p.device) && (
                      <span className={styles.photoTimeBadge}>
                        {thumbnailBadgeText(p)}
                        {thumbnailBadgeText(p) && p.device && ' · '}
                        <DeviceBadgeIcon device={p.device} />
                      </span>
                    )}
                    <div className={styles.photoMask}>
                      <span>查看大图</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 全屏大图 Lightbox 模态框 */}
      {lightboxIndex !== null && currentPhoto && (
        <div className={styles.lightboxOverlay} onClick={handleCloseLightbox}>
          {/* 顶部控制栏 */}
          <div
            className={styles.lightboxHeader}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.lightboxCounter}>
              {lightboxIndex + 1} / {photoList.length}
            </div>
            <div className={styles.lightboxActions}>
              {currentPhoto.webViewLink && (
                <a
                  href={currentPhoto.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.lightboxLink}
                >
                  查看原始文件 ↗
                </a>
              )}
              <button
                type="button"
                className={`${styles.lightboxInfoBtn} ${
                  infoOpen ? styles.lightboxInfoBtnActive : ''
                }`}
                onClick={() => setInfoOpen((prev) => !prev)}
                aria-label="Toggle info panel"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5" />
                  <path d="M12 8h.01" />
                </svg>
              </button>
              <button
                className={styles.lightboxCloseBtn}
                onClick={handleCloseLightbox}
                aria-label="Close Lightbox"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 大图展示区域及切图控制 */}
          <div
            className={styles.lightboxBody}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 上一张按钮 */}
            {photoList.length > 1 && (
              <button
                className={`${styles.lightboxNavBtn} ${styles.lightboxPrev}`}
                onClick={handlePrevPhoto}
                aria-label="Previous photo"
              >
                ‹
              </button>
            )}

            {/* 大图容器：采用渐进式加载 */}
            <div className={styles.lightboxImageWrapper}>
              {/* 加载未完成时显示 Loading 转圈 */}
              {!isLargeImageLoaded && (
                <div className={styles.lightboxSpinner}></div>
              )}

              {/* 先展示基础缩略图，高清图加载完成后覆盖 */}
              <img
                src={currentPhoto.thumbnailLink}
                alt="placeholder"
                className={`${styles.lightboxImage} ${styles.lightboxPlaceholder}`}
              />

              {/* 真正的高清展示图（1920px WebP 展示档，原图仅作下载入口） */}
              <img
                key={
                  currentPhoto.displayLink ||
                  currentPhoto.webViewLink ||
                  currentPhoto.thumbnailLink
                }
                src={
                  currentPhoto.displayLink ||
                  currentPhoto.webViewLink ||
                  currentPhoto.thumbnailLink
                }
                alt={`large-photo-${lightboxIndex}`}
                className={`${styles.lightboxImage} ${
                  isLargeImageLoaded ? styles.loaded : styles.loading
                }`}
                onLoad={() => setIsLargeImageLoaded(true)}
              />
            </div>

            {/* 方案 A：底部居中拍摄时间胶囊 */}
            {currentPhoto.takenAt && (
              <div
                className={styles.lightboxTakenAt}
                onClick={(e) => e.stopPropagation()}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                {formatTakenAtFull(currentPhoto.takenAt)}
              </div>
            )}

            {/* 下一张按钮 */}
            {photoList.length > 1 && (
              <button
                className={`${styles.lightboxNavBtn} ${styles.lightboxNext}`}
                onClick={handleNextPhoto}
                aria-label="Next photo"
              >
                ›
              </button>
            )}
          </div>

          {/* 右侧信息面板（方案 B）：桌面端右侧滑入，移动端底部弹出 */}
          <LightboxInfoPanel
            AMap={AMap}
            photo={currentPhoto}
            groupName={selectedGroup?.dirName}
            groupDescription={selectedGroup?.description}
            isCover={currentPhoto.fileName === coverFileName}
            open={infoOpen}
          />
        </div>
      )}
    </>
  );
};

export default MapChildren;

import React, { useState, useEffect, useCallback } from 'react';
import { Marker } from '@uiw/react-amap';

import output from '../../output.json';
import styles from './MapChildren.module.css'; // 使用 CSS Modules 引入引入抽屉与相册网格样式

function flattenPhotos(data) {
  return data.flatMap((group) => {
    if (!group.photos || group.photos.length === 0) {
      return [
        {
          lat: group.lat,
          lng: group.lng,
          thumbnailLink: group.thumbnailLink,
          webViewLink: group.webViewLink,
        },
      ];
    }

    return group.photos.map((photo) => ({
      lat: photo.lat ?? group.lat,
      lng: photo.lng ?? group.lng,
      thumbnailLink: photo.thumbnailLink,
      webViewLink: photo.webViewLink,
    }));
  });
}

const groupByFolder = output;
const groupByPhoto = flattenPhotos(groupByFolder);

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
        mapInstance.setFitView();
      },
    );
  }, [AMap, mapInstance, container]);

  // 计算当前抽屉要展示的照片列表
  const photoList = selectedGroup
    ? localStorage.getItem('hcm_group_by') === 'photo'
      ? [selectedGroup]
      : selectedGroup.photos || [selectedGroup]
    : [];

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
  }, []);

  // 1. 预加载机制：后台静默请求当前照片的前一张与后一张大图
  useEffect(() => {
    if (lightboxIndex === null || photoList.length <= 1) return;

    const prevIndex = (lightboxIndex - 1 + photoList.length) % photoList.length;
    const nextIndex = (lightboxIndex + 1) % photoList.length;

    [prevIndex, nextIndex].forEach((idx) => {
      const targetPhoto = photoList[idx];
      const targetUrl = targetPhoto?.webViewLink || targetPhoto?.thumbnailLink;
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

  return (
    <>
      {/* 渲染地图 Marker */}
      {photos.map((photo, index) => {
        const photoCount =
          localStorage.getItem('hcm_group_by') === 'photo'
            ? 1
            : photo.photos?.length || 1;

        return (
          <Marker
            key={index}
            title={`Marker ${index}`}
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
                <span>照片列表</span>
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

              {/* 真正的原图 */}
              <img
                key={currentPhoto.webViewLink || currentPhoto.thumbnailLink}
                src={currentPhoto.webViewLink || currentPhoto.thumbnailLink}
                alt={`large-photo-${lightboxIndex}`}
                className={`${styles.lightboxImage} ${
                  isLargeImageLoaded ? styles.loaded : styles.loading
                }`}
                onLoad={() => setIsLargeImageLoaded(true)}
              />
            </div>

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
        </div>
      )}
    </>
  );
};

export default MapChildren;

import React, { useState, useEffect } from 'react';
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
                  <a
                    key={idx}
                    href={p.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.photoCard}
                  >
                    <img
                      src={p.thumbnailLink}
                      alt={`photo-${idx}`}
                      className={styles.photoThumb}
                      loading="lazy"
                    />
                    <div className={styles.photoMask}>
                      <span>查看原图</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MapChildren;

import React, { useEffect } from 'react';
import { Marker } from '@uiw/react-amap';

import output from '../../output.json';

/**
 * 将文件夹分组格式展平为单张图片的数组
 * @param {Array} data 原始按文件夹分组的数据
 * @returns {Array} 展平后的图片列表
 */
function flattenPhotos(data) {
  return data.flatMap((group) => {
    // 如果没有 photos 数组或为空，则直接使用文件夹外层的主图
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

    // 遍历子图片：如果子图没有坐标，继承外层文件夹的默认坐标
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

// hcm_group_by = folder | photo
const allPhotos =
  localStorage.getItem('hcm_group_by') === 'photo'
    ? groupByPhoto
    : groupByFolder;

const MapChildren = ({ AMap, mapInstance, container }) => {
  const [photos, setPhotos] = React.useState([]);

  useEffect(() => {
    AMap.convertFrom(
      allPhotos.map((file) => [file.lng, file.lat]),
      'gps',
      (status, result) => {
        if (result.info !== 'ok') {
          console.error('AMap.convertFrom failed:', result);
          return;
        }
        const photos = result.locations.map((resLnglat, index) => {
          // resLnglat={Q: 39.877753363716
          // R: 116.21148084852501
          // lat: 39.877753
          // lng: 116.211481}
          return {
            ...allPhotos[index],
            lnglat: resLnglat,
          };
        });

        setPhotos(photos);

        // Fitbounds to all the markers
        mapInstance.setFitView();
      },
    );
  }, [AMap, mapInstance, container]);

  return [
    ...photos.map((photo, index) => {
      const photoCount =
        localStorage.getItem('hcm_group_by') === 'photo'
          ? 1
          : photo.photos.length;
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
          onClick={(event) => {
            console.log('Marker clicked', event);

            var infoWindow = new AMap.InfoWindow({
              offset: new AMap.Pixel(0, -30),
            });
            infoWindow.setContent(`
            <div>
              <a target="_blank" href="${photo.webViewLink}">
                <img class="hcm-marker-image" src="${photo.thumbnailLink}">
              </a>
            </div>
          `);
            infoWindow.open(mapInstance, event.target.getPosition());
          }}
        />
      );
    }),
  ];
};

export default MapChildren;

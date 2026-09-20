import React, { useEffect } from 'react';
import { Marker } from '@uiw/react-amap';

import output from '../../output.json';

const MapChildren = ({ AMap, mapInstance, container }) => {
  const [photos, setPhotos] = React.useState([]);

  useEffect(() => {
    const lnglats = [];
    const files = output;
    files.forEach((file) => {
      lnglats.push([file.lng, file.lat]);
    });

    AMap.convertFrom(lnglats, 'gps', (status, result) => {
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
          lnglat: resLnglat,
          thumbnail: files[index].thumbnailLink,
          webViewLink: files[index].webViewLink,
        };
      });

      setPhotos(photos);

      // Fitbounds to all the markers
      mapInstance.setFitView();
    });
  }, [AMap, mapInstance, container]);

  return [
    ...photos.map((photo, index) => (
      <Marker
        key={index}
        title={`Marker ${index}`}
        position={photo.lnglat}
        content={`
          <div class="hcm-photo-pin">
            <div class="hcm-photo-wrapper">
              <img class="hcm-marker-image" src="${photo.thumbnail}">
              <span class="hcm-photo-count">1</span>
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
                <img class="hcm-marker-image" src="${photo.thumbnail}">
              </a>
            </div>
          `);
          infoWindow.open(mapInstance, event.target.getPosition());
        }}
      />
    )),
  ];
};

export default MapChildren;

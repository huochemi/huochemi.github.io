import React, { useRef, useEffect } from 'react';
import { Map, APILoader, Marker } from '@uiw/react-amap';

import './index.css';

const gpsLngLat = [116.166786, 39.760883];

const MapDemo = () => {
  const mapRef = useRef();
  const [lngLat, setLngLat] = React.useState(gpsLngLat);
  const [layers, setLayers] = React.useState([]);

  useEffect(() => {
    console.debug('mapRef:', mapRef);
    console.debug('window.AMap:', window.AMap);
    setLayers([new window.AMap.TileLayer.Satellite()]);

    window.AMap.convertFrom(gpsLngLat, 'gps', (status, result) => {
      if (result.info !== 'ok') {
        console.error('AMap.convertFrom failed:', result);
        return;
      }
      setLngLat([result.locations[0].lng, result.locations[0].lat]);

      // Fitbounds to all the markers
      //   map.setFitView();
    });
  }, []);

  return (
    <Map ref={mapRef} center={lngLat} zoom={18} layers={layers}>
      {({ AMap, map, container }) => {
        console.debug('AMap loaded', AMap, map, container);

        return [
          <Marker
            key={1}
            title="Marker"
            position={lngLat}
            content={`
              <div class="hcm-photo-pin">
                <div class="hcm-photo-wrapper">
                  <img class="hcm-marker-image" src="https://huochemi.github.io/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780.JPG">
                  <span class="hcm-photo-count">10</span>
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
                  <a target="_blank" href="https://huochemi.github.io/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780.JPG">
                    <img class="hcm-marker-image" src="https://huochemi.github.io/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780.JPG" />
                  </a>
                </div>
              `);
              infoWindow.open(map, event.target.getPosition());
            }}
          />,
        ];
      }}
    </Map>
  );
};

const MapIcon = () => {
  return (
    <div className="amap-wrapper">
      <APILoader version="2.0.5" akey={process.env.REACT_APP_AMAP_API_KEY}>
        <MapDemo />
      </APILoader>
    </div>
  );
};

export default MapIcon;

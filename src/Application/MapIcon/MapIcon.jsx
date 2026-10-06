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
            // 示例数据（demo 刻意硬编码，不读 output.json）：路径一律用相对形式
            // /data/photos/…——线上由 data 仓的 Pages 项目站点提供、本地由 setupProxy
            // 代理 ../../data，两端同一套 URL。marker 显示框 120px（DPR2 约需 240px），
            // 故取 _thumb.webp（300×300），与生产页 marker 用 thumbnailLink 同构
            content={`
              <div class="hcm-photo-pin">
                <div class="hcm-photo-wrapper">
                  <img class="hcm-marker-image" src="/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780_thumb.webp">
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
              // InfoWindow 是「点开看大图」的位置，取 _display.avif（1920px，当前
              // 可公开分发的最高画质档），与生产页 Lightbox 的 displayLink 同角色。
              // 不包 <a>：原先它指向原图，而「查看原始文件」入口已于 2026-10-05 取消
              // （见 docs/plans/2026-10-06-mapicon-demo-dead-jpg-url.md）
              infoWindow.setContent(`
                <div>
                  <img class="hcm-marker-image" src="/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780_display.avif" />
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

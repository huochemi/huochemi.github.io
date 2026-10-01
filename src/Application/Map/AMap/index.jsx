import React, { useRef, useEffect } from 'react';
import { Map, APILoader } from '@uiw/react-amap';

import BaseMapSwitch from './BaseMapSwitch';
import MapChildren from './MapChildren';

import './index.css';

export const ADD_MARKERS_TOPIC = 'amap.addmarkers';
export const REMOVE_ALL_MARKERS_TOPIC = 'amap.removeallmarkers';

const MapDemo = ({ defaultCenter, defaultZoom }) => {
  const mapRef = useRef();

  useEffect(() => {
    console.debug('mapRef:', mapRef);
  }, []);

  return (
    <Map
      ref={mapRef}
      center={[defaultCenter.longitude, defaultCenter.latitude]}
      zoom={defaultZoom}
    >
      {({ AMap, map, container }) => {
        console.debug('AMap loaded', AMap, map, container);

        // 底图图层先于 marker 注册，保证卫星/路网处于 marker 之下
        return [
          <BaseMapSwitch key="basemap" />,
          <MapChildren
            key="11110"
            AMap={AMap}
            mapInstance={map}
            container={container}
          />,
        ];
      }}
    </Map>
  );
};

/**
 * AMap
 * @export
 * @class AMap
 * @extends {Component}
 *
 * How to use AMap API
 * ```js
 * const {map} = this.aMapRef.current
 * // map.getAllOverlays()
 * // map.setFitView()
 * ```
 * window.AMap is init in original amap lib
 */
const AMap = ({ defaultCenter, defaultZoom }) => {
  if (!process.env.REACT_APP_AMAP_API_KEY) {
    return (
      <div className="hcm-amap-error-notice">
        ⚠️ 未配置地图 API Key，请在 `.env` 文件或者 GitHub 项目设置中进行设置{' '}
        <code>REACT_APP_AMAP_API_KEY</code>
      </div>
    );
  }
  return (
    <div className="amap-wrapper">
      <APILoader version="2.0.5" akey={process.env.REACT_APP_AMAP_API_KEY}>
        <MapDemo defaultCenter={defaultCenter} defaultZoom={defaultZoom} />
      </APILoader>
    </div>
  );
};

export default AMap;

import React, { useRef, useEffect } from 'react';
import { Map, APILoader } from '@uiw/react-amap';

import MapChildren from './MapChildren';

import './index.css';

export const ADD_MARKERS_TOPIC = 'amap.addmarkers';
export const REMOVE_ALL_MARKERS_TOPIC = 'amap.removeallmarkers';

const MapDemo = ({ defaultCenter, defaultZoom }) => {
  const mapRef = useRef();

  useEffect(() => {
    console.debug('mapRef:', mapRef);
  }, []);

  const layers = [];
  if (window.AMap) {
    // https://lbs.amap.com/demo/jsapi-v2/example/layers/satellite/
    layers.push(new window.AMap.TileLayer.Satellite());
  }

  return (
    <Map
      ref={mapRef}
      center={[defaultCenter.longitude, defaultCenter.latitude]}
      zoom={defaultZoom}
      layers={layers}
    >
      {({ AMap, map, container }) => {
        console.debug('AMap loaded', AMap, map, container);

        return [
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
  return (
    <div className="amap-wrapper">
      <APILoader version="2.0.5" akey={process.env.REACT_APP_AMAP_API_KEY}>
        <MapDemo defaultCenter={defaultCenter} defaultZoom={defaultZoom} />
      </APILoader>
    </div>
  );
};

export default AMap;

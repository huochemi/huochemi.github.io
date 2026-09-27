import React, { useState, useEffect, useCallback } from 'react';

import { CITIES } from '../../cities';
import styles from './CityChips.module.css';

/**
 * 顶部城市跳转胶囊条：点击直达（setZoomAndCenter），
 * 再点已选中项 toggle 回全局视野（setFitView）。
 * 城市数据由用户在 src/Application/cities.js 手动维护。
 */
const CityChips = ({ mapInstance }) => {
  // 当前选中的城市名（null 表示全局视野，无高亮）
  const [selectedName, setSelectedName] = useState(null);

  // 用户手动拖动/缩放地图 = 离开导航状态，清除高亮
  useEffect(() => {
    if (!mapInstance) return undefined;

    const clearSelection = () => setSelectedName(null);
    mapInstance.on('dragstart', clearSelection);
    mapInstance.on('zoomstart', clearSelection);
    return () => {
      mapInstance.off('dragstart', clearSelection);
      mapInstance.off('zoomstart', clearSelection);
    };
  }, [mapInstance]);

  const handleClick = useCallback(
    (city) => {
      if (selectedName === city.name) {
        // toggle：再次点击已选中 chip，回全局视野
        setSelectedName(null);
        mapInstance.setFitView();
        return;
      }
      setSelectedName(city.name);
      mapInstance.setZoomAndCenter(city.zoom, [city.lng, city.lat]);
    },
    [mapInstance, selectedName],
  );

  if (!mapInstance || CITIES.length === 0) return null;

  return (
    <div className={styles.chipBar}>
      {CITIES.map((city) => (
        <button
          key={city.name}
          type="button"
          className={`${styles.chip} ${
            selectedName === city.name ? styles.chipActive : ''
          }`}
          onClick={() => handleClick(city)}
        >
          {city.name}
        </button>
      ))}
    </div>
  );
};

export default CityChips;

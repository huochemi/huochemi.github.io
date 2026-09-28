import React, { useState, useEffect, useCallback, useRef } from 'react';

import { CITIES, GLOBAL_VIEW } from '../../cities';
import styles from './CityChips.module.css';

// 三段式飞行时长（ms）：起飞缩小 → 巡航平移 → 降落放大
const FLY_OUT_MS = 400;
const FLY_CRUISE_MS = 500;
const FLY_IN_MS = 400;
// 近距退化为单段动画的时长（ms）与距离阈值（米）
const DIRECT_MS = 800;
const DIRECT_DISTANCE_M = 200000;
// 起飞后允许的最低缩放级别（AMap PC 端 zoom 下限为 3）
const MIN_FLY_ZOOM = 4;

/**
 * 顶部城市跳转胶囊条：点击直达（远距三段式飞行 / 近距单段过渡），
 * 再点已选中项 toggle 回全局视野（GLOBAL_VIEW）。
 * 飞行编排用 zoomend/moveend 事件链驱动；连点取消上一次编排，
 * 用户拖动（dragstart）中断飞行并清除高亮。
 * 城市数据由用户在 src/Application/cities.js 手动维护。
 */
const CityChips = ({ mapInstance }) => {
  // 当前选中的城市名（null 表示全局视野，无高亮）
  const [selectedName, setSelectedName] = useState(null);
  // 当前飞行编排的取消器（null 表示无飞行）；飞行期间程序化动画
  // 也会触发 zoomstart，此时不清高亮（正确性不依赖该事件来源推测）
  const cancelFlightRef = useRef(null);

  useEffect(() => {
    if (!mapInstance) return undefined;

    const clearSelection = () => {
      if (cancelFlightRef.current) return;
      setSelectedName(null);
    };
    // 用户手动拖动 = 离开导航状态：中断飞行并清除高亮
    const interruptByUser = () => {
      if (cancelFlightRef.current) cancelFlightRef.current();
      setSelectedName(null);
    };
    mapInstance.on('dragstart', interruptByUser);
    mapInstance.on('zoomstart', clearSelection);
    return () => {
      mapInstance.off('dragstart', interruptByUser);
      mapInstance.off('zoomstart', clearSelection);
      if (cancelFlightRef.current) cancelFlightRef.current();
    };
  }, [mapInstance]);

  const flyTo = useCallback(
    (targetZoom, targetLngLat) => {
      if (!mapInstance) return;
      // 连点：终止上一次编排，防止动画叠加抖动
      if (cancelFlightRef.current) cancelFlightRef.current();

      const listeners = [];
      const clear = () => {
        listeners.forEach(([event, handler]) => mapInstance.off(event, handler));
        listeners.length = 0;
        cancelFlightRef.current = null;
      };
      // 绑定下一阶段：事件触发后先解绑全部监听，再进入下一步编排
      const beginPhase = (event, next) => {
        const handler = () => {
          clear();
          if (next) {
            cancelFlightRef.current = clear; // 重新武装飞行守卫
            next();
          }
        };
        listeners.push([event, handler]);
        mapInstance.on(event, handler);
      };

      const currentCenter = mapInstance.getCenter();
      const distance = currentCenter.distance(targetLngLat);

      if (distance < DIRECT_DISTANCE_M) {
        // 近距：单段平滑过渡（zoomend / moveend 任一触发即视为结束）
        beginPhase('zoomend', null);
        beginPhase('moveend', null);
        mapInstance.setZoomAndCenter(targetZoom, targetLngLat, false, DIRECT_MS);
        cancelFlightRef.current = clear;
        return;
      }

      // 远距三段：起飞（缩小）→ 巡航（低空平移到目标上方）→ 降落（放大）
      const currentZoom = mapInstance.getZoom();
      const cruiseZoom = Math.max(
        MIN_FLY_ZOOM,
        Math.min(currentZoom, targetZoom) - 2,
      );
      beginPhase('zoomend', () => {
        beginPhase('moveend', () => {
          beginPhase('zoomend', null);
          mapInstance.setZoom(targetZoom, false, FLY_IN_MS);
        });
        mapInstance.setCenter(targetLngLat, false, FLY_CRUISE_MS);
      });
      mapInstance.setZoom(cruiseZoom, false, FLY_OUT_MS);
      cancelFlightRef.current = clear;
    },
    [mapInstance],
  );

  const handleClick = useCallback(
    (city) => {
      if (selectedName === city.name) {
        // toggle：再次点击已选中 chip，飞回全局视野
        setSelectedName(null);
        flyTo(GLOBAL_VIEW.zoom, [GLOBAL_VIEW.lng, GLOBAL_VIEW.lat]);
        return;
      }
      setSelectedName(city.name);
      flyTo(city.zoom, [city.lng, city.lat]);
    },
    [flyTo, selectedName],
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

import React, { useState, useEffect, useCallback, useRef } from 'react';

import { CITIES, GLOBAL_VIEW } from '../../cities';
import styles from './CityChips.module.css';

// 近距退化为单段动画的时长（ms）与距离阈值（米）
const DIRECT_MS = 800;
const DIRECT_DISTANCE_M = 200000;
// 远距弧线飞行时长：基础 1200ms，每 1000km 加 800ms，封顶 2000ms
const FLY_BASE_MS = 1200;
const FLY_PER_1000KM_MS = 800;
const FLY_MAX_MS = 2000;
// 巡航视野：要求平移距离 ≈ K 倍屏宽，由此反解下潜深度
const CRUISE_SCREEN_WIDTHS = 2.5;
// 飞行中 zoom 下限（AMap PC 端下限为 3，留余量）
const MIN_FLY_ZOOM = 4;
// Web Mercator 米/像素公式常数：mpp = 156543.034 × cos(lat) / 2^zoom
const MPP_EQUATORIAL = 156543.03392;

// easeInOutCubic：两端速度为 0，中段最快
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * 顶部城市跳转胶囊条：点击直达（远距 rAF 连续弧线 / 近距单段过渡），
 * 再点已选中项 toggle 回全局视野（GLOBAL_VIEW）。
 * 远距弧线对标 Google flyTo：平移与缩放同帧进行，
 * zoom(t) = 基线插值 − dipH·sin(π·ease(t))，两端精确落位、中段下潜，
 * 下潜深度由"平移距离 ≈ K 倍屏宽"反解（Web Mercator 米/像素公式）。
 * 飞行期间 isFlying 守卫忽略程序触发的 zoomstart；连点取消上一次
 * 编排，用户拖动（dragstart）中断飞行并清除高亮。
 * 城市数据由用户在 src/Application/cities.js 手动维护。
 */
const CityChips = ({ mapInstance }) => {
  // 当前选中的城市名（null 表示全局视野，无高亮）
  const [selectedName, setSelectedName] = useState(null);
  // 当前飞行的取消器（null 表示无飞行）；飞行期间程序化动画
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
      // 连点：终止上一次飞行，防止动画叠加抖动
      if (cancelFlightRef.current) cancelFlightRef.current();

      const startCenter = mapInstance.getCenter();
      const distance = startCenter.distance(targetLngLat);

      if (distance < DIRECT_DISTANCE_M) {
        // 近距：单段 SDK 动画，zoomend / moveend 任一触发即视为结束
        const listeners = [];
        const clear = () => {
          listeners.forEach(([event, handler]) =>
            mapInstance.off(event, handler),
          );
          listeners.length = 0;
          cancelFlightRef.current = null;
        };
        ['zoomend', 'moveend'].forEach((event) => {
          const handler = () => clear();
          listeners.push([event, handler]);
          mapInstance.on(event, handler);
        });
        mapInstance.setZoomAndCenter(targetZoom, targetLngLat, false, DIRECT_MS);
        cancelFlightRef.current = clear;
        return;
      }

      // 远距：rAF 连续弧线（immediately=true 跳过 SDK 动画，插值全权接管）
      const startZoom = mapInstance.getZoom();
      const startLng = startCenter.getLng();
      const startLat = startCenter.getLat();
      const [targetLng, targetLat] = targetLngLat;

      // 下潜深度：把两点距离换算成 startZoom 下的像素（Web Mercator），
      // 要求巡航视野下平移量 ≈ K 倍屏宽，反解需缩出的级数
      const size = mapInstance.getSize();
      const screenW = size ? size.getWidth() : 800;
      const avgLatRad = (((startLat + targetLat) / 2) * Math.PI) / 180;
      const mpp = (MPP_EQUATORIAL * Math.cos(avgLatRad)) / 2 ** startZoom;
      const overLevels = Math.log2(
        distance / mpp / (screenW * CRUISE_SCREEN_WIDTHS),
      );
      const cruiseZoom = Math.max(
        MIN_FLY_ZOOM,
        Math.min(startZoom, targetZoom) - Math.max(0, overLevels),
      );
      const dipH = Math.max(0, Math.min(startZoom, targetZoom) - cruiseZoom);

      const duration = Math.min(
        FLY_MAX_MS,
        FLY_BASE_MS + FLY_PER_1000KM_MS * (distance / 1000000),
      );

      let rafId = 0;
      const cancel = () => {
        cancelAnimationFrame(rafId);
        cancelFlightRef.current = null;
      };
      cancelFlightRef.current = cancel;

      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const eased = easeInOutCubic(t);
        // sin(π·eased)：两端为 0（精确落位、无速度折点），中段最深
        const dip = dipH * Math.sin(Math.PI * eased);
        const zoom = startZoom + (targetZoom - startZoom) * eased - dip;
        const lng = startLng + (targetLng - startLng) * eased;
        const lat = startLat + (targetLat - startLat) * eased;
        mapInstance.setZoomAndCenter(zoom, [lng, lat], true);
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          cancelFlightRef.current = null; // 精确落位，解除飞行守卫
        }
      };
      rafId = requestAnimationFrame(step);
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

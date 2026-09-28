import React, { useState, useEffect, useCallback, useRef } from 'react';

import { CITIES, GLOBAL_VIEW } from '../../cities';
import styles from './CityChips.module.css';

// —— van Wijk & Nuij (2003)《Smooth and efficient zooming and panning》参数 ——
// Mapbox flyTo 同源实现（viewport-mercator-project fly-to-viewport.js），
// curve=1.42 为论文用户实验得出的舒适均值；调大更夸张、调小更平直
const CURVE = 1.42;
// 飞行速度（论文口径：每秒移动的视口数），时长 = 1000·S/speed
const SPEED = 1.2;
// 时长钳位，防极端（特近距不至于一闪而过，特远距不至于拖沓）
const FLY_MIN_MS = 800;
const FLY_MAX_MS = 2500;
// 飞行中 zoom 下限（AMap PC 端下限为 3，留余量；正常路径不会触达）
const MIN_ZOOM_FLOOR = 3.5;
// 中心几乎不动时退化为线性插值的阈值（世界像素，论文实现同款）
const EPSILON_PX = 0.01;
// Web Mercator 世界像素基准：worldSize = TILE_SIZE × 2^zoom
const TILE_SIZE = 256;

// easeInOutCubic：两端速度为 0，中段最快
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

// Web Mercator 经纬度 ↔ 世界像素（256px 瓦片基准，worldSize = TILE_SIZE × 2^zoom），
// 两个互转函数自洽互逆
const lngLatToWorld = ([lng, lat], worldSize) => {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * worldSize;
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return [x, y];
};

const worldToLngLat = ([x, y], worldSize) => {
  const lng = (x / worldSize) * 360 - 180;
  const n = Math.PI * (1 - (2 * y) / worldSize);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return [lng, lat];
};

/**
 * 顶部城市跳转胶囊条：点击直达（van Wijk 论文弧线飞行），
 * 再点已选中项 toggle 回全局视野（GLOBAL_VIEW）。
 * 曲线内核为论文方程 9（Mapbox flyTo 同源）：缩放与平移同帧连续进行，
 * 视野宽度 w = cosh(r0)/cosh(r0+ρs) 决定 zoom，中心在 Web Mercator
 * 世界坐标中沿 u 插值，t=1 时数学上精确落位终点。
 * 飞行期间 isFlying 守卫忽略程序触发的 zoomstart；连点取消上一次
 * 飞行，用户拖动（dragstart）中断飞行并清除高亮。
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

      const startCenterLl = mapInstance.getCenter();
      const startCenter = [startCenterLl.getLng(), startCenterLl.getLat()];
      const startZoom = mapInstance.getZoom();
      const size = mapInstance.getSize();
      // 论文口径：视口宽度取宽高中较大者（像素）
      const w0 = size ? Math.max(size.getWidth(), size.getHeight()) : 800;

      // —— 方程 9 静态参数（起点/终点确定后全程不变）——
      const rho2 = CURVE * CURVE;
      const worldSize = TILE_SIZE * 2 ** startZoom;
      const startXY = lngLatToWorld(startCenter, worldSize);
      const endXY = lngLatToWorld(targetLngLat, worldSize);
      const uDelta = [endXY[0] - startXY[0], endXY[1] - startXY[1]];
      const u1 = Math.hypot(uDelta[0], uDelta[1]);
      const w1 = w0 / 2 ** (targetZoom - startZoom);
      const b0 =
        (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1);
      const b1 =
        (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      const S = (r1 - r0) / CURVE;

      // 单帧画面：输入缓动进度 easedT，输出 { zoom, center }
      const frame = (easedT) => {
        if (u1 < EPSILON_PX) {
          // 中心几乎不动：线性插值（论文实现的退化分支）
          return {
            zoom: startZoom + (targetZoom - startZoom) * easedT,
            center: [
              startCenter[0] + (targetLngLat[0] - startCenter[0]) * easedT,
              startCenter[1] + (targetLngLat[1] - startCenter[1]) * easedT,
            ],
          };
        }
        const s = easedT * S;
        const w = Math.cosh(r0) / Math.cosh(r0 + CURVE * s);
        const u =
          (w0 * (Math.cosh(r0) * Math.tanh(r0 + CURVE * s) - Math.sinh(r0))) /
          rho2 /
          u1;
        // 中心：起点世界坐标 + u·位移向量，再按当前视野宽度缩放
        const centerWorld = [
          (startXY[0] + uDelta[0] * u) / w,
          (startXY[1] + uDelta[1] * u) / w,
        ];
        const zoom = Math.max(MIN_ZOOM_FLOOR, startZoom + Math.log2(1 / w));
        return {
          zoom,
          center: worldToLngLat(centerWorld, TILE_SIZE * 2 ** zoom),
        };
      };

      const duration = Math.min(
        FLY_MAX_MS,
        Math.max(FLY_MIN_MS, (1000 * S) / SPEED),
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
        const { zoom, center } = frame(easeInOutCubic(t));
        mapInstance.setZoomAndCenter(zoom, center, true);
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

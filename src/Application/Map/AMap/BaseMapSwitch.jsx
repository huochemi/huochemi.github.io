import React, { useState } from 'react';
import { TileLayer, TileLayerType } from '@uiw/react-amap';

import styles from './BaseMapSwitch.module.css';

// 底图档位。三个值即 state 的全部取值域，localStorage 校验复用同一份定义，
// 避免"可选值"散落两处
export const BASE_MAP_MODES = {
  SATELLITE: 'satellite',
  SATELLITE_ROAD: 'satellite-road',
  ROAD: 'road',
};

// 按钮渲染顺序即档位顺序（影像 → 叠加 → 矢量）
const MODE_OPTIONS = [
  { value: BASE_MAP_MODES.SATELLITE, label: '卫星' },
  { value: BASE_MAP_MODES.SATELLITE_ROAD, label: '卫星+路网' },
  { value: BASE_MAP_MODES.ROAD, label: '路网' },
];

const STORAGE_KEY = 'hcm_base_map';
const DEFAULT_MODE = BASE_MAP_MODES.SATELLITE;

// localStorage 的唯一读取点：模块级求值一次。本 repo 已有反例——hcm_group_by
// 被三处读取，每加一个分支都要重新确认一致性（见 docs/app-structure.md
// 「参数纪律：单一读取点」）。非法的存量值回落默认档，不报错。
const readStoredMode = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return MODE_OPTIONS.some((option) => option.value === stored)
    ? stored
    : DEFAULT_MODE;
};

/**
 * 底图三档切换：卫星 / 卫星+路网 / 路网。
 *
 * 图层与档位的关系（唯一事实源就是下面这一个 mode state）：
 *   satellite       Satellite 显示、RoadNet 隐藏 → 卫星影像
 *   satellite-road  Satellite 显示、RoadNet 显示 → 卫星影像 + 路网
 *   road            两者皆隐藏                    → AMap 默认矢量底图
 *
 * 用声明式 TileLayer 而非 <Map layers={...}>：后者的 layers prop 在 @uiw 内部
 * 走 useSettingProperties(['Layers'])，按数组**引用**比较，每次渲染都会重设图层；
 * 且与官方 MapType 控件并存时构成双头状态（控件切换会被一次重渲染弹回）。
 *
 * visible 走 layer.show() / hide()（useTileLayer 的 effect 依赖是
 * [map, type, options]，不含 visible），故切档不重建图层实例、无重载闪烁。
 * 本组件必须挂在地图 children 内：TileLayer 经 context 取 map。
 */
const BaseMapSwitch = () => {
  const [mode, setMode] = useState(readStoredMode);

  const handleSelect = (next) => {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <>
      <TileLayer
        type={TileLayerType.SATELLITE}
        visible={mode !== BASE_MAP_MODES.ROAD}
      />
      <TileLayer
        type={TileLayerType.ROADNET}
        visible={mode === BASE_MAP_MODES.SATELLITE_ROAD}
      />

      {/* 三档平铺而非单按钮循环：循环往返需点两次，且看不出当前在哪一档 */}
      <div className={styles.switcher} role="group" aria-label="底图类型">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${styles.option} ${
              mode === option.value ? styles.optionActive : ''
            }`}
            aria-pressed={mode === option.value}
            onClick={() => handleSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
};

export default BaseMapSwitch;

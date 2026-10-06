import React, { useState } from 'react';
import { TileLayer, TileLayerType } from '@uiw/react-amap';

import { overseasTileUrl } from './overseasTiles';
import styles from './BaseMapSwitch.module.css';

// 底图档位。四个值即 state 的全部取值域，localStorage 校验复用同一份定义，
// 避免"可选值"散落两处。
// 值 `road` 已写入用户 localStorage（hcm_base_map），是持久化契约：它承载的
// UI 文案是「标准地图」（AMap 默认矢量底图），改值会让存量选择回落默认档。
// 新增的 `overseas` 不破坏该契约：存量值仍是合法值，旧代码读到新值回落默认档。
export const BASE_MAP_MODES = {
  SATELLITE: 'satellite',
  SATELLITE_ROAD: 'satellite-road',
  ROAD: 'road',
  OVERSEAS: 'overseas',
};

// 按钮渲染顺序即档位顺序（影像 → 叠加 → 矢量 → 海外）
const MODE_OPTIONS = [
  { value: BASE_MAP_MODES.SATELLITE, label: '卫星' },
  { value: BASE_MAP_MODES.SATELLITE_ROAD, label: '卫星+路网' },
  { value: BASE_MAP_MODES.ROAD, label: '标准地图' },
  { value: BASE_MAP_MODES.OVERSEAS, label: '海外影像' },
];

const STORAGE_KEY = 'hcm_base_map';
const DEFAULT_MODE = BASE_MAP_MODES.SATELLITE;

// 第四档用到的自定义瓦片层配置。
//
// ⚠️ 必须是**模块级常量**：@uiw 的 useTileLayer effect 依赖数组是
// [map, type, options]（按引用比较），内联对象字面量会让每次渲染都重建图层实例
// （闪烁 + 重复请求）。
//
// zooms 下限 8：高德海外影像自带 z≤7，本层不必请求那几级——露出来更省事也更合规。
// zIndex 4 与 AMap.TileLayer 默认值同值，写出来是为了说明它必须盖在
// Satellite(2) / RoadNet(3) 之上（见 @amap/amap-jsapi-types 的图层 zIndex 说明）。
// getTileUrl 是官方 2.0 支持的 Function(x, y, z) 通道
// （官方示例 jsapi-v2/example/thirdlayer/custom-grid-map）。
const OVERSEAS_TILE_OPTIONS = {
  getTileUrl: overseasTileUrl,
  zooms: [8, 20],
  zIndex: 4,
};

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
 * 底图四档切换：卫星 / 卫星+路网 / 标准地图 / 海外影像。
 *
 * 图层与档位的关系（唯一事实源就是下面这一个 mode state）：
 *   satellite       Satellite 显示、RoadNet 隐藏、自定义层隐藏 → 卫星影像
 *   satellite-road  Satellite 显示、RoadNet 显示、自定义层隐藏 → 卫星影像 + 路网线
 *   road            三者皆隐藏                                  → AMap 标准矢量底图
 *   overseas        Satellite 显示、RoadNet 隐藏、自定义层显示   → 影像：境外=Esri 高清、
 *                                                                 境内=露出高德卫星
 *
 * 第三档 UI 文案用「标准地图」而非「路网」：该档是 AMap 默认矢量底图，并非
 * RoadNet 图层，叫「路网」会被理解成正在看纯道路网格。
 *
 * 第四档为什么仍让 Satellite 保持显示：它**不是**遗留，而是境内瓦片的露出层。
 * 高德卫星在海外只到 z7（z≥8 返回「此区域无卫星图」占位瓦片），所以境外需要
 * 换源；但境内必须用有资质的合规底图，且高德瓦片网格在境内是 GCJ02、外部
 * WGS84 影像直接叠加会偏移数百米——于是自定义层的 getTileUrl 逐块判定，
 * 境内返回透明 GIF 露出下层卫星、境外返回 Esri 影像（判定逻辑全在
 * overseasTiles.js，此处不做任何地理判断）。RoadNet 在第四档隐藏：高清影像上
 * 路网线冗余且遮挡细节。
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
      {/* 自定义瓦片层：options 通道（无 type），见 OVERSEAS_TILE_OPTIONS 的说明 */}
      <TileLayer
        options={OVERSEAS_TILE_OPTIONS}
        visible={mode === BASE_MAP_MODES.OVERSEAS}
      />

      {/* 署名是所用影像源的许可条件（on or near the map），只在第四档出现；
          同时写明"仅境外生效"，避免用户以为境内也切了源 */}
      {mode === BASE_MAP_MODES.OVERSEAS && (
        <div className={styles.attribution}>
          影像 © Esri, Maxar, Earthstar Geographics · 仅境外生效，境内显示高德卫星
        </div>
      )}

      {/* 四档平铺而非单按钮循环：循环往返需点两次，且看不出当前在哪一档 */}
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

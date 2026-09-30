import React, { Component } from 'react';

import { registerShortcut } from './init';
import Map from './Map';
import { demoRegistry } from './demos/registry';
import { parseDemoName } from './demos/parseDemoName';

// Styles for antd
// import "antd/dist/antd.css";
// Styles for application
import './index.css';

// demo 查询参数的唯一读取点。模块级求值一次：避免在 render 中重复解析，
// 也避免未命中告警随每次渲染重复打印。约定见 docs/app-structure.md。
const demoName = parseDemoName(window.location.search);
const DemoComponent = demoName ? demoRegistry[demoName] : null;

if (demoName && !DemoComponent) {
  console.warn(
    `[demo] 未知的 demo 名 "${demoName}"，可用：${
      Object.keys(demoRegistry).join(', ') || '（暂无）'
    }`,
  );
}

export default class Application extends Component {
  componentDidMount() {
    this.initApplication();
  }

  initApplication = () => {
    registerShortcut();
  };

  render() {
    return (
      <div className="application huochemi">
        {DemoComponent ? <DemoComponent /> : <Map />}
      </div>
    );
  }
}

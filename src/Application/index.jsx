import React, { Component } from 'react';

import { registerShortcut } from './init';
import Map from './Map';

// Styles for antd
// import "antd/dist/antd.css";
// Styles for application
import './index.css';

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
        <Map />
      </div>
    );
  }
}

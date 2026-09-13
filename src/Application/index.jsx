import React, { Component } from 'react';

import { registerShortcut } from './init';
import Map from './Map';
import MapIcon from './MapIcon/MapIcon';

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
    const renderDemo = () => {
      return (
        <div>
          <MapIcon />
        </div>
      );
    };

    // get param e.g. ?demo=map
    const urlParams = new URLSearchParams(window.location.search);
    const demoParam = urlParams.get('demo');

    return (
      <div className="application huochemi">
        {!demoParam ? <Map /> : renderDemo()}
      </div>
    );
  }
}

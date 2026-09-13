import React, { Component } from 'react';
import { Button } from 'antd';
import PubSub from 'pubsub-js';

import AMap, { REMOVE_ALL_MARKERS_TOPIC } from './AMap';
import MenuDrawer, { OPEN_DRAWER_TOPIC } from '../MenuDrawer';
import { addMarkersToAMap } from './helpers';

const amapCenter = { latitude: 39.871446, longitude: 116.215768 };

export const SHOW_MARKERS_TOPIC = 'amap.showmarkers'; // TODO duplicated with src/Application/Map/AMap/index.jsx
export const HIDE_MARKERS_TOPIC = 'amap.hidemarkers'; // TODO duplicated with src/Application/Map/AMap/index.jsx

export default class Map extends Component {
  constructor(props) {
    super(props);

    this.state = {
      amapLoaded: false,
    };
  }

  componentDidMount() {
    this.addSubscribers();

    this.handleLoginSuccess();
  }

  componentWillUnmount() {
    this.removeSubscribers();
  }

  handleMapChange = (name) => {
    this.setMap(name);
  };

  /**
   * User success signed in Google account.
   * @param {gapi.auth2.GoogleUser} user
   */
  handleLoginSuccess = async (user) => {
    await addMarkersToAMap();
  };

  handleAMapInstanceCreated = (map) => {
    this.setState({ amapLoaded: true });
  };

  handleSignedOut = () => {
    PubSub.publish(REMOVE_ALL_MARKERS_TOPIC);
  };

  handleDrawerOpen = () => {
    PubSub.publish(OPEN_DRAWER_TOPIC);
  };

  addSubscribers = () => {
    this.showMarkersToken = PubSub.subscribe(
      SHOW_MARKERS_TOPIC,
      this.showMarkersSubscriber,
    );
    this.hideMarkersToken = PubSub.subscribe(
      HIDE_MARKERS_TOPIC,
      this.hideMarkersSubscriber,
    );
  };

  removeSubscribers = () => {};

  showMarkersSubscriber = (msg, filter) => {
    this.updateMarkersInFolderVisible(filter.folderId, true);
  };

  hideMarkersSubscriber = (msg, filter) => {
    this.updateMarkersInFolderVisible(filter.folderId, false);
  };

  render() {
    return (
      <div className="map-wrapper">
        <AMap
          defaultCenter={amapCenter}
          defaultZoom={16}
          onMapInstanceCreated={this.handleAMapInstanceCreated}
        />
        <div className="menu-btn-wrapper">
          <Button onClick={this.handleDrawerOpen}>Menu</Button>
        </div>
        <MenuDrawer
          onRenderFinish={this.handleRenderFinish}
          onLoginSuccess={this.handleLoginSuccess}
          onSignedOut={this.handleSignedOut}
        />
      </div>
    );
  }
}

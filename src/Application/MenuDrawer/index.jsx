import React, { Component } from 'react';
import { Drawer } from 'antd';
import PubSub from 'pubsub-js';

// Open it
export const OPEN_DRAWER_TOPIC = 'menudrawer.open';
// Open or close it according to the state
export const OPEN_CLOSE_DRAWER_TOPIC = 'menudrawer.openclose';

export default class MenuDrawer extends Component {
  state = {
    drawerVisible: false,
    loading: false,
  };

  componentDidMount() {
    this.addSubscribers();
  }

  componentWillUnmount() {
    this.removeSubscribers();
  }

  handleDrawerClose = () => {
    this.setVisible(false);
  };

  setVisible = (visible) => {
    this.setState({ drawerVisible: visible });
  };

  openDrawerSubscriber = (msg) => {
    this.setVisible(true);
  };

  openCloseDrawerSubscriber = (msg) => {
    this.setVisible(!this.state.drawerVisible);
  };

  addSubscribers = () => {
    this.openDrawerToken = PubSub.subscribe(
      OPEN_DRAWER_TOPIC,
      this.openDrawerSubscriber,
    );
    this.openCloseDrawerToken = PubSub.subscribe(
      OPEN_CLOSE_DRAWER_TOPIC,
      this.openCloseDrawerSubscriber,
    );
  };

  removeSubscribers = () => {
    PubSub.unsubscribe(this.openDrawerToken);
  };

  render() {
    const { drawerVisible } = this.state;

    return (
      <div className="menu-drawer">
        <Drawer
          className="menu-drawer"
          width={'50%'}
          placement="left"
          closable={false}
          forceRender
          open={drawerVisible}
          onClose={this.handleDrawerClose}
        ></Drawer>
      </div>
    );
  }
}

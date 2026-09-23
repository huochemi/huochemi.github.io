import React, { useState, useEffect } from 'react';
import { Drawer } from 'antd';
import PubSub from 'pubsub-js';

// Open it
export const OPEN_DRAWER_TOPIC = 'menudrawer.open';
// Open or close it according to the state
export const OPEN_CLOSE_DRAWER_TOPIC = 'menudrawer.openclose';

const MenuDrawer = () => {
  const [drawerVisible, setDrawerVisible] = useState(false);

  useEffect(() => {
    const openDrawerToken = PubSub.subscribe(OPEN_DRAWER_TOPIC, () => {
      setDrawerVisible(true);
    });

    const openCloseDrawerToken = PubSub.subscribe(
      OPEN_CLOSE_DRAWER_TOPIC,
      () => {
        // Use state callback to avoid stale closure issues
        setDrawerVisible((prev) => !prev);
      },
    );

    // Unsubscribe both tokens on unmount
    return () => {
      PubSub.unsubscribe(openDrawerToken);
      PubSub.unsubscribe(openCloseDrawerToken);
    };
  }, []);

  const handleDrawerClose = () => {
    setDrawerVisible(false);
  };

  return (
    <div className="menu-drawer">
      <Drawer
        className="menu-drawer"
        width="50%"
        placement="left"
        closable={false}
        forceRender
        open={drawerVisible}
        onClose={handleDrawerClose}
      />
    </div>
  );
};

export default MenuDrawer;

import React, { useState, useEffect } from 'react';
import { Drawer, Radio, Typography, Space } from 'antd';
import PubSub from 'pubsub-js';

// Open it
export const OPEN_DRAWER_TOPIC = 'menudrawer.open';
// Open or close it according to the state
export const OPEN_CLOSE_DRAWER_TOPIC = 'menudrawer.openclose';

const MenuDrawer = () => {
  const [drawerVisible, setDrawerVisible] = useState(false);

  // 初始化 state，优先读取 localStorage 中的配置，若不存在则默认为 'folder'
  const [groupBy, setGroupBy] = useState(() => {
    return localStorage.getItem('hcm_group_by') || 'folder';
  });

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

  // 处理分组切换逻辑
  const handleGroupByChange = (e) => {
    const newValue = e.target.value;
    setGroupBy(newValue);
    localStorage.setItem('hcm_group_by', newValue);
    // 写入 localStorage 后刷新页面生效
    window.location.reload();
  };

  return (
    <div className="menu-drawer">
      <Drawer
        title="菜单与设置"
        className="menu-drawer"
        width="50%"
        placement="left"
        closable={false}
        forceRender
        open={drawerVisible}
        onClose={handleDrawerClose}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Typography.Text
              strong
              style={{ display: 'block', marginBottom: 8 }}
            >
              分组方式 (Group By)
            </Typography.Text>
            <Radio.Group
              value={groupBy}
              onChange={handleGroupByChange}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="folder">Folder (按文件夹)</Radio.Button>
              <Radio.Button value="photo">Photo (按照片)</Radio.Button>
            </Radio.Group>
          </div>
        </Space>
      </Drawer>
    </div>
  );
};

export default MenuDrawer;

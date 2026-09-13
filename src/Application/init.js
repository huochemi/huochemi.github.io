import PubSub from 'pubsub-js';

import { OPEN_CLOSE_DRAWER_TOPIC } from './MenuDrawer';

export const registerShortcut = () => {
  document.addEventListener(
    'keyup',
    (event) => {
      switch (event.code) {
        // Open or close left menu
        case 'KeyM': {
          PubSub.publish(OPEN_CLOSE_DRAWER_TOPIC);
          break;
        }
        default: {
          break;
        }
      }
    },
    false,
  );
};

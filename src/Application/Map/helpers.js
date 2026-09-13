import PubSub from 'pubsub-js';

import { ADD_MARKERS_TOPIC } from './AMap';

/**
 * Add photos in both private and public Google Drive folders to AMap
 * @param {import("../utils/gDriveFilesApi").File[]} files
 * @return {undefined}
 */
export const addMarkersToAMap = async (files) => {
  PubSub.publish(ADD_MARKERS_TOPIC);
};

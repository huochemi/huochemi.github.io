const path = require('path');
const express = require('express');

// 仅 dev server（npm start）生效；react-scripts 原生加载本文件，build 不受影响。
// 把 /data 挂载到本地 data 仓库（../../data），本地增删照片无需先提交 data repo。
module.exports = function (app) {
  app.use('/data', express.static(path.join(__dirname, '..', '..', 'data')));
};

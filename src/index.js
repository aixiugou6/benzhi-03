'use strict';

const { createDb } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./server');

const PORT = Number(process.env.PORT || 3000);

const db = createDb();
const seedResult = seed(db);
console.log(`示例数据：新增 ${seedResult.inserted} 条，跳过重复 ${seedResult.duplicates} 条`);

createApp(db).listen(PORT, () => {
  console.log(`冷链记录系统已启动: http://localhost:${PORT}`);
});

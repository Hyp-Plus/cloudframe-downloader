// 离屏截图脚本：渲染 preview/conveyor-states.html 的下载中/完成两种工况并导出 PNG。
// 用法：npx electron scripts/capture-conveyor.cjs
// 仅用于视觉复核，不参与应用构建。
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  console.log("electron ready");
  const win = new BrowserWindow({ show: false, width: 1120, height: 900 });
  for (const state of ["downloading", "complete"]) {
    for (const theme of ["dark", "light"]) {
      win.setSize(1120, state === "downloading" ? 900 : 640);
      // 不等待外网字体：loadFile 与 5s 超时竞速，本地 CSS 已到即可截图
      await Promise.race([
        win.loadFile(join(root, "preview", "conveyor-states.html"), { query: { state, theme } }).catch(err => console.log("load warn:", String(err))),
        sleep(5000),
      ]);
      console.log(`loaded ${state}/${theme}`);
      await sleep(1200); // 等动画落位
      const image = await win.webContents.capturePage();
      const file = join(root, "preview", `conveyor-${state}-${theme}.png`);
      writeFileSync(file, image.toPNG());
      console.log(`saved ${file}`);
    }
  }
  win.destroy();
  app.quit();
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });

setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 60000);

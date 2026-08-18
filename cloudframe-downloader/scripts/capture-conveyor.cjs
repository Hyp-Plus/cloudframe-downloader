// 离屏截图脚本 v3：渲染 preview/conveyor-states.html 的六态 × 双主题并导出 PNG。
// 用法：npx electron scripts/capture-conveyor.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const states = ["idle", "queued", "downloading", "paused", "failed", "complete"];
const heights = { idle: 520, queued: 780, downloading: 900, paused: 700, failed: 620, complete: 620 };

app.whenReady().then(async () => {
  console.log("electron ready");
  const win = new BrowserWindow({ show: false, width: 1120, height: 900 });
  for (const state of states) {
    for (const theme of ["dark", "light"]) {
      win.setSize(1120, heights[state] || 700);
      await Promise.race([
        win.loadFile(join(root, "preview", "conveyor-states.html"), { query: { state, theme } }).catch(err => console.log("load warn:", String(err))),
        sleep(5000),
      ]);
      console.log(`loaded ${state}/${theme}`);
      await sleep(1500);
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

setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 120000);

// 离屏截图脚本：渲染 preview/conveyor-states.html 的下载中/完成两种工况并导出 PNG。
// 用法：npx electron scripts/capture-conveyor.mjs
// 仅用于视觉复核，不参与应用构建。
import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await app.whenReady();
console.log("electron ready");

for (const state of ["downloading", "complete"]) {
  const win = new BrowserWindow({
    show: false,
    width: 1120,
    height: state === "downloading" ? 900 : 640,
    webPreferences: { sandbox: true },
  });
  // 不等待外网字体：loadFile 与 5s 超时竞速，本地 CSS 已到即可截图
  await Promise.race([
    win.loadFile(join(root, "preview", "conveyor-states.html"), { query: { state } }).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 1200)); // 等动画落位
  const image = await win.webContents.capturePage();
  const file = join(root, "preview", `conveyor-${state}.png`);
  writeFileSync(file, image.toPNG());
  console.log(`saved ${file}`);
  win.destroy();
}

app.quit();
process.exit(0);

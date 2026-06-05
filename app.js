import * as localDb from "./local-db.js";
import { recalculateDataset } from "./local-calculator.js";

const APP_RUNTIME_CHUNKS = [
  "app-runtime-01.js",
  "app-runtime-02.js",
  "app-runtime-03.js",
  "app-runtime-04.js",
  "app-runtime-05.js",
  "app-runtime-06.js",
  "app-runtime-07.js",
  "app-runtime-08.js"
];

const runtimeSource = await Promise.all(
  APP_RUNTIME_CHUNKS.map(async (name) => {
    const response = await fetch(new URL(name, import.meta.url), { cache: "no-cache" });
    if (!response.ok) throw new Error(`PWA 載入失敗：${name}`);
    return response.text();
  }),
);

new Function("localDb", "recalculateDataset", `${runtimeSource.join("")}
//# sourceURL=asset-pwa-runtime.js
`)(localDb, recalculateDataset);

if (document.readyState !== "loading") {
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

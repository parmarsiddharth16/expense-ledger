import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const scan = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (!/\.(jsx?|json|html|css)$/.test(name)) continue;
    const data = readFileSync(p);
    if (data.includes(0)) {
      writeFileSync(p, Buffer.from(data.filter((b) => b !== 0)));
      console.log(`clean.mjs: stripped null bytes from ${p}`);
    }
  }
};
scan(".");

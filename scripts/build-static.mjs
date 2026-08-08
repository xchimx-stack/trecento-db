import fs from "node:fs/promises";
await fs.access(new URL("../public/index.html", import.meta.url));
console.log("Static Trecento Network ready for deployment.");

import { createRequire } from "node:module";

const manifest: { version: string } = createRequire(import.meta.url)(
  "../package.json",
);
export const version = manifest.version;

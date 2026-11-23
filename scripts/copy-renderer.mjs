// Copy the static renderer files (HTML/CSS) next to the compiled JS.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer", "dist/renderer", { recursive: true, filter: (src) => !src.endsWith(".ts") });

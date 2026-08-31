import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" にしておくことで、GitHub Pagesのどのサブパス
// （https://ユーザー名.github.io/リポジトリ名/）でもリポジトリ名の
// 変更なしにそのまま動きます。
export default defineConfig({
  plugins: [react()],
  base: "./",
});

import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  /* `.claude/` holds agent worktrees: whole copies of this repo, gitignored and
     not ours to lint. Without this, a background task's worktree turns a clean
     run into thousands of duplicated findings. */
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".cache/**", ".claude/**", "target/**", "src/data/stockroom.ts"] },
];
export default config;

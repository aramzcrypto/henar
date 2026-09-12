#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p .cache
cargo build-sbf --manifest-path programs/stockroom/Cargo.toml 2>&1 | tee .cache/sbf-build.log
# The SBF compiler can report stack errors without a nonzero exit code.
if rg -q 'Error:|Stack offset|overwrites values in the frame' .cache/sbf-build.log; then
  echo 'SBF stack verification failed.' >&2
  exit 1
fi
anchor idl build --out src/data/stockroom-idl.json
anchor idl type src/data/stockroom-idl.json --out src/data/stockroom.ts
cargo test -p stockroom-math
SBF_OUT_DIR="$PWD/target/deploy" cargo test -p stockroom --test runtime -- --test-threads=1

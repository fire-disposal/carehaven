#!/usr/bin/env bash
# 本地开发用：下载 DeepSeek 官方 tokenizer 到 tokenizer/model/
#
# 生产镜像在构建时自行下载并校验 sha256，不读这个目录；
# 本地跑侧车时：TOKENIZER_MODEL=./tokenizer/model/tokenizer.json python tokenizer/app.py
set -euo pipefail

cd "$(dirname "$0")"
URL="https://cdn.deepseek.com/api-docs/deepseek_v3_tokenizer.zip"
SHA="c954ca6f6e54281d72d3c27e2430cea7663f81292b39982e2f97890c66c302de"

mkdir -p model
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$URL" -o "$tmp/tokenizer.zip"
echo "$SHA  $tmp/tokenizer.zip" | sha256sum -c -
unzip -q "$tmp/tokenizer.zip" -d "$tmp"
cp "$tmp/deepseek_v3_tokenizer/tokenizer.json" model/tokenizer.json
echo "已写入 tokenizer/model/tokenizer.json"

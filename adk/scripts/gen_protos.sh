#!/usr/bin/env bash
# Regenerates the url-resolver gRPC Python stubs vendored under
# cofacts_ai/url_resolver/_generated/. Run after changing a .proto file in
# cofacts_ai/url_resolver/protos/ (which are vendored verbatim from
# https://github.com/cofacts/url-resolver — do not hand-edit them).
#
# The generated stubs are committed to the repo so the runtime image (built
# with `uv sync --frozen --no-dev`) only ever needs `grpcio`, not
# `grpcio-tools`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROTO_DIR="cofacts_ai/url_resolver/protos"
OUT_DIR="cofacts_ai/url_resolver/_generated"

uv run python -m grpc_tools.protoc \
  -I "$PROTO_DIR" \
  --python_out="$OUT_DIR" \
  --grpc_python_out="$OUT_DIR" \
  --pyi_out="$OUT_DIR" \
  "$PROTO_DIR"/*.proto

# protoc emits top-level `import foo_pb2 as ...` in the generated files (and
# matching .pyi stubs), which breaks once _generated/ is imported as a package
# (cofacts_ai.url_resolver._generated.foo_pb2) rather than run as a top-level
# script. Rewrite those to explicit relative imports.
for f in "$OUT_DIR"/*_pb2.py "$OUT_DIR"/*_pb2_grpc.py "$OUT_DIR"/*_pb2.pyi; do
  sed -i -E 's/^import ([a-zA-Z_]+_pb2) as /from . import \1 as /' "$f"
done

echo "Generated stubs in $OUT_DIR"

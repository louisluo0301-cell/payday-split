# PaydaySplit — one-command deployment (macOS / Linux / WSL)
#
# Usage:
#   bash script/deploy.sh
#
# Requires forge/cast on PATH and a funded throwaway testnet wallet in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v forge >/dev/null 2>&1; then
  echo "forge not found on PATH. Install Foundry first: https://book.getfoundry.sh/" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and fill PRIVATE_KEY." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

DEST_RPC="${DEST_RPC_URL:-${SEPOLIA_RPC_URL:-}}"
[ -n "$DEST_RPC" ] || { echo "Set DEST_RPC_URL (or SEPOLIA_RPC_URL) in .env" >&2; exit 1; }
[ -n "${LASNA_RPC_URL:-}" ] || { echo "Set LASNA_RPC_URL in .env" >&2; exit 1; }
[ -n "${PRIVATE_KEY:-}" ] || { echo "Set PRIVATE_KEY in .env" >&2; exit 1; }
[ -n "${CALLBACK_PROXY:-}" ] || { echo "Set CALLBACK_PROXY in .env" >&2; exit 1; }

set_env_line() {
  local key="$1" value="$2"
  if grep -qE "^[[:space:]]*${key}=" .env; then
    # BSD sed and GNU sed differ; use a temp file.
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env > .env.tmp
    mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
  export "$key=$value"
}

run_forge() {
  local sig="$1" rpc="$2"
  echo ""
  echo "==> forge script $sig"
  forge script "$sig" --rpc-url "$rpc" --broadcast --non-interactive -vv
}

parse_addr() {
  local text="$1" name="$2"
  printf '%s\n' "$text" | grep -oE "${name}=[[:space:]]*0x[0-9a-fA-F]{40}" | head -1 | grep -oE '0x[0-9a-fA-F]{40}'
}

out1="$(run_forge script/Deploy.s.sol:DeployDest "$DEST_RPC")"
TOKEN="$(parse_addr "$out1" TOKEN_ADDR)"
SPLIT="$(parse_addr "$out1" SPLIT_ADDR)"
FACTORY="$(parse_addr "$out1" MODULE_FACTORY)"
RETRY_QUEUE="$(parse_addr "$out1" RETRY_QUEUE)"
[ -n "$TOKEN" ] && [ -n "$SPLIT" ] || { echo "Failed to parse deployment addresses" >&2; exit 1; }
set_env_line TOKEN_ADDR "$TOKEN"
set_env_line SPLIT_ADDR "$SPLIT"

out2="$(run_forge script/Deploy.s.sol:DeployReactive "$LASNA_RPC_URL")"
REACTIVE="$(parse_addr "$out2" REACTIVE_ADDR)"
[ -n "$REACTIVE" ] || { echo "Failed to parse REACTIVE_ADDR" >&2; exit 1; }
set_env_line REACTIVE_ADDR "$REACTIVE"

run_forge script/Deploy.s.sol:Configure "$DEST_RPC" >/dev/null
run_forge script/Deploy.s.sol:SimulatePaycheck "$DEST_RPC" >/dev/null

CHAIN_ID="${DEST_CHAIN_ID:-11155111}"
case "$CHAIN_ID" in
  11155111) NETWORK="sepolia"; EXPLORER="https://sepolia.etherscan.io" ;;
  84532) NETWORK="base-sepolia"; EXPLORER="https://sepolia.basescan.org" ;;
  1301) NETWORK="unichain-sepolia"; EXPLORER="https://sepolia.uniscan.xyz" ;;
  *) NETWORK="chain-$CHAIN_ID"; EXPLORER="" ;;
esac
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY" | tr -d '[:space:]')"
mkdir -p deployments web/public
cat > "deployments/$CHAIN_ID.json" <<JSON
{
  "chainId": $CHAIN_ID,
  "network": "$NETWORK",
  "rpcUrl": "$DEST_RPC",
  "explorer": "$EXPLORER",
  "token": "$TOKEN",
  "split": "$SPLIT",
  "modules": {
    "factory": "$FACTORY",
    "retryQueue": "$RETRY_QUEUE",
    "wrappedNative": "${WRAPPED_NATIVE:-}",
    "aavePool": "${AAVE_POOL:-}"
  },
  "reactive": "$REACTIVE",
  "proxy": "$CALLBACK_PROXY",
  "deployer": "$DEPLOYER",
  "savings": "${SAVINGS_PAYEE:-0x000000000000000000000000000000000000cafE}",
  "buckets": 3,
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
cp "deployments/$CHAIN_ID.json" web/public/deployments.json

echo ""
echo "Deployed PaydaySplit:"
echo "  token      $TOKEN"
echo "  split      $SPLIT"
echo "  reactive   $REACTIVE"
echo "  deployment deployments/$CHAIN_ID.json"
echo ""
echo "Run 'bash script/verify.sh' to print the full-loop evidence."

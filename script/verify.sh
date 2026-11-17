#!/usr/bin/env bash
# PaydaySplit — on-chain evidence (macOS / Linux / WSL)
# Usage: bash script/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source .env
set +a

DEST_RPC="${DEST_RPC_URL:-${SEPOLIA_RPC_URL:-}}"
CHAIN_ID="${DEST_CHAIN_ID:-11155111}"
USER_ADDR="$(cast wallet address --private-key "$PRIVATE_KEY" | tr -d '[:space:]')"
case "$CHAIN_ID" in
  11155111) EXPLORER="https://sepolia.etherscan.io" ;;
  84532) EXPLORER="https://sepolia.basescan.org" ;;
  1301) EXPLORER="https://sepolia.uniscan.xyz" ;;
  *) EXPLORER="" ;;
esac
BLOCK="$(cast block-number --rpc-url "$DEST_RPC")"
FROM=$(( BLOCK > 5000 ? BLOCK - 5000 : 0 ))

echo ""
echo "== 1) origin chain ($CHAIN_ID)"
echo "   token   $TOKEN_ADDR"
echo "   user    $USER_ADDR"
echo "   recent Transfer logs to $USER_ADDR (last 5000 blocks):"
cast logs --rpc-url "$DEST_RPC" --address "$TOKEN_ADDR" --from-block "$FROM" \
  "Transfer(address indexed from, address indexed to, uint256 value)" 2>/dev/null |
  grep -E "transactionHash|blockNumber|data" | tail -12 || true

echo ""
echo "== 2) Lasna reactive contract"
echo "   reactive $REACTIVE_ADDR"
echo "   remaining: $(cast call --rpc-url "$LASNA_RPC_URL" "$REACTIVE_ADDR" 'remaining()(uint256)')"
echo "   minPaycheck: $(cast call --rpc-url "$LASNA_RPC_URL" "$REACTIVE_ADDR" 'minPaycheck()(uint256)')"
echo "   userRemaining: $(cast call --rpc-url "$LASNA_RPC_URL" "$REACTIVE_ADDR" 'userRemaining(address,address)(uint256)' "$USER_ADDR" "$TOKEN_ADDR")"
echo "   owner:     $(cast call --rpc-url "$LASNA_RPC_URL" "$REACTIVE_ADDR" 'owner()(address)')"
echo "   paused:    $(cast call --rpc-url "$LASNA_RPC_URL" "$REACTIVE_ADDR" 'paused()(bool)')"
echo "   rule:"
cast call --rpc-url "$LASNA_RPC_URL" "$REACTIVE_ADDR" \
  'getRule(address,address)(address[],uint96[],uint16[],bool[],uint256,bool)' "$USER_ADDR" "$TOKEN_ADDR" || true
echo "   browser:   https://lasna.reactscan.net/address/$REACTIVE_ADDR"

echo ""
echo "== 3) destination waterfall"
echo "   split    $SPLIT_ADDR"
echo "   reactive: $(cast call --rpc-url "$DEST_RPC" "$SPLIT_ADDR" 'reactive()(address)')"
echo "   bucketCount: $(cast call --rpc-url "$DEST_RPC" "$SPLIT_ADDR" 'bucketCount(address,address)(uint256)' "$USER_ADDR" "$TOKEN_ADDR")"
echo "   ruleVersion: $(cast call --rpc-url "$DEST_RPC" "$SPLIT_ADDR" 'ruleVersion(address,address)(uint256)' "$USER_ADDR" "$TOKEN_ADDR")"
echo "   buckets:"
cast call --rpc-url "$DEST_RPC" "$SPLIT_ADDR" \
  'getBuckets(address,address)((address,uint96,uint16,bool)[])' "$USER_ADDR" "$TOKEN_ADDR" || true
echo "   preview on 1,000 units (payees, amounts, retained):"
cast call --rpc-url "$DEST_RPC" "$SPLIT_ADDR" \
  'previewWaterfall(address,address,uint256)(address[],uint256[],uint256)' "$USER_ADDR" "$TOKEN_ADDR" 1000000000 || true
echo "   browser:  $EXPLORER/address/$SPLIT_ADDR"
echo "   recent Split logs:"
cast logs --rpc-url "$DEST_RPC" --address "$SPLIT_ADDR" --from-block "$FROM" \
  "Split(address indexed user, address indexed token, address indexed payee, uint256 paycheck, uint256 amount, uint256 bucketIndex, uint256 version, uint256 originTxHash, uint256 logIndex)" 2>/dev/null |
  grep -E "transactionHash|blockNumber|data" | tail -16 || true
echo "   recent Retained logs:"
cast logs --rpc-url "$DEST_RPC" --address "$SPLIT_ADDR" --from-block "$FROM" \
  "Retained(address indexed user, address indexed token, uint256 amount, uint256 version, uint256 originTxHash, uint256 logIndex)" 2>/dev/null |
  grep -E "transactionHash|blockNumber|data" | tail -8 || true

echo ""
echo "Paste the Transfer tx, the Lasna react tx, and the callback tx into the submission."

#!/bin/sh
# Full two-party AgentTab lifecycle over XO on chipnet. Each line is a separate process (one XO engine each).
# Usage: sh scripts/run-tab.sh <name> <budgetSats> <timeoutBlocksFromNow> settle <voucherAmountSats>
#        sh scripts/run-tab.sh <name> <budgetSats> <timeoutBlocksFromNow> cancel
#        sh scripts/run-tab.sh <name> <budgetSats> 0 refund        (timeout = current height, so refund is valid now)
set -e
NAME=$1 BUDGET=$2 BLOCKS=$3 CLOSE=$4 AMOUNT=$5
run() { node --env-file=.env scripts/tab.ts "$@" 2>&1 | grep -v "Failed to process transaction update"; }
run owner    open-create "$NAME" "$BUDGET" "$BLOCKS"
run provider open-accept "$NAME"
run owner    open-fund   "$NAME"
run provider sync        "$NAME" > /dev/null
case "$CLOSE" in
  settle) node --env-file=.env scripts/tab.ts agent voucher "$NAME" "$AMOUNT"; run provider settle "$NAME" ;;
  cancel) run provider cancel "$NAME" ;;
  refund) run owner refund "$NAME" ;;
esac

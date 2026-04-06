#!/usr/bin/env bash
# ============================================================
# WF-06 End-to-End Test Script
# 模擬 SPY/QQQ OCC symbol → conid 解析 → dry-run 下單
# ============================================================
# Usage:
#   ./tests/test-wf06-e2e.sh <refresh_token>
#
# Prerequisites:
#   - WF-06 已部署且 Active
#   - tastytrade refresh_token 有效
#   - curl + python3 installed
# ============================================================

set -euo pipefail

WEBHOOK="https://chilldove.app.n8n.cloud/webhook/student-order"
ACCOUNT="5WZ90854"
TIMEOUT=30

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# ─── Args ───
REFRESH_TOKEN="${1:-}"
if [ -z "$REFRESH_TOKEN" ]; then
  echo -e "${RED}Usage: $0 <tastytrade_refresh_token>${NC}"
  echo "  Optional: $0 <refresh_token> [account_number]"
  exit 1
fi
ACCOUNT="${2:-$ACCOUNT}"

PASS=0
FAIL=0
TOTAL=0

# ─── Test Runner ───
run_test() {
  local test_name="$1"
  local payload="$2"
  local expect_success="$3"       # "true" or "false"
  local expect_broker="$4"        # "tastytrade", "schwab", "ibkr"
  local expect_order_type="$5"    # "OTOCO", "OTO", "Simple", "BRACKET", etc.
  local extra_checks="${6:-}"      # additional python checks

  TOTAL=$((TOTAL + 1))
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}TEST $TOTAL: $test_name${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  RESULT=$(curl -s --max-time $TIMEOUT -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1)

  if [ -z "$RESULT" ] || echo "$RESULT" | grep -q "Error in workflow"; then
    echo -e "  ${RED}✗ FAIL${NC} — Webhook returned error or empty response"
    echo "  Response: ${RESULT:0:200}"
    FAIL=$((FAIL + 1))
    return
  fi

  # Validate with Python
  VALIDATION=$(echo "$RESULT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except:
    print('PARSE_ERROR')
    sys.exit(0)

errors = []
success = str(d.get('success', '')).lower()
broker = d.get('broker', '')
order_type = d.get('order_type', '')
dry_run = d.get('dry_run', '')
tracking = d.get('tracking_id', '')
error_msg = d.get('error', '')

# Check success
if '${expect_success}' == 'true' and success != 'true':
    errors.append(f'Expected success=true, got {success}. Error: {error_msg[:100]}')
if '${expect_success}' == 'false' and success == 'true':
    errors.append(f'Expected success=false, got true')

# Check broker
if '${expect_broker}' and broker != '${expect_broker}':
    errors.append(f'Expected broker=${expect_broker}, got {broker}')

# Check order type
if '${expect_order_type}' and order_type != '${expect_order_type}':
    errors.append(f'Expected order_type=${expect_order_type}, got {order_type}')

# Extra checks
${extra_checks}

if errors:
    print('FAIL|' + '; '.join(errors))
else:
    details = []
    details.append(f'broker={broker}')
    details.append(f'order_type={order_type}')
    details.append(f'dry_run={dry_run}')
    if d.get('buying_power_change'): details.append(f'bp_change={d[\"buying_power_change\"]}')
    if d.get('margin_req'): details.append(f'margin={d[\"margin_req\"]}')
    if d.get('is_spread') is not None: details.append(f'spread={d[\"is_spread\"]}')
    if d.get('message'): details.append(f'msg={d[\"message\"][:60]}')
    if error_msg: details.append(f'error={error_msg[:60]}')
    print('PASS|' + ', '.join(details))
" 2>/dev/null)

  STATUS=$(echo "$VALIDATION" | cut -d'|' -f1)
  DETAILS=$(echo "$VALIDATION" | cut -d'|' -f2-)

  if [ "$STATUS" = "PASS" ]; then
    echo -e "  ${GREEN}✓ PASS${NC} — $DETAILS"
    PASS=$((PASS + 1))
  elif [ "$STATUS" = "PARSE_ERROR" ]; then
    echo -e "  ${RED}✗ FAIL${NC} — Could not parse JSON response"
    echo "  Response: ${RESULT:0:200}"
    FAIL=$((FAIL + 1))
  else
    echo -e "  ${RED}✗ FAIL${NC} — $DETAILS"
    FAIL=$((FAIL + 1))
  fi
}

# ============================================================
# TEST SUITE
# ============================================================

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║     WF-06 End-to-End Test Suite                     ║"
echo "║     Account: $ACCOUNT                          ║"
echo "║     Webhook: $WEBHOOK  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ──────────────────────────────────────────────────────────────
# Group 1: tastytrade — SPY Put Credit Spread OTOCO
# ──────────────────────────────────────────────────────────────

run_test \
  "tastytrade | SPY PCS 540/535 | OTOCO dry-run" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"refresh_token\":\"$REFRESH_TOKEN\",
    \"broker\":\"tastytrade\",\"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"legs\":[
      {\"symbol\":\"SPY   260417P00540000\",\"action\":\"Sell to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"},
      {\"symbol\":\"SPY   260417P00535000\",\"action\":\"Buy to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"}
    ],
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"stop_loss_price\":\"1.56\",\"profit_target_price\":\"0.60\",
    \"tracking_id\":\"E2E-TT-OTOCO-001\",\"dry_run\":true
  }" \
  "true" "tastytrade" "OTOCO" ""

# ──────────────────────────────────────────────────────────────
# Group 2: tastytrade — QQQ Call Credit Spread OTO
# ──────────────────────────────────────────────────────────────

run_test \
  "tastytrade | QQQ CCS 480/485 | OTO dry-run (stop only)" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"refresh_token\":\"$REFRESH_TOKEN\",
    \"broker\":\"tastytrade\",\"symbol\":\"QQQ\",\"strategy\":\"CCS\",
    \"legs\":[
      {\"symbol\":\"QQQ   260417C00480000\",\"action\":\"Sell to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"},
      {\"symbol\":\"QQQ   260417C00485000\",\"action\":\"Buy to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"}
    ],
    \"quantity\":1,\"limit_price\":\"0.85\",\"price_effect\":\"Credit\",
    \"stop_loss_price\":\"1.11\",
    \"tracking_id\":\"E2E-TT-OTO-001\",\"dry_run\":true
  }" \
  "true" "tastytrade" "OTO" ""

# ──────────────────────────────────────────────────────────────
# Group 3: tastytrade — SPY Simple (no stop loss)
# ──────────────────────────────────────────────────────────────

run_test \
  "tastytrade | SPY PCS 540/535 | Simple dry-run (no stop)" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"refresh_token\":\"$REFRESH_TOKEN\",
    \"broker\":\"tastytrade\",\"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"legs\":[
      {\"symbol\":\"SPY   260417P00540000\",\"action\":\"Sell to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"},
      {\"symbol\":\"SPY   260417P00535000\",\"action\":\"Buy to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"}
    ],
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"tracking_id\":\"E2E-TT-SIMPLE-001\",\"dry_run\":true
  }" \
  "true" "tastytrade" "Simple" ""

# ──────────────────────────────────────────────────────────────
# Group 4: tastytrade — Default broker (backward compat)
# ──────────────────────────────────────────────────────────────

run_test \
  "tastytrade | No broker field (backward compat)" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"refresh_token\":\"$REFRESH_TOKEN\",
    \"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"legs\":[
      {\"symbol\":\"SPY   260417P00540000\",\"action\":\"Sell to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"},
      {\"symbol\":\"SPY   260417P00535000\",\"action\":\"Buy to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"}
    ],
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"tracking_id\":\"E2E-TT-COMPAT-001\",\"dry_run\":true
  }" \
  "true" "tastytrade" "" ""

# ──────────────────────────────────────────────────────────────
# Group 5: Schwab — BRACKET dry-run (local validation)
# ──────────────────────────────────────────────────────────────

run_test \
  "Schwab | SPY PCS BRACKET dry-run (local validate)" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"HASH123\",
    \"refresh_token\":\"fake_schwab_token\",
    \"broker\":\"schwab\",\"client_id\":\"test_cid\",\"client_secret\":\"test_csec\",
    \"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"legs\":[
      {\"symbol\":\"SPY   260417P00540000\",\"action\":\"Sell to Open\",\"quantity\":1},
      {\"symbol\":\"SPY   260417P00535000\",\"action\":\"Buy to Open\",\"quantity\":1}
    ],
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"stop_loss_price\":\"1.56\",\"profit_target_price\":\"0.60\",
    \"tracking_id\":\"E2E-SCHWAB-001\",\"dry_run\":true
  }" \
  "false" "schwab" "" \
  "if 'schwab' not in broker.lower() and not error_msg: errors.append('Should route to Schwab')"

# ──────────────────────────────────────────────────────────────
# Group 6: IBKR — dry-run (conid would resolve if token valid)
# ──────────────────────────────────────────────────────────────

run_test \
  "IBKR | SPY PCS dry-run (routing check)" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"U12345\",
    \"refresh_token\":\"fake_ibkr_token\",
    \"broker\":\"ibkr\",\"client_id\":\"test_cid\",\"client_secret\":\"test_csec\",
    \"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"legs\":[
      {\"symbol\":\"SPY   260417P00540000\",\"action\":\"Sell to Open\",\"quantity\":1},
      {\"symbol\":\"SPY   260417P00535000\",\"action\":\"Buy to Open\",\"quantity\":1}
    ],
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"tracking_id\":\"E2E-IBKR-001\",\"dry_run\":true
  }" \
  "false" "ibkr" "" \
  "if 'ibkr' not in broker.lower() and not error_msg: errors.append('Should route to IBKR')"

# ──────────────────────────────────────────────────────────────
# Group 7: Validation — Missing required fields
# ──────────────────────────────────────────────────────────────

run_test \
  "Validation | Missing refresh_token" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"legs\":[{\"symbol\":\"SPY   260417P00540000\",\"action\":\"Sell to Open\",\"quantity\":1}],
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"dry_run\":true
  }" \
  "false" "" "" \
  "if 'missing' not in error_msg.lower() and 'refresh_token' not in error_msg.lower(): errors.append(f'Should report missing field, got: {error_msg[:100]}')"

run_test \
  "Validation | Missing legs" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"refresh_token\":\"$REFRESH_TOKEN\",
    \"symbol\":\"SPY\",\"strategy\":\"PCS\",
    \"quantity\":1,\"limit_price\":\"1.20\",\"price_effect\":\"Credit\",
    \"dry_run\":true
  }" \
  "false" "" "" \
  "if 'missing' not in error_msg.lower() and 'legs' not in error_msg.lower(): errors.append(f'Should report missing legs, got: {error_msg[:100]}')"

# ──────────────────────────────────────────────────────────────
# Group 8: OCC Symbol Parsing (via tastytrade — validates symbols)
# ──────────────────────────────────────────────────────────────

run_test \
  "OCC Parse | AAPL 260515P00200000 (debit spread)" \
  "{
    \"student_id\":\"TEST-E2E\",\"account_number\":\"$ACCOUNT\",
    \"refresh_token\":\"$REFRESH_TOKEN\",
    \"broker\":\"tastytrade\",\"symbol\":\"AAPL\",\"strategy\":\"BPDS\",
    \"legs\":[
      {\"symbol\":\"AAPL  260515P00200000\",\"action\":\"Buy to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"},
      {\"symbol\":\"AAPL  260515P00195000\",\"action\":\"Sell to Open\",\"quantity\":1,\"instrument_type\":\"Equity Option\"}
    ],
    \"quantity\":1,\"limit_price\":\"2.50\",\"price_effect\":\"Debit\",
    \"tracking_id\":\"E2E-TT-AAPL-001\",\"dry_run\":true
  }" \
  "true" "tastytrade" "" ""

# ============================================================
# SUMMARY
# ============================================================

echo ""
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo -e "║     TEST RESULTS                                    ║"
echo -e "║     Total: $TOTAL  |  ${GREEN}Pass: $PASS${NC}${BOLD}  |  ${RED}Fail: $FAIL${NC}${BOLD}           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}$FAIL test(s) failed.${NC}"
  exit 1
fi

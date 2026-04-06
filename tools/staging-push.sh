#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Staging Push Helper
# 用法: ./staging-push.sh <json-file>
# 或:   echo '{"signals":[...]}' | ./staging-push.sh -
#
# 推送測試信號到 staging（不影響正式 cache）
# ═══════════════════════════════════════════════════════════

WEBHOOK="https://chilldove.app.n8n.cloud/webhook/skool-verify"

if [ "$1" = "-" ]; then
  DATA=$(cat)
elif [ -f "$1" ]; then
  DATA=$(cat "$1")
else
  echo "用法: ./staging-push.sh <json-file>"
  echo "       echo '{...}' | ./staging-push.sh -"
  echo ""
  echo "其他操作:"
  echo "  ./staging-push.sh --get       讀取 staging 信號"
  echo "  ./staging-push.sh --clear     清空 staging"
  echo "  ./staging-push.sh --get-prod  讀取正式信號"
  echo "  ./staging-push.sh --clear-prod 清空正式信號"
  exit 1
fi

case "$1" in
  --get)
    curl -s -X POST "$WEBHOOK" -H "Content-Type: application/json" \
      -d '{"action":"get_staging"}' | python3 -m json.tool
    exit 0
    ;;
  --clear)
    curl -s -X POST "$WEBHOOK" -H "Content-Type: application/json" \
      -d '{"action":"clear_staging"}'
    echo ""
    exit 0
    ;;
  --get-prod)
    curl -s -X POST "$WEBHOOK" -H "Content-Type: application/json" \
      -d '{"action":"get_signals"}' | python3 -m json.tool
    exit 0
    ;;
  --clear-prod)
    curl -s -X POST "$WEBHOOK" -H "Content-Type: application/json" \
      -d '{"action":"clear_production"}'
    echo ""
    exit 0
    ;;
esac

# Inject action: push_staging into the payload
STAGED=$(echo "$DATA" | python3 -c "
import json, sys
d = json.load(sys.stdin)
d['action'] = 'push_staging'
print(json.dumps(d))
")

RESULT=$(curl -s -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "$STAGED")

echo "$RESULT"
echo ""
echo "✅ 推送到 staging 完成（不影響正式 cache）"
echo "   在 Dashboard 開啟 🧪 Staging 模式後點連線即可查看"

#!/bin/bash
# ResearchOS — start the frontend.
#
# The app is now fully client-side via the File System Access API.
# The legacy FastAPI backend is no longer required and is not launched here.
# Usage: ./start.sh

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔬 Starting ResearchOS..."

# ── Kill anything already using our port ──────────────────────────────────────
PID=$(lsof -ti tcp:3000 2>/dev/null || true)
if [ -n "$PID" ]; then
    echo "  → Killing existing process on port 3000 (PID $PID)"
    kill -9 $PID 2>/dev/null || true
fi
sleep 1

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "  → Starting frontend (Next.js) on http://localhost:3000 ..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $FRONTEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo "   Done."
}
trap cleanup EXIT INT TERM

echo ""
echo "✅ ResearchOS is running!"
echo "   Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop."

wait

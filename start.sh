#!/bin/bash
# ResearchOS — start backend + frontend in one command
# Usage: ./start.sh  (or add to PATH and just run: researchos)

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔬 Starting ResearchOS..."

# ── Kill anything already using our ports ─────────────────────────────────────
for PORT in 8000 3000; do
    PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "  → Killing existing process on port $PORT (PID $PID)"
        kill -9 $PID 2>/dev/null || true
    fi
done
# Wait for ports to be fully released
sleep 2

# ── Backend ───────────────────────────────────────────────────────────────────
echo "  → Starting backend (FastAPI) on http://localhost:8000 ..."
cd "$DIR/backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "  → Starting frontend (Next.js) on http://localhost:3000 ..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo "   Done."
}
trap cleanup EXIT INT TERM

echo ""
echo "✅ ResearchOS is running!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

# Wait for either process to exit
wait

"""ResearchOS FastAPI application entry point."""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.config import settings
from app.routers import attachments, dependencies, events, github_proxy, goals, lab, lab_links, methods, notes, pcr, projects, purchases, settings as settings_router, sharing, tasks, users


class NoCacheMiddleware(BaseHTTPMiddleware):
    """Prevent browsers from caching API responses."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app = FastAPI(
    title="ResearchOS",
    description="Research project management with smart GANTT scheduling",
    version="0.2.0",
)

# No-cache middleware (must be added before CORS)
app.add_middleware(NoCacheMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(projects.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(dependencies.router, prefix="/api")
app.include_router(methods.router, prefix="/api")
app.include_router(github_proxy.router, prefix="/api")
app.include_router(purchases.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(pcr.router, prefix="/api")
app.include_router(goals.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(lab_links.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(lab.router, prefix="/api")
app.include_router(attachments.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(sharing.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "storage": "json-files"}

"""ResearchOS FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import dependencies, events, github_proxy, goals, methods, pcr, projects, purchases, settings as settings_router, tasks

app = FastAPI(
    title="ResearchOS",
    description="Research project management with smart GANTT scheduling",
    version="0.2.0",
)

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


@app.get("/api/health")
async def health():
    return {"status": "ok", "storage": "json-files"}

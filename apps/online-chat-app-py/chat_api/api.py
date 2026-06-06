from ninja import NinjaAPI, Schema

from auth_api.api import router as auth_router
from chat.api import router as chat_router

api = NinjaAPI(
    title="Online Chat API",
    version="0.1.0",
    description="REST API for the online chat application.",
)


class HealthOut(Schema):
    status: str
    version: str


@api.get("/health", response=HealthOut, tags=["meta"])
def health(request):
    return {"status": "ok", "version": api.version}


api.add_router("/auth", auth_router)
api.add_router("/chat", chat_router)

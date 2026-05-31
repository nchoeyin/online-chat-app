from django.shortcuts import get_object_or_404
from ninja import Router

from .models import Message, Room
from .schemas import ErrorOut, MessageIn, MessageOut, RoomIn, RoomOut

router = Router(tags=["chat"])


@router.get("/rooms", response=list[RoomOut])
def list_rooms(request):
    return Room.objects.all()


@router.post("/rooms", response={201: RoomOut, 400: ErrorOut})
def create_room(request, payload: RoomIn):
    if Room.objects.filter(slug=payload.slug).exists():
        return 400, {"detail": f"Room with slug '{payload.slug}' already exists."}
    room = Room.objects.create(**payload.dict())
    return 201, room


@router.get("/rooms/{room_id}", response={200: RoomOut, 404: ErrorOut})
def get_room(request, room_id: int):
    return get_object_or_404(Room, id=room_id)


@router.get("/rooms/{room_id}/messages", response=list[MessageOut])
def list_messages(request, room_id: int, limit: int = 50):
    room = get_object_or_404(Room, id=room_id)
    return room.messages.select_related("author")[:limit]


@router.post(
    "/rooms/{room_id}/messages",
    response={201: MessageOut, 401: ErrorOut, 404: ErrorOut},
)
def post_message(request, room_id: int, payload: MessageIn):
    if not request.user.is_authenticated:
        return 401, {"detail": "Authentication required."}
    room = get_object_or_404(Room, id=room_id)
    message = Message.objects.create(
        room=room,
        author=request.user,
        body=payload.body,
    )
    return 201, message

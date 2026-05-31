from datetime import datetime

from ninja import Schema


class RoomIn(Schema):
    name: str
    slug: str
    is_private: bool = False


class RoomOut(Schema):
    id: int
    name: str
    slug: str
    is_private: bool
    created_at: datetime


class MessageIn(Schema):
    body: str


class MessageOut(Schema):
    id: int
    room_id: int
    author_id: int
    body: str
    created_at: datetime


class ErrorOut(Schema):
    detail: str

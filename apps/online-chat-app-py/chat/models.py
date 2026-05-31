from django.conf import settings
from django.db import models


class Room(models.Model):
    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=140, unique=True)
    is_private = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="rooms",
        blank=True,
    )

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.name


class Message(models.Model):
    room = models.ForeignKey(
        Room,
        related_name="messages",
        on_delete=models.CASCADE,
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="messages",
        on_delete=models.CASCADE,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at",)
        indexes = [
            models.Index(fields=("room", "created_at")),
        ]

    def __str__(self) -> str:
        return f"{self.author} @ {self.room}: {self.body[:32]}"

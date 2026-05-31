from django.contrib import admin

from .models import Message, Room


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "slug", "is_private", "created_at")
    search_fields = ("name", "slug")
    list_filter = ("is_private",)
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "author", "created_at")
    list_filter = ("room",)
    search_fields = ("body",)
    autocomplete_fields = ("room", "author")

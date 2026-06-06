from ninja import Schema


class CheckIn(Schema):
    email: str


class CheckOut(Schema):
    exists: bool
    # Currently we only support password-based accounts. In the future this can
    # expand to include 'oauth', 'magic_link', etc.
    method: str = "password"


class SignupIn(Schema):
    email: str
    password: str
    name: str | None = None


class LoginIn(Schema):
    email: str
    password: str


class UserOut(Schema):
    id: int
    email: str
    name: str

    @staticmethod
    def from_user(user) -> "UserOut":
        full_name = (user.get_full_name() or user.username or "").strip()
        return UserOut(id=user.id, email=user.email, name=full_name)


class OkOut(Schema):
    ok: bool = True


class ErrorOut(Schema):
    detail: str


# --- OAuth ---


class OAuthStartOut(Schema):
    # Browser should be redirected to this URL.
    authorize_url: str


class OAuthCompleteIn(Schema):
    code: str
    state: str

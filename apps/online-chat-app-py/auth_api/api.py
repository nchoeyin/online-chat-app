"""Unified auth endpoints for the chat app.

Flow expected by the frontend:

    1. POST /api/auth/check   { email }              -> { exists, method }
    2a. If exists:
        POST /api/auth/login  { email, password }    -> 200 UserOut | 401
    2b. If not exists:
        POST /api/auth/signup { email, password, name? } -> 201 UserOut | 400

    GET  /api/auth/me                                -> 200 UserOut | 401
    POST /api/auth/logout                            -> 200 OkOut

Sessions are managed via Django's standard session middleware, so a successful
login/signup sets the `sessionid` cookie and subsequent requests are
authenticated automatically (provided the frontend sends `withCredentials`).
"""
import logging

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from ninja import Router

from .oauth import OAuthError, OAuthNotConfiguredError, get_provider, new_state

log = logging.getLogger(__name__)
from .schemas import (
    CheckIn,
    CheckOut,
    ErrorOut,
    LoginIn,
    OAuthCompleteIn,
    OAuthStartOut,
    OkOut,
    SignupIn,
    UserOut,
)

User = get_user_model()
router = Router(tags=["auth"])

# Session key under which we stash the OAuth state token between the
# /start and /complete calls. Namespaced by provider so flows for different
# providers can't collide.
_STATE_SESSION_KEY = "auth_api.oauth.state"


def _normalize_email(email: str) -> str | None:
    """Lower-case, strip, and validate the email; return None if invalid."""
    cleaned = (email or "").strip().lower()
    if not cleaned:
        return None
    try:
        validate_email(cleaned)
    except ValidationError:
        return None
    return cleaned


@router.post("/check", response={200: CheckOut, 400: ErrorOut})
def check_account(request, payload: CheckIn):
    """Step 1 of the unified flow: does an account exist for this email?"""
    email = _normalize_email(payload.email)
    if email is None:
        return 400, {"detail": "Please enter a valid email address."}
    exists = User.objects.filter(email__iexact=email).exists()
    return 200, {"exists": exists, "method": "password"}


@router.post("/signup", response={201: UserOut, 400: ErrorOut})
def signup(request, payload: SignupIn):
    email = _normalize_email(payload.email)
    if email is None:
        return 400, {"detail": "Please enter a valid email address."}
    if len(payload.password) < 6:
        return 400, {"detail": "Password must be at least 6 characters."}

    if User.objects.filter(email__iexact=email).exists():
        return 400, {"detail": "An account with this email already exists."}

    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=email,
                email=email,
                password=payload.password,
                first_name=(payload.name or "").strip(),
            )
    except IntegrityError:
        return 400, {"detail": "An account with this email already exists."}

    login(request, user)
    return 201, UserOut.from_user(user)


@router.post("/login", response={200: UserOut, 401: ErrorOut})
def login_view(request, payload: LoginIn):
    email = _normalize_email(payload.email)
    if email is None:
        return 401, {"detail": "Invalid email or password."}

    # `authenticate` checks the configured auth backends. The default backend
    # matches against `username`, which we set to the (lowercased) email at
    # signup, so we can pass the email through as the username.
    user = authenticate(request, username=email, password=payload.password)
    if user is None:
        return 401, {"detail": "Invalid email or password."}

    login(request, user)
    return 200, UserOut.from_user(user)


@router.post("/logout", response={200: OkOut})
def logout_view(request):
    logout(request)
    return 200, {"ok": True}


@router.get("/me", response={200: UserOut, 401: ErrorOut})
def me(request):
    if not request.user.is_authenticated:
        return 401, {"detail": "Not authenticated."}
    return 200, UserOut.from_user(request.user)


# --- OAuth (Authorization Code flow) ---


@router.post(
    "/oauth/{provider}/start",
    response={200: OAuthStartOut, 400: ErrorOut, 503: ErrorOut},
)
def oauth_start(request, provider: str):
    """Begin an OAuth flow. Returns the URL the browser should navigate to."""
    try:
        prov = get_provider(provider)
    except OAuthError as exc:
        return 400, {"detail": str(exc)}

    try:
        state = new_state()
        url = prov.build_authorize_url(state)
    except OAuthNotConfiguredError as exc:
        return 503, {"detail": str(exc)}

    # Save state in the session so we can verify it on the callback.
    request.session[_state_key(provider)] = state
    request.session.modified = True
    return 200, {"authorize_url": url}


@router.post(
    "/oauth/{provider}/complete",
    response={200: UserOut, 400: ErrorOut, 401: ErrorOut, 503: ErrorOut},
)
def oauth_complete(request, provider: str, payload: OAuthCompleteIn):
    """Finish an OAuth flow: exchange code → user info → find-or-create user → login."""
    try:
        prov = get_provider(provider)
    except OAuthError as exc:
        return 400, {"detail": str(exc)}

    stored_state = request.session.pop(_state_key(provider), None)
    request.session.modified = True

    if stored_state is None:
        # Most common cause in dev: the browser dropped the sessionid cookie
        # between /start and /complete because the frontend and backend are
        # on different "sites" under SameSite=Lax (e.g. localhost vs 127.0.0.1).
        had_cookie = request.COOKIES.get('sessionid') is not None
        log.warning(
            "oauth_complete: no stored state for provider=%s "
            "(sessionid cookie present? %s)",
            provider,
            had_cookie,
        )
        if not had_cookie:
            return 400, {
                "detail": (
                    "No session cookie was sent with this request. The "
                    "frontend and backend must be reached via the same "
                    "hostname (e.g. both http://localhost) — using "
                    "127.0.0.1 on one and localhost on the other will "
                    "make SameSite=Lax drop the session cookie."
                )
            }
        return 400, {
            "detail": (
                "OAuth state was not found in your session. The flow may "
                "have expired or already been completed. Please start "
                "sign-in again."
            )
        }
    if not _safe_str_eq(stored_state, payload.state):
        log.warning("oauth_complete: state mismatch for provider=%s", provider)
        return 400, {"detail": "OAuth state mismatch. Please start sign-in again."}

    try:
        token_response = prov.exchange_code(payload.code)
        access_token = token_response.get("access_token")
        if not access_token:
            log.warning(
                "oauth_complete: provider returned no access_token: keys=%s",
                list(token_response),
            )
            return 400, {"detail": "Provider did not return an access token."}
        info = prov.fetch_userinfo(access_token)
    except OAuthNotConfiguredError as exc:
        return 503, {"detail": str(exc)}
    except OAuthError as exc:
        log.warning("oauth_complete: provider error: %s", exc)
        return 400, {"detail": str(exc)}

    if not info.email:
        return 400, {"detail": "Provider did not return an email address."}
    if not info.email_verified:
        return 400, {
            "detail": (
                "The email associated with this account is not verified "
                "with the provider."
            )
        }

    user = _find_or_create_oauth_user(info.email, info.name)
    login(request, user)
    log.info("oauth_complete: signed in user_id=%s via %s", user.id, provider)
    return 200, UserOut.from_user(user)


def _state_key(provider: str) -> str:
    return f"{_STATE_SESSION_KEY}.{provider}"


def _safe_str_eq(a: str, b: str) -> bool:
    """Constant-time comparison; OAuth state isn't a secret but it's cheap."""
    from hmac import compare_digest

    return compare_digest(a.encode(), b.encode())


def _find_or_create_oauth_user(email: str, full_name: str):
    """Find a user by email or create a new one with an unusable password.

    Note: we deliberately trust the provider's verified email and link to any
    existing local account with the same address. This matches the behaviour
    of Slack, Vercel, Notion etc.
    """
    user = User.objects.filter(email__iexact=email).first()
    if user is not None:
        return user

    user = User.objects.create_user(
        username=email,
        email=email,
        first_name=full_name,
    )
    # No local password — user can only sign in via OAuth (until they reset).
    user.set_unusable_password()
    user.save(update_fields=["password"])
    return user

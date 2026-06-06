"""OAuth 2.0 (Authorization Code) helpers.

We use a small abstract base class so adding a new provider is mostly a matter
of subclassing and setting the four endpoint URLs / scopes. The Django Ninja
endpoints in `auth_api/api.py` then dispatch to the right subclass by name.

Security notes:

* The `state` parameter is generated server-side, stored in the user's Django
  session under a per-provider key, and checked on the callback. This protects
  against OAuth CSRF (an attacker tricking a logged-in user's browser into
  completing an OAuth flow against the attacker's account).
* The access token is exchanged server-side using the client_secret, so it
  never touches the browser.
* We trust the provider's `email_verified` flag (Google sets this) before
  matching against an existing local account. This is what every major site
  does (Slack, Vercel, GitHub, etc.).
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import ClassVar
from urllib.parse import urlencode

import httpx
from django.conf import settings


class OAuthError(Exception):
    """Raised for any recoverable error in the OAuth handshake."""


class OAuthNotConfiguredError(OAuthError):
    """The provider is missing client_id / client_secret in env."""


@dataclass(frozen=True)
class OAuthUserInfo:
    """Normalized user info returned by every provider."""

    provider: str
    sub: str  # provider's stable user id
    email: str
    email_verified: bool
    name: str


class OAuthProvider:
    """Base class for OAuth 2.0 authorization-code providers."""

    name: ClassVar[str] = ""
    authorize_url: ClassVar[str] = ""
    token_url: ClassVar[str] = ""
    userinfo_url: ClassVar[str] = ""
    scope: ClassVar[str] = ""
    extra_authorize_params: ClassVar[dict[str, str]] = {}

    @property
    def client_id(self) -> str:
        raise NotImplementedError

    @property
    def client_secret(self) -> str:
        raise NotImplementedError

    @property
    def redirect_uri(self) -> str:
        return settings.OAUTH_REDIRECT_URI

    def assert_configured(self) -> None:
        if not self.client_id or not self.client_secret:
            raise OAuthNotConfiguredError(
                f"OAuth provider '{self.name}' is not configured. "
                f"Set the relevant *_OAUTH_CLIENT_ID and *_OAUTH_CLIENT_SECRET "
                f"env vars (see .env.example)."
            )

    def build_authorize_url(self, state: str) -> str:
        self.assert_configured()
        params: dict[str, str] = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": self.scope,
            "state": state,
            **self.extra_authorize_params,
        }
        return f"{self.authorize_url}?{urlencode(params)}"

    def exchange_code(self, code: str) -> dict:
        """Trade an authorization code for an access token."""
        self.assert_configured()
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                self.token_url,
                data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": self.redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"Accept": "application/json"},
            )
        if resp.status_code != 200:
            raise OAuthError(
                f"Token exchange failed ({resp.status_code}): {resp.text[:200]}"
            )
        return resp.json()

    def fetch_userinfo(self, access_token: str) -> OAuthUserInfo:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                self.userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if resp.status_code != 200:
            raise OAuthError(
                f"Userinfo fetch failed ({resp.status_code}): {resp.text[:200]}"
            )
        return self.parse_userinfo(resp.json())

    def parse_userinfo(self, raw: dict) -> OAuthUserInfo:
        raise NotImplementedError


class GoogleOAuthProvider(OAuthProvider):
    """Google sign-in via OpenID Connect (the standard OAuth flavour for Google)."""

    name = "google"
    authorize_url = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url = "https://oauth2.googleapis.com/token"
    userinfo_url = "https://openidconnect.googleapis.com/v1/userinfo"
    scope = "openid email profile"
    extra_authorize_params = {
        # Force account chooser even if the user is already logged in to a
        # single Google account. Nicer UX for multi-account users.
        "prompt": "select_account",
        # Ensure refresh tokens aren't issued — we don't need long-lived
        # offline access just to authenticate.
        "access_type": "online",
    }

    @property
    def client_id(self) -> str:
        return settings.GOOGLE_OAUTH_CLIENT_ID

    @property
    def client_secret(self) -> str:
        return settings.GOOGLE_OAUTH_CLIENT_SECRET

    def parse_userinfo(self, raw: dict) -> OAuthUserInfo:
        return OAuthUserInfo(
            provider=self.name,
            sub=str(raw.get("sub", "")),
            email=str(raw.get("email", "")).lower(),
            email_verified=bool(raw.get("email_verified", False)),
            name=str(raw.get("name") or "").strip(),
        )


# Registry of supported providers, keyed by URL slug.
_PROVIDERS: dict[str, OAuthProvider] = {
    GoogleOAuthProvider.name: GoogleOAuthProvider(),
}


def get_provider(name: str) -> OAuthProvider:
    try:
        return _PROVIDERS[name]
    except KeyError:
        raise OAuthError(f"Unknown OAuth provider: {name!r}")


def new_state() -> str:
    """Random opaque token used for CSRF protection during the OAuth flow."""
    return secrets.token_urlsafe(32)

"""
Tick service auth — JWT + legacy bearer.

Mirrors the executor/agent auth.js pattern in Python. Same honest scope:
this is a JWT-validation skeleton that supports per-user isolation. For
real production swap to Clerk/Supabase token validation.

The tick service serves public market data, so per-user isolation is
mostly cosmetic here — but the endpoints are now JWT-aware so the same
token issued by the executor/agent works seamlessly.
"""
import os
import time
import secrets
import logging
from typing import Optional

from fastapi import HTTPException, Header

try:
    import jwt as pyjwt  # PyJWT
except ImportError:
    pyjwt = None

log = logging.getLogger("auth")


# Same JWT_SECRET as the other services — tokens are interchangeable.
RAW_SECRET = os.getenv("JWT_SECRET")
if not RAW_SECRET:
    if os.getenv("NODE_ENV") == "production" or os.getenv("ENV") == "production":
        log.error("FATAL: JWT_SECRET must be set in production")
        raise SystemExit(1)
    # Dev only — generate ephemeral secret. Tokens won't survive restart.
    RAW_SECRET = secrets.token_hex(32)

LEGACY_TOKEN = os.getenv("LEGACY_AUTH_TOKEN") or os.getenv("AUTH_TOKEN") or ""


def verify_token(token: str) -> Optional[dict]:
    """Returns {userId, name} on success, None on failure."""
    if pyjwt is None:
        return None
    try:
        payload = pyjwt.decode(token, RAW_SECRET, algorithms=["HS256"])
        return {"userId": payload.get("sub"), "name": payload.get("name")}
    except Exception:
        return None


def require_auth(authorization: Optional[str] = Header(None)):
    """FastAPI dependency. Validates Bearer JWT or legacy shared bearer.
    Returns dict {userId, name, authMethod}."""
    if not authorization:
        raise HTTPException(status_code=401, detail="missing authorization")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="malformed authorization")
    token = parts[1]
    # Try JWT first
    jwt_result = verify_token(token)
    if jwt_result and jwt_result.get("userId"):
        return {**jwt_result, "authMethod": "jwt"}
    # Fall back to legacy shared bearer
    if LEGACY_TOKEN and token == LEGACY_TOKEN:
        return {"userId": "default", "name": "default", "authMethod": "legacy"}
    raise HTTPException(status_code=403, detail="invalid token")

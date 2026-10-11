"""Shared data types and HTTP helpers."""

import json
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import List, Optional

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0 Safari/537.36"
)


@dataclass
class Media:
    kind: str  # "photo" or "video"
    url: str
    width: int = 0
    height: int = 0
    thumbnail: Optional[str] = None


@dataclass
class Post:
    """A social post, normalised so one embed renderer handles every site."""

    site: str  # "X" or "Instagram"
    url: str  # canonical link to the original post
    author_name: str
    author_handle: str
    text: str = ""
    avatar: Optional[str] = None
    media: List[Media] = field(default_factory=list)
    stats: str = ""  # e.g. "💬 12   ❤️ 340"
    color: str = "#000000"


class FetchError(Exception):
    pass


def http_get(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:  # network errors, 4xx/5xx
        raise FetchError(f"GET {url} failed: {e}") from e


def http_get_json(url, headers=None, timeout=10):
    body = http_get(url, headers, timeout)
    try:
        return json.loads(body)
    except ValueError as e:
        raise FetchError(f"GET {url} returned non-JSON") from e


def compact_number(n):
    if n is None:
        return None
    n = int(n)
    for div, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if n >= div:
            return f"{n / div:.1f}".rstrip("0").rstrip(".") + suffix
    return str(n)


class TTLCache:
    """Tiny thread-safe in-memory cache so repeat crawls don't refetch."""

    def __init__(self, ttl=600, max_items=2000):
        self.ttl = ttl
        self.max_items = max_items
        self._data = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > time.time():
                return hit[1]
            self._data.pop(key, None)
            return None

    def set(self, key, value):
        with self._lock:
            if len(self._data) >= self.max_items:
                self._data.clear()
            self._data[key] = (time.time() + self.ttl, value)

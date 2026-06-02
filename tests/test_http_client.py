"""Tests for the curl-shelling JSON fetch and its error classification."""
from __future__ import annotations

import subprocess
from unittest import mock

import pytest

from lib.http_client import HttpError, curl_json


def _completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    return subprocess.CompletedProcess(
        args=["curl"], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_curl_json_parses_body_and_strips_status_line():
    # curl appends "\n%{http_code}" -- the body is everything before the last
    # newline, even when the body itself contains newlines.
    out = '{"tag_name":\n"v1.2.3"}\n200'
    with mock.patch("subprocess.run", return_value=_completed(stdout=out)):
        assert curl_json("https://example/api") == {"tag_name": "v1.2.3"}


def test_curl_json_404_raises_httperror_with_status():
    out = '{"message":"Not Found"}\n404'
    with mock.patch("subprocess.run", return_value=_completed(stdout=out)):
        with pytest.raises(HttpError) as ei:
            curl_json("https://api.github.com/repos/x/releases/tags/developer")
    assert ei.value.status == 404
    assert "releases/tags/developer" in ei.value.url


def test_curl_json_transport_failure_surfaces_stderr():
    # The OPENSSL bundled-lib clash: curl exits non-zero with nothing on stdout.
    err = "curl: /tmp/_MEI/libssl.so.3: version `OPENSSL_3.2.0' not found"
    with mock.patch(
        "subprocess.run", return_value=_completed(stderr=err, returncode=127)
    ):
        with pytest.raises(RuntimeError) as ei:
            curl_json("https://api.github.com/x")
    assert "OPENSSL_3.2.0" in str(ei.value)
    assert not isinstance(ei.value, HttpError)


def test_curl_json_bad_json_on_200_raises_runtimeerror():
    out = "<html>nope</html>\n200"
    with mock.patch("subprocess.run", return_value=_completed(stdout=out)):
        with pytest.raises(RuntimeError) as ei:
            curl_json("https://example/api")
    assert "Invalid JSON" in str(ei.value)

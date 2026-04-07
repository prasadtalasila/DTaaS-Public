"""Unit tests for the admin service."""

import json
import sys

import pytest
from fastapi.testclient import TestClient

from admin.__version__ import __version__
from admin.main import (
    SERVICES_TEMPLATE_PATH,
    cli,
    create_app,
    load_services,
    load_services_template,
)


@pytest.fixture(autouse=True)
def fixture_clear_services_template_cache():
    """Clear template cache between tests for deterministic monkeypatch behavior."""
    load_services_template.cache_clear()
    yield
    load_services_template.cache_clear()


@pytest.fixture(name="test_client")
def fixture_test_client():
    """Create a test client for the default app."""
    return TestClient(create_app())


@pytest.fixture(name="test_client_with_prefix")
def fixture_test_client_with_prefix():
    """Create a test client for the app with user prefix."""
    return TestClient(create_app(path_prefix="user1"))


def test_root_endpoint(test_client):
    """Root endpoint returns service metadata."""
    response = test_client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Workspace Admin Service"
    assert data["version"] == __version__
    assert "/services" in data["endpoints"]
    assert "/health" in data["endpoints"]


def test_root_endpoint_with_prefix(test_client_with_prefix):
    """Root endpoint reflects prefixed route metadata."""
    response = test_client_with_prefix.get("/user1/")
    assert response.status_code == 200
    endpoints = response.json()["endpoints"]
    assert "/user1/services" in endpoints
    assert "/user1/health" in endpoints


def test_health_endpoint_healthy(test_client):
    """Health endpoint reports healthy when template is available."""
    response = test_client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "healthy"
    assert payload["checks"]["services_template"] == "ok"


def test_health_endpoint_unhealthy_when_template_missing(tmp_path, monkeypatch):
    """Health endpoint reports unhealthy when template file is missing."""
    missing_path = tmp_path / "missing-services.json"
    monkeypatch.setattr("admin.main.SERVICES_TEMPLATE_PATH", missing_path)
    response = TestClient(create_app()).get("/health")
    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "unhealthy"
    assert "not found" in payload["checks"]["services_template"]


def test_services_endpoint_json_structure(test_client):
    """Services endpoint returns expected JSON shape."""
    response = test_client.get("/services")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"

    services = response.json()
    assert isinstance(services, dict)
    for service_key, service_info in services.items():
        assert isinstance(service_key, str)
        assert isinstance(service_info, dict)
        assert "name" in service_info
        assert "description" in service_info
        assert "endpoint" in service_info


def test_services_endpoint_with_prefix_uses_app_prefix(test_client_with_prefix, monkeypatch):
    """Service payload prefix comes from create_app prefix, not PATH_PREFIX env."""
    monkeypatch.setenv("PATH_PREFIX", "wrong-prefix")
    response = test_client_with_prefix.get("/user1/services")
    assert response.status_code == 200
    desktop_endpoint = response.json()["desktop"]["endpoint"]
    assert "user1%2Ftools%2Fvnc%2Fwebsockify" in desktop_endpoint
    assert "{PATH_PREFIX}" not in desktop_endpoint


def test_path_prefix_not_accessible_without_prefix(test_client_with_prefix):
    """Prefixed app should not expose non-prefixed routes."""
    response = test_client_with_prefix.get("/services")
    assert response.status_code == 404


def test_load_services_preserves_structure():
    """load_services returns all expected service fields."""
    services = load_services()
    for service in ("desktop", "vscode", "notebook", "lab"):
        assert service in services
        assert "name" in services[service]
        assert "description" in services[service]
        assert "endpoint" in services[service]


def test_load_services_missing_template(tmp_path, monkeypatch):
    """load_services raises when template file is missing."""
    monkeypatch.setattr("admin.main.SERVICES_TEMPLATE_PATH", tmp_path / "missing.json")
    with pytest.raises(FileNotFoundError):
        load_services("")


def test_load_services_invalid_json(tmp_path, monkeypatch):
    """load_services raises ValueError when template is invalid JSON."""
    invalid_json = tmp_path / "invalid.json"
    invalid_json.write_text("{ invalid json }", encoding="utf-8")
    monkeypatch.setattr("admin.main.SERVICES_TEMPLATE_PATH", invalid_json)
    with pytest.raises(ValueError, match="invalid JSON"):
        load_services("")


def test_create_app_with_various_prefixes():
    """Prefix normalization supports trimmed slash forms."""
    assert TestClient(create_app("/user1/")).get("/user1/health").status_code == 200
    assert TestClient(create_app("user1")).get("/user1/health").status_code == 200
    assert TestClient(create_app("")).get("/health").status_code == 200
    assert TestClient(create_app("/")).get("/health").status_code == 200


def test_create_app_rejects_invalid_prefix():
    """Invalid prefixes are rejected."""
    with pytest.raises(ValueError):
        create_app("../../etc/passwd")
    with pytest.raises(ValueError):
        create_app("user@domain")


def test_services_template_file_exists():
    """Services template file exists."""
    assert SERVICES_TEMPLATE_PATH.exists()
    assert SERVICES_TEMPLATE_PATH.is_file()


def test_services_template_valid_json():
    """Services template is valid JSON."""
    with SERVICES_TEMPLATE_PATH.open("r", encoding="utf-8") as template_file:
        services = json.load(template_file)
    assert isinstance(services, dict)
    assert len(services) > 0


def test_cli_list_services(monkeypatch, capsys):
    """CLI --list-services prints services and exits successfully."""
    monkeypatch.setattr(sys, "argv", ["workspace-admin", "--list-services"])
    with pytest.raises(SystemExit) as exc_info:
        cli()
    assert exc_info.value.code == 0
    output = json.loads(capsys.readouterr().out)
    assert "desktop" in output
    assert "vscode" in output


def test_cli_version(monkeypatch):
    """CLI --version exits successfully."""
    monkeypatch.setattr(sys, "argv", ["workspace-admin", "--version"])
    with pytest.raises(SystemExit) as exc_info:
        cli()
    assert exc_info.value.code == 0

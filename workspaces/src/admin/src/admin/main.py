"""FastAPI application for workspace service discovery."""

import argparse
import json
import logging
import os
import re
import sys
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Tuple

import uvicorn
from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse

from admin.__version__ import __version__

APP_NAME = "Workspace Admin Service"
SERVICES_TEMPLATE_PATH = Path(__file__).parent / "services_template.json"
PATH_PREFIX_PATTERN = re.compile(r"^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$")
LOGGER = logging.getLogger(__name__)


def setup_logging(log_level: str = "INFO") -> None:
    """Configure logging for CLI execution."""
    resolved_level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=resolved_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout
    )


def normalize_path_prefix(path_prefix: str) -> str:
    """
    Validate and normalize a path prefix.

    Returns:
        Prefix without leading/trailing slash.
    """
    cleaned_prefix = path_prefix.strip("/")
    if not cleaned_prefix:
        return ""
    if len(cleaned_prefix) > 100:
        raise ValueError("Path prefix must be 100 characters or fewer.")
    if not PATH_PREFIX_PATTERN.fullmatch(cleaned_prefix):
        raise ValueError(
            "Path prefix may contain only letters, numbers, '-', '_' and '/'."
        )
    return cleaned_prefix


def to_route_prefix(path_prefix: str) -> str:
    """Convert normalized prefix to FastAPI router prefix."""
    return f"/{path_prefix}" if path_prefix else ""


def _validate_services_template(services_template: Any) -> None:
    """Validate services template structure."""
    if not isinstance(services_template, dict):
        raise ValueError("Services template root must be a JSON object.")
    for service_name, service_info in services_template.items():
        if not isinstance(service_info, dict):
            raise ValueError(f"Service '{service_name}' must be a JSON object.")
        endpoint = service_info.get("endpoint")
        if endpoint is not None and not isinstance(endpoint, str):
            raise ValueError(f"Service '{service_name}' endpoint must be a string.")


@lru_cache(maxsize=1)
def load_services_template() -> Dict[str, Any]:
    """
    Load and validate services template from disk.

    Raises:
        FileNotFoundError: When template file is missing.
        ValueError: When template content is invalid.
        OSError: When file cannot be read.
    """
    try:
        with SERVICES_TEMPLATE_PATH.open("r", encoding="utf-8") as template_file:
            services_template = json.load(template_file)
    except FileNotFoundError as exc:
        message = f"Services template not found: {SERVICES_TEMPLATE_PATH}"
        LOGGER.error(message)
        raise FileNotFoundError(message) from exc
    except json.JSONDecodeError as exc:
        message = f"Services template contains invalid JSON: {exc.msg}"
        LOGGER.error(message)
        raise ValueError(message) from exc
    except OSError as exc:
        message = f"Unable to read services template: {exc}"
        LOGGER.error(message)
        raise OSError(message) from exc

    _validate_services_template(services_template)
    return services_template


def load_services(path_prefix: str = "") -> Dict[str, Any]:
    """
    Load services and substitute path prefix placeholders.

    Args:
        path_prefix: Optional path prefix (without leading slash).
    """
    normalized_prefix = normalize_path_prefix(path_prefix)
    services = deepcopy(load_services_template())
    for service_info in services.values():
        endpoint = service_info.get("endpoint")
        if isinstance(endpoint, str):
            service_info["endpoint"] = endpoint.replace("{PATH_PREFIX}", normalized_prefix)
    return services


def _build_endpoint_map(route_prefix: str) -> Dict[str, str]:
    """Build endpoint documentation payload for root route."""
    services_path = f"{route_prefix}/services" if route_prefix else "/services"
    health_path = f"{route_prefix}/health" if route_prefix else "/health"
    return {
        services_path: "Get list of available workspace services",
        health_path: "Health check endpoint"
    }


def _build_health_payload() -> Tuple[int, Dict[str, Any]]:
    """Build health response with services template validation result."""
    try:
        load_services_template()
    except (FileNotFoundError, ValueError, OSError) as exc:
        return 503, {"status": "unhealthy", "checks": {"services_template": str(exc)}}
    return 200, {"status": "healthy", "checks": {"services_template": "ok"}}


def create_app(path_prefix: str = "") -> FastAPI:
    """
    Create and configure the FastAPI application.

    Args:
        path_prefix: Optional path prefix for all routes (e.g., "dtaas-user").
    """
    normalized_prefix = normalize_path_prefix(path_prefix)
    router_prefix = to_route_prefix(normalized_prefix)
    fastapi_app = FastAPI(
        title=APP_NAME,
        description="Service discovery and management for DTaaS workspace",
        version=__version__
    )
    router = APIRouter()
    endpoint_map = _build_endpoint_map(router_prefix)

    @router.get("/")
    async def root() -> Dict[str, Any]:
        """Root endpoint providing service information."""
        return {"service": APP_NAME, "version": __version__, "endpoints": endpoint_map}

    @router.get("/services")
    async def get_services() -> JSONResponse:
        """Get list of available workspace services."""
        services = load_services(normalized_prefix)
        return JSONResponse(content=services)

    @router.get("/health")
    async def health_check() -> JSONResponse:
        """Health check endpoint with template validation."""
        status_code, payload = _build_health_payload()
        return JSONResponse(content=payload, status_code=status_code)

    fastapi_app.include_router(router, prefix=router_prefix)
    return fastapi_app


def _build_parser() -> argparse.ArgumentParser:
    """Create CLI argument parser."""
    parser = argparse.ArgumentParser(
        description=f"{APP_NAME} - Service discovery for DTaaS workspaces"
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind the service to")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("ADMIN_SERVER_PORT", "8091")),
        help="Port to bind the service to (default: $ADMIN_SERVER_PORT or 8091)"
    )
    parser.add_argument(
        "--path-prefix",
        default=os.getenv("PATH_PREFIX", ""),
        help=(
            "Path prefix for API routes. Defaults to no prefix (routes at /services) "
            "unless PATH_PREFIX is set."
        )
    )
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    parser.add_argument(
        "--list-services",
        action="store_true",
        help="List available services and exit"
    )
    parser.add_argument(
        "--log-level",
        default=os.getenv("LOG_LEVEL", "INFO"),
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level (default: LOG_LEVEL or INFO)"
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser


def _log_endpoints(host: str, port: int, route_prefix: str) -> None:
    """Log resolved service endpoint URLs."""
    LOGGER.info("Service endpoints:")
    LOGGER.info("  - http://%s:%s%s/services", host, port, route_prefix)
    LOGGER.info("  - http://%s:%s%s/health", host, port, route_prefix)
    LOGGER.info("  - http://%s:%s%s/", host, port, route_prefix)


def cli() -> None:
    """Command-line interface for the workspace admin service."""
    args = _build_parser().parse_args()
    setup_logging(args.log_level)

    try:
        normalized_prefix = normalize_path_prefix(args.path_prefix)
    except ValueError as exc:
        LOGGER.error("Invalid --path-prefix: %s", exc)
        sys.exit(2)

    if args.list_services:
        print(json.dumps(load_services(normalized_prefix), indent=2))
        sys.exit(0)

    route_prefix = to_route_prefix(normalized_prefix)
    LOGGER.info("Starting %s on %s:%s", APP_NAME, args.host, args.port)
    _log_endpoints(args.host, args.port, route_prefix)

    global app  # pylint: disable=global-statement
    app = create_app(normalized_prefix)
    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)


app = create_app()


if __name__ == "__main__":
    cli()

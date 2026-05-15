"""Configure Kubernetes resources for DTaaS from a .env file.

Reads a .env file and applies the values to Kubernetes
ConfigMaps and Secrets in the dtaas-workspace namespace.

Usage:
    python config.py [--env-file PATH] [--dry-run]
"""

import subprocess
import sys
from pathlib import Path

import click

NAMESPACE = "dtaas-workspace"
SCRIPT_DIR = Path(__file__).parent
DEFAULT_ENV = SCRIPT_DIR.parent / ".env"


def load_env(env_file: Path) -> dict[str, str]:
    """Load key=value pairs from a .env file, skipping comments.

    Args:
        env_file: Path to the .env file.

    Returns:
        Dictionary of variable names to their values.
    """
    if not env_file.exists():
        click.echo(f"Error: .env file not found: {env_file}", err=True)
        sys.exit(1)
    env: dict[str, str] = {}
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def kubectl(*args: str, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    """Run kubectl with the given arguments.

    Args:
        args: kubectl subcommand arguments.
        stdin: Optional bytes to pass to stdin.

    Returns:
        The completed process result.
    """
    return subprocess.run(
        ["kubectl", *args],
        input=stdin,
        capture_output=True,
        check=False,
    )


def apply_yaml(yaml_bytes: bytes, dry_run: bool, label: str) -> None:
    """Apply YAML bytes via kubectl apply or print for dry-run.

    Args:
        yaml_bytes: Raw YAML content to apply.
        dry_run: If True, print the YAML instead of applying.
        label: Human-readable label for progress messages.
    """
    if dry_run:
        click.echo(f"[dry-run] Would apply {label}:\n{yaml_bytes.decode()}")
        return
    result = kubectl("apply", "-f", "-", stdin=yaml_bytes)
    if result.returncode != 0:
        click.echo(f"Error applying {label}:\n{result.stderr.decode()}", err=True)
        sys.exit(result.returncode)
    click.echo(f"Applied {label}.")


def secret_yaml(name: str, literals: dict[str, str]) -> bytes:
    """Generate YAML for a Kubernetes secret using kubectl dry-run.

    Args:
        name: Secret name.
        literals: Key/value pairs to store in the secret.

    Returns:
        YAML bytes for the secret resource.
    """
    args = [
        "create", "secret", "generic", name,
        "-n", NAMESPACE,
        "--dry-run=client", "-o", "yaml",
    ]
    for k, v in literals.items():
        args += [f"--from-literal={k}={v}"]
    result = kubectl(*args)
    if result.returncode != 0:
        click.echo(f"Error generating secret {name}:\n{result.stderr.decode()}", err=True)
        sys.exit(result.returncode)
    return result.stdout


def patch_configmap(env: dict[str, str], dry_run: bool) -> None:
    """Update dtaas-config ConfigMap with values from env.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    keys = ["SERVER_DNS", "USERNAME1", "USERNAME2", "ACME_EMAIL"]
    pairs = {k: env[k] for k in keys if k in env}
    items = ", ".join(f'"{k}": "{v}"' for k, v in pairs.items())
    patch = f'{{"data": {{{items}}}}}'
    if dry_run:
        click.echo(f"[dry-run] kubectl patch configmap dtaas-config --patch='{patch}'")
        return
    result = kubectl(
        "patch", "configmap", "dtaas-config",
        "-n", NAMESPACE, "--type=merge", f"--patch={patch}",
    )
    if result.returncode != 0:
        click.echo(f"Error patching configmap:\n{result.stderr.decode()}", err=True)
        sys.exit(result.returncode)
    click.echo("Patched ConfigMap dtaas-config.")


def apply_keycloak_secret(env: dict[str, str], dry_run: bool) -> None:
    """Create or update the dtaas-keycloak secret.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    required = ["KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD"]
    if any(k not in env for k in required):
        click.echo(f"Skipping keycloak secret: {required} not all set.")
        return
    yaml_bytes = secret_yaml("dtaas-keycloak", {
        "KEYCLOAK_ADMIN": env["KEYCLOAK_ADMIN"],
        "KEYCLOAK_ADMIN_PASSWORD": env["KEYCLOAK_ADMIN_PASSWORD"],
    })
    apply_yaml(yaml_bytes, dry_run, "secret dtaas-keycloak")


def apply_forward_auth_secret(env: dict[str, str], dry_run: bool) -> None:
    """Create or update the dtaas-forward-auth secret.

    Args:
        env: Dictionary of environment variables.
        dry_run: If True, print commands without executing them.
    """
    required = [
        "OAUTH_SECRET", "KEYCLOAK_CLIENT_ID",
        "KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_ISSUER_URL",
    ]
    if any(k not in env for k in required):
        click.echo(f"Skipping forward-auth secret: {required} not all set.")
        return
    yaml_bytes = secret_yaml("dtaas-forward-auth", {
        "SECRET": env["OAUTH_SECRET"],
        "PROVIDERS_OIDC_CLIENT_ID": env["KEYCLOAK_CLIENT_ID"],
        "PROVIDERS_OIDC_CLIENT_SECRET": env["KEYCLOAK_CLIENT_SECRET"],
        "PROVIDERS_OIDC_ISSUER_URL": env["KEYCLOAK_ISSUER_URL"],
    })
    apply_yaml(yaml_bytes, dry_run, "secret dtaas-forward-auth")


@click.command()
@click.option(
    "--env-file",
    default=str(DEFAULT_ENV),
    show_default=True,
    help="Path to the .env file.",
    type=click.Path(exists=False),
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print kubectl commands without executing them.",
)
def main(env_file: str, dry_run: bool) -> None:
    """Apply DTaaS Kubernetes configuration from a .env file."""
    env = load_env(Path(env_file))
    patch_configmap(env, dry_run)
    apply_keycloak_secret(env, dry_run)
    apply_forward_auth_secret(env, dry_run)
    click.echo("Configuration applied successfully.")


if __name__ == "__main__":
    main()

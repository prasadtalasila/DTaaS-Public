"""Network diagnostics helpers for DTaaS Kubernetes deployment."""

import socket

import click


def resolve_dns(hostname: str) -> str:
    """Resolve a hostname to an IPv4 address, or return empty string.

    Args:
        hostname: The fully qualified domain name to resolve.

    Returns:
        Resolved IPv4 address string, or empty string on failure.
    """
    try:
        return socket.gethostbyname(hostname)
    except socket.gaierror:
        return ""


def show_dns_fix_instructions(dns: str, lb_ip: str) -> None:
    """Print instructions for configuring a DNS A record.

    Args:
        dns: The domain name that needs an A record.
        lb_ip: The target IP address for the A record.
    """
    click.echo("\n── How to fix DNS ──────────────────────────────────────")
    click.echo("  Add an A record at your DNS provider / registrar:")
    click.echo("    Type : A")
    click.echo(f"    Name : {dns}")
    click.echo(f"    Value: {lb_ip}")
    click.echo("    TTL  : 300  (5 minutes recommended)")
    click.echo("\n  After updating DNS, verify propagation with:")
    click.echo(f"    nslookup {dns}")
    click.echo(f"    dig +short {dns}")
    click.echo("\n  Then re-run (from the scripts/ directory):")
    click.echo("    python -m cli.config network show")
    click.echo("    python -m cli.config apply")
    click.echo("────────────────────────────────────────────────────────")

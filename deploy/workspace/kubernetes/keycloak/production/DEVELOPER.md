# Developer Guide

This guide covers development setup, testing, and contribution workflows
for the Kubernetes Keycloak production deployment CLI.

## Development Setup

### Prerequisites

* Python 3.10 or higher
* `kubectl` configured to point at the target cluster
* `pip` package manager
* Git

### Setup

```bash
cd DTaaS/deploy/workspace/kubernetes/keycloak/production/cli
pip install -r requirements-dev.txt
```

## Project Structure

```text
cli/
├── requirements.txt           # Runtime dependencies (click)
├── requirements-dev.txt       # Dev dependencies (pytest, pylint, pyright, ruff)
├── conftest.py                # Pytest configuration (adds parent to sys.path)
├── pytest.ini                 # Pytest settings (testpaths = tests)
├── pyrightconfig.json         # Pyright extra paths for editor/CI
├── __init__.py
├── config.py                  # CLI entry point: install / apply / network / files
├── files_ops.py               # PVC seed / dump / fix-permissions helpers
├── ingress_ops.py             # IngressRoute Host() patching
├── k8s_ops.py                 # kubectl wrappers (apply, secrets, ConfigMaps, LB IP)
├── net_ops.py                 # DNS diagnostics and fix instructions
└── tests/
    ├── __init__.py
    ├── conftest.py            # Shared make_proc() fixture + constants() loader
    ├── constants.json         # Sample IPs / hostnames used by tests
    ├── test_config.py
    ├── test_files_ops.py
    ├── test_ingress_ops.py
    ├── test_k8s_ops.py
    └── test_net_ops.py
```

## Development Workflow

### Running the CLI

All commands are run from the `cli/` directory:

```bash
# One-shot install (namespace + CRDs + manifests + patches)
python -m cli.config install --dry-run --env-file ../.env
python -m cli.config install --env-file ../.env

# Re-apply per-environment patches only
python -m cli.config apply --env-file ../.env

# Check DNS and LoadBalancer IP alignment
python -m cli.config network show --env-file ../.env

# Seed all PVCs from ../files
python -m cli.config files seed-all --files-dir ../files

# Dump all PVCs back to ../files
python -m cli.config files dump-all --dest-dir ../files
```

### Running Tests

```bash
cd cli/
pytest
```

With coverage:

```bash
pytest --cov=. --cov-report=term-missing
```

### Linting

```bash
cd cli/
ruff format .
ruff check .
pylint . tests/ --rcfile=../../../../../.pylintrc --fail-under=9.0
```

### Type Checking

```bash
cd cli/
pyright .
```

## Contributing

1. Make changes under `cli/`.
2. Add or update tests in `cli/tests/`.
3. Ensure all tests pass: `pytest`
4. Ensure ruff is clean: `ruff format . && ruff check .`
5. Ensure pylint score ≥ 9.0: `pylint . tests/`
6. Ensure pyright reports zero errors: `pyright .`
7. Commit and open a pull request.

## Sample test data

`cli/tests/constants.json` centralises the IP addresses, hostnames, and
other placeholder values that the tests reference. Add a key there
rather than introducing a new inline literal — this keeps SonarQube
quiet about hardcoded IPs and makes it easy to spot a value used in
multiple tests.

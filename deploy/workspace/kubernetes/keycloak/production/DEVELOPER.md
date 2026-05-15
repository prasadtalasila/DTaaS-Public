# Developer Guide

This guide covers development setup, testing, and contribution workflows
for the Kubernetes Keycloak production deployment scripts.

## Development Setup

### Prerequisites

* Python 3.10 or higher
* `kubectl` configured to point at the target cluster
* `pip` package manager
* Git

### Setup

```bash
cd DTaaS/deploy/workspace/kubernetes/keycloak/production/scripts
pip install -r requirements-dev.txt
```

## Project Structure

```text
scripts/
├── requirements.txt           # Runtime dependencies (click)
├── requirements-dev.txt       # Dev dependencies (pytest, pylint, pyright)
├── conftest.py                # Pytest configuration (adds src/ to sys.path)
├── pytest.ini                 # Pytest settings (testpaths = src/tests)
└── src/
    ├── __init__.py
    ├── config.py              # CLI entry point: apply / network show
    ├── ingress_ops.py         # IngressRoute Host() patching
    ├── k8s_ops.py             # kubectl wrappers (apply, secrets, ConfigMaps, LB IP)
    ├── net_ops.py             # DNS diagnostics and fix instructions
    └── tests/
        ├── __init__.py
        ├── conftest.py        # Shared make_proc() fixture
        ├── test_config.py
        ├── test_ingress_ops.py
        ├── test_k8s_ops.py
        └── test_net_ops.py
```

## Development Workflow

### Running the CLI

All commands are run from the `scripts/` directory:

```bash
# Apply configuration to the cluster (dry-run first)
python -m src.config apply --dry-run --env-file ../.env
python -m src.config apply --env-file ../.env

# Check DNS and LoadBalancer IP alignment
python -m src.config network show --env-file ../.env
```

### Running Tests

```bash
cd scripts/
pytest
```

To run with coverage:

```bash
pytest --cov=src --cov-report=term-missing
```

### Linting

```bash
cd scripts/
pylint src/ src/tests/ --rcfile=../../../../.pylintrc --fail-under=9.0
```

### Type Checking

```bash
cd scripts/
pyright src/
```

## Contributing

1. Make changes under `scripts/src/`.
2. Add or update tests in `scripts/src/tests/`.
3. Ensure all tests pass: `pytest`
4. Ensure pylint score ≥ 9.0: `pylint src/ src/tests/`
5. Commit and open a pull request.

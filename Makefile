.PHONY: help install install-dev test test-cov lint format type-check clean build upload example test-models

help:  ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install:  ## Install the package
	pip install -e .

install-dev:  ## Install development dependencies
	pip install -e .
	pip install -r requirements-dev.txt

test:  ## Run tests
	pytest

test-cov:  ## Run tests with coverage
	pytest --cov=model_multiplexer --cov-report=html --cov-report=term

lint:  ## Run linting
	flake8 model_multiplexer tests examples

format:  ## Format code
	black model_multiplexer tests examples
	isort model_multiplexer tests examples

type-check:  ## Run type checking
	mypy model_multiplexer

clean:  ## Clean build artifacts
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	rm -rf .pytest_cache/
	rm -rf htmlcov/
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

build:  ## Build the package
	python -m build

upload:  ## Upload to PyPI (requires credentials)
	python -m twine upload dist/*

example:  ## Run the basic usage example
	python examples/basic_usage.py

test-models:  ## Test individual models (requires API keys)
	python examples/test_models.py

check: lint type-check test  ## Run all checks (lint, type-check, test)

dev-setup: install-dev  ## Set up development environment
	@echo "Development environment set up successfully!"
	@echo "Run 'make help' to see available commands."

#!/usr/bin/env python3
"""Setup script for model-multiplexer package."""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = [line.strip() for line in fh if line.strip() and not line.startswith("#")]

setup(
    name="model-multiplexer",
    version="0.4.0",
    author="Upstash",
    author_email="support@upstash.com",
    description="A multiplexer for Large Language Model APIs built on the OpenAI SDK. It combines quotas from multiple models and automatically uses fallback models when the primary models are rate limited.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/upstash/model-multiplexer",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
    python_requires=">=3.8",
    install_requires=requirements,
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-asyncio>=0.21.0",
            "pytest-mock>=3.10.0",
            "black>=23.0.0",
            "isort>=5.12.0",
            "mypy>=1.0.0",
            "flake8>=6.0.0",
        ],
    },
    keywords=[
        "openai",
        "multiplexer",
        "llm",
        "rate-limit",
        "api",
        "upstash",
        "ai",
        "machine-learning",
        "chatgpt",
        "claude",
        "gemini",
    ],
    project_urls={
        "Bug Reports": "https://github.com/upstash/model-multiplexer/issues",
        "Source": "https://github.com/upstash/model-multiplexer",
        "Documentation": "https://github.com/upstash/model-multiplexer#readme",
    },
)

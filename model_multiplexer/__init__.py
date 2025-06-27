"""
Model Multiplexer - A multiplexer for Large Language Model APIs.

This package provides a multiplexer that combines quotas from multiple LLM providers
and automatically uses fallback models when primary models are rate limited.

Key Features:
- Combines quotas from multiple LLM providers (OpenAI, Claude, Gemini, etc.)
- Automatic failover when models hit rate limits (429/529 errors)
- Weight-based load balancing between models
- Primary and fallback model tiers
- Usage statistics tracking
- OpenAI SDK-compatible interface
"""

from .multiplexer import Multiplexer
from .test_helper import MultiplexerTest
from .types import (
    CompletionOptions,
    CompletionResult,
    ModelStats,
    OpenAICompatibleClient,
    WeightedModel,
)

__version__ = "0.4.0"
__author__ = "Upstash"
__email__ = "support@upstash.com"

# Re-export the main class
__all__ = [
    "Multiplexer",
    "MultiplexerTest",
    "WeightedModel",
    "OpenAICompatibleClient",
    "ModelStats",
    "CompletionOptions",
    "CompletionResult",
]

# Export the main class as the default export for convenience
default = Multiplexer

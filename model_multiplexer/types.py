"""Type definitions for the model multiplexer package."""

import sys
from typing import Any, Dict, Optional, Protocol, Union

if sys.version_info >= (3, 10):
    from typing import TypeAlias
else:
    from typing_extensions import TypeAlias

# Import OpenAI types
try:
    from openai import AsyncOpenAI, OpenAI
    from openai.types.chat import ChatCompletion, ChatCompletionChunk, CompletionCreateParams
except ImportError:
    raise ImportError(
        "OpenAI package is required. Install it with: pip install openai>=1.0.0"
    )


class OpenAICompatibleClient(Protocol):
    """Protocol for OpenAI-compatible clients."""
    
    @property
    def chat(self) -> "ChatCompletionsProtocol":
        """Chat completions interface."""
        ...


class ChatCompletionsProtocol(Protocol):
    """Protocol for chat completions interface."""
    
    @property
    def completions(self) -> "CompletionsProtocol":
        """Completions interface."""
        ...


class CompletionsProtocol(Protocol):
    """Protocol for completions interface."""
    
    async def create(
        self,
        *,
        messages: Any,
        model: str,
        **kwargs: Any,
    ) -> Union[ChatCompletion, Any]:
        """Create a chat completion."""
        ...


class WeightedModel:
    """Represents a weighted model with statistics and state."""
    
    def __init__(
        self,
        model: OpenAICompatibleClient,
        weight: int,
        model_name: str,
    ) -> None:
        self.model = model
        self.weight = weight
        self.model_name = model_name
        # Timestamp until which the model is disabled due to rate limiting
        self.disabled_until: Optional[float] = None
        # Statistics
        self.success_count = 0
        self.rate_limit_count = 0
        self.fail_fast_count = 0


# Type aliases
ModelStats: TypeAlias = Dict[str, Dict[str, int]]
"""Type alias for model statistics dictionary."""

CompletionOptions: TypeAlias = Dict[str, Any]
"""Type alias for completion options."""

CompletionResult: TypeAlias = Union[ChatCompletion, ChatCompletionChunk, Any]
"""Type alias for completion results."""

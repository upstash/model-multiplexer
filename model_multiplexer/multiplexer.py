"""Main Multiplexer class for load balancing across multiple LLM providers."""

import asyncio
import logging
import random
import time
from typing import Any, Dict, List, Optional, Union

from .types import (
    CompletionOptions,
    CompletionResult,
    ModelStats,
    OpenAICompatibleClient,
    WeightedModel,
)

# Set up logging
logger = logging.getLogger(__name__)


class ChatCompletions:
    """Chat completions interface for the multiplexer."""
    
    def __init__(self, multiplexer: "Multiplexer") -> None:
        self._multiplexer = multiplexer
    
    async def create(
        self,
        *,
        messages: Any,
        model: str = "placeholder",
        **kwargs: Any,
    ) -> CompletionResult:
        """Create a chat completion using the multiplexer."""
        return await self._multiplexer._create_completion(
            messages=messages,
            model=model,
            **kwargs,
        )


class Chat:
    """Chat interface for the multiplexer."""
    
    def __init__(self, multiplexer: "Multiplexer") -> None:
        self.completions = ChatCompletions(multiplexer)


class Multiplexer:
    """
    A multiplexer for Large Language Model APIs that combines quotas from multiple
    models and automatically uses fallback models when primary models are rate limited.
    """
    
    def __init__(self) -> None:
        self._weighted_models: List[WeightedModel] = []
        self._fallback_models: List[WeightedModel] = []
        self._model_timeouts: Dict[str, asyncio.Task[None]] = {}
        self.chat = Chat(self)
    
    def _select_weighted_model(self) -> WeightedModel:
        """Selects an active weighted model entry based on weight."""
        now = time.time()
        
        # Filter for active models
        active_models = [
            wm for wm in self._weighted_models
            if wm.disabled_until is None or wm.disabled_until < now
        ]
        
        if not active_models:
            # Check fallback models if all regular models are disabled
            active_fallbacks = [
                wm for wm in self._fallback_models
                if wm.disabled_until is None or wm.disabled_until < now
            ]
            
            if active_fallbacks:
                # Use the same weighted selection for fallbacks
                total_fallback_weight = sum(wm.weight for wm in active_fallbacks)
                random_weight = random.random() * total_fallback_weight
                
                for fallback_model in active_fallbacks:
                    random_weight -= fallback_model.weight
                    if random_weight <= 0:
                        return fallback_model
                
                return active_fallbacks[-1]
            
            # Check if there are models but they are all temporarily disabled
            if self._weighted_models or self._fallback_models:
                raise RuntimeError("All models are temporarily rate limited.")
            raise RuntimeError("No models available in the multiplexer.")
        
        # Calculate total weight of active models
        current_total_weight = sum(wm.weight for wm in active_models)
        random_weight = random.random() * current_total_weight
        
        for weighted_model in active_models:
            random_weight -= weighted_model.weight
            if random_weight <= 0:
                return weighted_model
        
        # Fallback (should ideally not be reached with correct logic)
        return active_models[-1]
    
    async def _disable_model_temporarily(
        self, model_name: str, duration_ms: float
    ) -> None:
        """Disables a model temporarily."""
        # Check in primary models first
        model_index = -1
        model_array = self._weighted_models
        
        for i, wm in enumerate(self._weighted_models):
            if wm.model_name == model_name:
                model_index = i
                break
        
        # If not found in primary models, check in fallback models
        if model_index == -1:
            for i, wm in enumerate(self._fallback_models):
                if wm.model_name == model_name:
                    model_index = i
                    model_array = self._fallback_models
                    break
        
        # If model not found in either array, return
        if model_index == -1:
            return
        
        model = model_array[model_index]
        model.disabled_until = time.time() + (duration_ms / 1000.0)
        
        # Cancel existing timeout for this model if any
        existing_task = self._model_timeouts.get(model_name)
        if existing_task and not existing_task.done():
            existing_task.cancel()
            try:
                await existing_task
            except asyncio.CancelledError:
                pass  # Expected when cancelling

        # Set a new timeout to re-enable the model
        async def re_enable_model() -> None:
            try:
                await asyncio.sleep(duration_ms / 1000.0)
                model.disabled_until = None
                logger.info(f"Model {model_name} re-enabled after rate limit.")
            except asyncio.CancelledError:
                logger.debug(f"Re-enable task for {model_name} was cancelled")
                raise
            finally:
                # Clean up the task reference
                self._model_timeouts.pop(model_name, None)

        task = asyncio.create_task(re_enable_model())
        self._model_timeouts[model_name] = task
        
        logger.warning(
            f"Model {model_name} temporarily disabled for "
            f"{duration_ms / 1000.0}s due to rate limit."
        )

    async def _create_completion(
        self,
        *,
        messages: Any,
        model: str = "placeholder",
        **kwargs: Any,
    ) -> CompletionResult:
        """Create a chat completion with automatic failover."""
        last_error: Optional[Exception] = None

        while True:
            try:
                # Attempt to select an available model
                selected = self._select_weighted_model()
            except RuntimeError as selection_error:
                # If model selection fails (e.g., all rate limited or no models configured)
                if last_error:
                    # If we previously caught a 429, throw that error as all retries failed
                    raise last_error
                # Otherwise, re-throw the selection error (no models available/configured)
                raise selection_error

            # Prepare parameters with the selected model name
            final_params = {
                "messages": messages,
                "model": selected.model_name,
                **kwargs,
            }

            try:
                # Attempt the API call
                result = await selected.model.chat.completions.create(**final_params)
                selected.success_count += 1  # Increment success count
                return result
            except Exception as error:
                # Check if it's a rate limit error (429 or 529)
                if self._is_rate_limit_error(error):
                    logger.warning(
                        f"Model {selected.model_name} hit rate limit. Trying next model."
                    )
                    selected.rate_limit_count += 1  # Increment rate limit count
                    await self._disable_model_temporarily(
                        selected.model_name, 60 * 1000
                    )  # Disable for 1 minute
                    last_error = error  # Store the 429 error
                    continue  # Continue the loop to try another model
                else:
                    selected.fail_fast_count += 1  # Increment fail-fast count
                    # For any other error, re-throw immediately
                    logger.error(f"Error in Multiplexer: {selected.model_name}", exc_info=error)
                    raise error

    def _is_rate_limit_error(self, error: Exception) -> bool:
        """Check if an error is a rate limit error (429 or 529)."""
        # Check for OpenAI-style errors
        if hasattr(error, "status_code"):
            return error.status_code in (429, 529)

        # Check for requests-style errors
        if hasattr(error, "response") and hasattr(error.response, "status_code"):
            return error.response.status_code in (429, 529)

        # Check error class name for rate limit indicators (for mock tests)
        error_class_name = error.__class__.__name__.lower()
        if "ratelimit" in error_class_name:
            return True

        # Check error message for rate limit indicators
        error_str = str(error).lower()
        rate_limit_indicators = [
            "rate limit",
            "too many requests",
            "quota exceeded",
            "429",
            "529",
        ]
        return any(indicator in error_str for indicator in rate_limit_indicators)

    def add_model(
        self,
        model: OpenAICompatibleClient,
        weight: int,
        model_name: str,
    ) -> None:
        """Add a primary model to the multiplexer."""
        if not isinstance(weight, int) or weight <= 0:
            raise ValueError("Weight must be a positive integer.")
        if not model_name or not isinstance(model_name, str):
            raise ValueError("model_name must be a non-empty string.")

        # Check for duplicate model names
        all_models = self._weighted_models + self._fallback_models
        if any(wm.model_name == model_name for wm in all_models):
            logger.warning(
                f"Attempted to add a model with the same name '{model_name}' "
                f"multiple times. Skipping."
            )
            return

        # Add model with disabled_until initialized to None and stats to 0
        weighted_model = WeightedModel(model, weight, model_name)
        self._weighted_models.append(weighted_model)

    def add_fallback_model(
        self,
        model: OpenAICompatibleClient,
        weight: int,
        model_name: str,
    ) -> None:
        """Add a fallback model to the multiplexer."""
        if not isinstance(weight, int) or weight <= 0:
            raise ValueError("Weight must be a positive integer.")
        if not model_name or not isinstance(model_name, str):
            raise ValueError("model_name must be a non-empty string.")

        # Check for duplicate model names
        all_models = self._weighted_models + self._fallback_models
        if any(wm.model_name == model_name for wm in all_models):
            logger.warning(
                f"Attempted to add a model with the same name '{model_name}' "
                f"multiple times. Skipping."
            )
            return

        # Add fallback model with disabled_until initialized to None and stats to 0
        weighted_model = WeightedModel(model, weight, model_name)
        self._fallback_models.append(weighted_model)

    def reset(self) -> None:
        """Reset the multiplexer, clearing all models and pending timeouts."""
        # Cancel all pending timeout tasks
        for task in self._model_timeouts.values():
            if not task.done():
                task.cancel()

        self._model_timeouts.clear()

        # Reset model lists
        self._weighted_models = []
        self._fallback_models = []

    async def async_reset(self) -> None:
        """Async version of reset that properly waits for task cancellation."""
        # Cancel all pending timeout tasks properly
        if self._model_timeouts:
            tasks_to_cancel = list(self._model_timeouts.values())
            for task in tasks_to_cancel:
                if not task.done():
                    task.cancel()

            # Wait for all tasks to be cancelled properly
            if tasks_to_cancel:
                await asyncio.gather(*tasks_to_cancel, return_exceptions=True)

        self._model_timeouts.clear()

        # Reset model lists
        self._weighted_models = []
        self._fallback_models = []

    def get_stats(self) -> ModelStats:
        """Get usage statistics for all models."""
        stats: ModelStats = {}
        all_models = self._weighted_models + self._fallback_models

        for wm in all_models:
            stats[wm.model_name] = {
                "success": wm.success_count,
                "rateLimited": wm.rate_limit_count,
                "failed": wm.fail_fast_count,
            }

        return stats

    async def __aenter__(self) -> "Multiplexer":
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit - properly cleanup resources."""
        await self.async_reset()

    def add_model(
        self,
        model: OpenAICompatibleClient,
        weight: int,
        model_name: str,
    ) -> None:
        """Add a primary model to the multiplexer."""
        if not isinstance(weight, int) or weight <= 0:
            raise ValueError("Weight must be a positive integer.")
        if not model_name or not isinstance(model_name, str):
            raise ValueError("model_name must be a non-empty string.")

        # Check for duplicate model names
        all_models = self._weighted_models + self._fallback_models
        if any(wm.model_name == model_name for wm in all_models):
            logger.warning(
                f"Attempted to add a model with the same name '{model_name}' "
                f"multiple times. Skipping."
            )
            return

        # Add model with disabled_until initialized to None and stats to 0
        weighted_model = WeightedModel(model, weight, model_name)
        self._weighted_models.append(weighted_model)

    def add_fallback_model(
        self,
        model: OpenAICompatibleClient,
        weight: int,
        model_name: str,
    ) -> None:
        """Add a fallback model to the multiplexer."""
        if not isinstance(weight, int) or weight <= 0:
            raise ValueError("Weight must be a positive integer.")
        if not model_name or not isinstance(model_name, str):
            raise ValueError("model_name must be a non-empty string.")

        # Check for duplicate model names
        all_models = self._weighted_models + self._fallback_models
        if any(wm.model_name == model_name for wm in all_models):
            logger.warning(
                f"Attempted to add a model with the same name '{model_name}' "
                f"multiple times. Skipping."
            )
            return

        # Add fallback model with disabled_until initialized to None and stats to 0
        weighted_model = WeightedModel(model, weight, model_name)
        self._fallback_models.append(weighted_model)

    def reset(self) -> None:
        """Reset the multiplexer, clearing all models and pending timeouts."""
        # Cancel all pending timeout tasks
        for task in self._model_timeouts.values():
            if not task.done():
                task.cancel()
        self._model_timeouts.clear()

        # Reset model lists
        self._weighted_models = []
        self._fallback_models = []

    def get_stats(self) -> ModelStats:
        """Get usage statistics for all models."""
        stats: ModelStats = {}
        all_models = self._weighted_models + self._fallback_models

        for wm in all_models:
            stats[wm.model_name] = {
                "success": wm.success_count,
                "rateLimited": wm.rate_limit_count,
                "failed": wm.fail_fast_count,
            }

        return stats

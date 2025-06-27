"""Comprehensive tests for the Multiplexer class."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any, Dict

from model_multiplexer import Multiplexer
from model_multiplexer.types import WeightedModel


class MockOpenAIClient:
    """Mock OpenAI-compatible client for testing."""
    
    def __init__(self, name: str = "mock_client"):
        self.name = name
        self.chat = MockChat()


class MockChat:
    """Mock chat interface."""
    
    def __init__(self):
        self.completions = MockCompletions()


class MockCompletions:
    """Mock completions interface."""
    
    def __init__(self):
        self._response = {"choices": [{"message": {"content": "Test response"}}]}
        self._should_raise = None
    
    async def create(self, **kwargs: Any) -> Dict[str, Any]:
        """Mock create method."""
        if self._should_raise:
            raise self._should_raise
        return self._response
    
    def set_response(self, response: Dict[str, Any]) -> None:
        """Set the response to return."""
        self._response = response
    
    def set_error(self, error: Exception) -> None:
        """Set an error to raise."""
        self._should_raise = error


class RateLimitError(Exception):
    """Mock rate limit error."""
    
    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(message)
        self.status_code = 429


class TestMultiplexer:
    """Test cases for the Multiplexer class."""
    
    @pytest.fixture
    def multiplexer(self):
        """Create a fresh multiplexer instance for each test."""
        return Multiplexer()
    
    @pytest.fixture
    def mock_client(self):
        """Create a mock OpenAI client."""
        return MockOpenAIClient()
    
    def test_init(self, multiplexer):
        """Test multiplexer initialization."""
        assert len(multiplexer._weighted_models) == 0
        assert len(multiplexer._fallback_models) == 0
        assert len(multiplexer._model_timeouts) == 0
        assert multiplexer.chat is not None
    
    def test_add_model_valid(self, multiplexer, mock_client):
        """Test adding a valid model."""
        multiplexer.add_model(mock_client, 5, "test-model")
        
        assert len(multiplexer._weighted_models) == 1
        model = multiplexer._weighted_models[0]
        assert model.model == mock_client
        assert model.weight == 5
        assert model.model_name == "test-model"
        assert model.disabled_until is None
        assert model.success_count == 0
        assert model.rate_limit_count == 0
        assert model.fail_fast_count == 0
    
    def test_add_model_invalid_weight(self, multiplexer, mock_client):
        """Test adding a model with invalid weight."""
        with pytest.raises(ValueError, match="Weight must be a positive integer"):
            multiplexer.add_model(mock_client, 0, "test-model")
        
        with pytest.raises(ValueError, match="Weight must be a positive integer"):
            multiplexer.add_model(mock_client, -1, "test-model")
        
        with pytest.raises(ValueError, match="Weight must be a positive integer"):
            multiplexer.add_model(mock_client, 1.5, "test-model")
    
    def test_add_model_invalid_name(self, multiplexer, mock_client):
        """Test adding a model with invalid name."""
        with pytest.raises(ValueError, match="model_name must be a non-empty string"):
            multiplexer.add_model(mock_client, 5, "")
        
        with pytest.raises(ValueError, match="model_name must be a non-empty string"):
            multiplexer.add_model(mock_client, 5, None)
    
    def test_add_duplicate_model(self, multiplexer, mock_client):
        """Test adding a model with duplicate name."""
        multiplexer.add_model(mock_client, 5, "test-model")
        
        # Adding the same model name should be skipped
        with patch('model_multiplexer.multiplexer.logger') as mock_logger:
            multiplexer.add_model(mock_client, 3, "test-model")
            mock_logger.warning.assert_called_once()
        
        # Should still have only one model
        assert len(multiplexer._weighted_models) == 1
    
    def test_add_fallback_model(self, multiplexer, mock_client):
        """Test adding a fallback model."""
        multiplexer.add_fallback_model(mock_client, 3, "fallback-model")
        
        assert len(multiplexer._fallback_models) == 1
        model = multiplexer._fallback_models[0]
        assert model.model == mock_client
        assert model.weight == 3
        assert model.model_name == "fallback-model"
    
    @pytest.mark.asyncio
    async def test_create_completion_success(self, multiplexer, mock_client):
        """Test successful completion creation."""
        multiplexer.add_model(mock_client, 5, "test-model")
        
        result = await multiplexer.chat.completions.create(
            messages=[{"role": "user", "content": "Hello"}]
        )
        
        assert result["choices"][0]["message"]["content"] == "Test response"
        assert multiplexer._weighted_models[0].success_count == 1
    
    @pytest.mark.asyncio
    async def test_no_models_error(self, multiplexer):
        """Test error when no models are available."""
        with pytest.raises(RuntimeError, match="No models available in the multiplexer"):
            await multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": "Hello"}]
            )
    
    @pytest.mark.asyncio
    async def test_rate_limit_fallback(self, multiplexer):
        """Test fallback to next model on rate limit."""
        client1 = MockOpenAIClient("client1")
        client2 = MockOpenAIClient("client2")

        # Set first client to raise rate limit error
        client1.chat.completions.set_error(RateLimitError())

        # Use very high weight for model1 to ensure it's selected first
        multiplexer.add_model(client1, 100, "model1")
        multiplexer.add_model(client2, 1, "model2")

        result = await multiplexer.chat.completions.create(
            messages=[{"role": "user", "content": "Hello"}]
        )

        # Should succeed with second model
        assert result["choices"][0]["message"]["content"] == "Test response"

        # Check statistics - should have tried model1 first (rate limited) then model2 (success)
        stats = multiplexer.get_stats()
        assert stats["model1"]["rateLimited"] >= 1
        assert stats["model2"]["success"] >= 1

    @pytest.mark.asyncio
    async def test_fallback_models_activation(self, multiplexer):
        """Test that fallback models are used when all primary models are rate limited."""
        primary_client = MockOpenAIClient("primary")
        fallback_client = MockOpenAIClient("fallback")

        # Set primary client to raise rate limit error
        primary_client.chat.completions.set_error(RateLimitError())

        multiplexer.add_model(primary_client, 5, "primary-model")
        multiplexer.add_fallback_model(fallback_client, 3, "fallback-model")

        result = await multiplexer.chat.completions.create(
            messages=[{"role": "user", "content": "Hello"}]
        )

        # Should succeed with fallback model
        assert result["choices"][0]["message"]["content"] == "Test response"

        # Check statistics
        stats = multiplexer.get_stats()
        assert stats["primary-model"]["rateLimited"] == 1
        assert stats["fallback-model"]["success"] == 1

    @pytest.mark.asyncio
    async def test_all_models_rate_limited(self, multiplexer):
        """Test error when all models are rate limited."""
        client1 = MockOpenAIClient("client1")
        client2 = MockOpenAIClient("client2")

        # Set both clients to raise rate limit errors
        client1.chat.completions.set_error(RateLimitError())
        client2.chat.completions.set_error(RateLimitError())

        multiplexer.add_model(client1, 5, "model1")
        multiplexer.add_fallback_model(client2, 3, "model2")

        # Should raise the last rate limit error, not the RuntimeError
        with pytest.raises(RateLimitError, match="Rate limit exceeded"):
            await multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": "Hello"}]
            )

    @pytest.mark.asyncio
    async def test_non_rate_limit_error_propagation(self, multiplexer, mock_client):
        """Test that non-rate-limit errors are propagated immediately."""
        error = ValueError("Some other error")
        mock_client.chat.completions.set_error(error)

        multiplexer.add_model(mock_client, 5, "test-model")

        with pytest.raises(ValueError, match="Some other error"):
            await multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": "Hello"}]
            )

        # Should increment fail-fast count
        stats = multiplexer.get_stats()
        assert stats["test-model"]["failed"] == 1

    def test_get_stats_empty(self, multiplexer):
        """Test getting stats when no models are added."""
        stats = multiplexer.get_stats()
        assert stats == {}

    def test_get_stats_with_models(self, multiplexer, mock_client):
        """Test getting stats with models."""
        multiplexer.add_model(mock_client, 5, "test-model")

        stats = multiplexer.get_stats()
        expected = {
            "test-model": {
                "success": 0,
                "rateLimited": 0,
                "failed": 0,
            }
        }
        assert stats == expected

    def test_reset(self, multiplexer, mock_client):
        """Test resetting the multiplexer."""
        multiplexer.add_model(mock_client, 5, "test-model")
        multiplexer.add_fallback_model(mock_client, 3, "fallback-model")

        multiplexer.reset()

        assert len(multiplexer._weighted_models) == 0
        assert len(multiplexer._fallback_models) == 0
        assert len(multiplexer._model_timeouts) == 0

    @pytest.mark.asyncio
    async def test_context_manager(self, mock_client):
        """Test using multiplexer as async context manager."""
        async with Multiplexer() as multiplexer:
            multiplexer.add_model(mock_client, 5, "test-model")
            assert len(multiplexer._weighted_models) == 1

        # After exiting context, should be reset
        assert len(multiplexer._weighted_models) == 0

    def test_weighted_selection_distribution(self, multiplexer):
        """Test that weighted selection follows expected distribution."""
        client1 = MockOpenAIClient("client1")
        client2 = MockOpenAIClient("client2")

        # Add models with different weights
        multiplexer.add_model(client1, 7, "model1")  # 70% probability
        multiplexer.add_model(client2, 3, "model2")  # 30% probability

        # Mock random to test selection logic
        with patch('model_multiplexer.multiplexer.random.random') as mock_random:
            # Test selection of first model (random = 0.5, should select model1)
            mock_random.return_value = 0.5
            selected = multiplexer._select_weighted_model()
            assert selected.model_name == "model1"

            # Test selection of second model (random = 0.8, should select model2)
            mock_random.return_value = 0.8
            selected = multiplexer._select_weighted_model()
            assert selected.model_name == "model2"

    @pytest.mark.asyncio
    async def test_model_re_enabling_after_timeout(self, multiplexer):
        """Test that models are re-enabled after timeout."""
        client = MockOpenAIClient("client")
        multiplexer.add_model(client, 5, "test-model")

        # Disable model temporarily with short duration
        await multiplexer._disable_model_temporarily("test-model", 100)  # 100ms

        model = multiplexer._weighted_models[0]
        assert model.disabled_until is not None

        # Wait for timeout
        await asyncio.sleep(0.15)  # Wait a bit longer than timeout

        # Model should be re-enabled
        assert model.disabled_until is None
        assert "test-model" not in multiplexer._model_timeouts

    def test_is_rate_limit_error_detection(self, multiplexer):
        """Test rate limit error detection."""
        # Test with status_code attribute
        error1 = Exception()
        error1.status_code = 429
        assert multiplexer._is_rate_limit_error(error1)

        error2 = Exception()
        error2.status_code = 529
        assert multiplexer._is_rate_limit_error(error2)

        error3 = Exception()
        error3.status_code = 500
        assert not multiplexer._is_rate_limit_error(error3)

        # Test with response.status_code attribute
        error4 = Exception()
        error4.response = MagicMock()
        error4.response.status_code = 429
        assert multiplexer._is_rate_limit_error(error4)

        # Test with error message
        error5 = Exception("Rate limit exceeded")
        assert multiplexer._is_rate_limit_error(error5)

        error6 = Exception("Too many requests")
        assert multiplexer._is_rate_limit_error(error6)

        error7 = Exception("Some other error")
        assert not multiplexer._is_rate_limit_error(error7)

    @pytest.mark.asyncio
    async def test_concurrent_requests(self, multiplexer):
        """Test handling concurrent requests."""
        client1 = MockOpenAIClient("client1")
        client2 = MockOpenAIClient("client2")

        multiplexer.add_model(client1, 5, "model1")
        multiplexer.add_model(client2, 5, "model2")

        # Create multiple concurrent requests
        tasks = []
        for i in range(10):
            task = multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": f"Request {i}"}]
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        # All requests should succeed
        assert len(results) == 10
        for result in results:
            assert result["choices"][0]["message"]["content"] == "Test response"

        # Check that both models were used
        stats = multiplexer.get_stats()
        total_success = stats["model1"]["success"] + stats["model2"]["success"]
        assert total_success == 10

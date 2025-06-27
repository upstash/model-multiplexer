"""Integration tests for the Multiplexer with real OpenAI client structure."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any, Dict

from model_multiplexer import Multiplexer


class MockOpenAIResponse:
    """Mock OpenAI response object."""
    
    def __init__(self, content: str = "Test response"):
        self.choices = [
            MagicMock(message=MagicMock(content=content))
        ]


class MockOpenAICompletions:
    """Mock OpenAI completions interface that mimics real OpenAI SDK."""
    
    def __init__(self, client_name: str = "mock"):
        self.client_name = client_name
        self._should_fail = False
        self._fail_count = 0
        self._max_fails = 0
        self._response_content = "Test response"
    
    async def create(self, **kwargs: Any) -> MockOpenAIResponse:
        """Mock the create method."""
        if self._should_fail and self._fail_count < self._max_fails:
            self._fail_count += 1
            error = Exception("Rate limit exceeded")
            error.status_code = 429
            raise error
        
        return MockOpenAIResponse(self._response_content)
    
    def set_failure(self, should_fail: bool, max_fails: int = 1):
        """Configure the mock to fail a certain number of times."""
        self._should_fail = should_fail
        self._max_fails = max_fails
        self._fail_count = 0
    
    def set_response_content(self, content: str):
        """Set the response content."""
        self._response_content = content


class MockOpenAIChat:
    """Mock OpenAI chat interface."""
    
    def __init__(self, client_name: str = "mock"):
        self.completions = MockOpenAICompletions(client_name)


class MockOpenAIClient:
    """Mock OpenAI client that closely mimics the real OpenAI SDK structure."""
    
    def __init__(self, client_name: str = "mock", api_key: str = "test-key"):
        self.client_name = client_name
        self.api_key = api_key
        self.chat = MockOpenAIChat(client_name)


class TestMultiplexerIntegration:
    """Integration tests for the Multiplexer class."""
    
    @pytest.fixture
    def multiplexer(self):
        """Create a fresh multiplexer instance for each test."""
        return Multiplexer()
    
    @pytest.mark.asyncio
    async def test_single_model_success(self, multiplexer):
        """Test successful completion with a single model."""
        client = MockOpenAIClient("openai")
        multiplexer.add_model(client, 5, "gpt-4")
        
        result = await multiplexer.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "What is 1+1?"}
            ],
            model="placeholder",  # This will be overridden
            temperature=0.7,
            max_tokens=100
        )
        
        assert result.choices[0].message.content == "Test response"
        
        stats = multiplexer.get_stats()
        assert stats["gpt-4"]["success"] == 1
        assert stats["gpt-4"]["rateLimited"] == 0
        assert stats["gpt-4"]["failed"] == 0
    
    @pytest.mark.asyncio
    async def test_multiple_providers_load_balancing(self, multiplexer):
        """Test load balancing across multiple providers."""
        openai_client = MockOpenAIClient("openai")
        claude_client = MockOpenAIClient("claude")
        gemini_client = MockOpenAIClient("gemini")
        
        # Set different response content for each client
        openai_client.chat.completions.set_response_content("OpenAI response")
        claude_client.chat.completions.set_response_content("Claude response")
        gemini_client.chat.completions.set_response_content("Gemini response")
        
        multiplexer.add_model(openai_client, 3, "gpt-4")
        multiplexer.add_model(claude_client, 3, "claude-3-sonnet")
        multiplexer.add_model(gemini_client, 3, "gemini-pro")
        
        # Make multiple requests to see load balancing
        responses = []
        for _ in range(9):  # Multiple requests to see distribution
            result = await multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": "Hello"}]
            )
            responses.append(result.choices[0].message.content)
        
        # All requests should succeed
        assert len(responses) == 9
        
        # Check that all models were used (with equal weights, should be roughly equal)
        stats = multiplexer.get_stats()
        total_requests = sum(stats[model]["success"] for model in stats)
        assert total_requests == 9
        
        # Each model should have been used at least once (with high probability)
        models_used = sum(1 for model in stats if stats[model]["success"] > 0)
        assert models_used >= 2  # At least 2 models should have been used
    
    @pytest.mark.asyncio
    async def test_rate_limit_failover_scenario(self, multiplexer):
        """Test realistic rate limit failover scenario."""
        primary_client = MockOpenAIClient("openai")
        fallback_client = MockOpenAIClient("claude")
        
        # Configure primary client to fail first 2 requests with rate limit
        primary_client.chat.completions.set_failure(True, max_fails=2)
        
        multiplexer.add_model(primary_client, 5, "gpt-4")
        multiplexer.add_fallback_model(fallback_client, 3, "claude-3-sonnet")
        
        # First request should fail over to fallback
        result1 = await multiplexer.chat.completions.create(
            messages=[{"role": "user", "content": "First request"}]
        )
        assert result1.choices[0].message.content == "Test response"
        
        # Second request should also use fallback (primary still rate limited)
        result2 = await multiplexer.chat.completions.create(
            messages=[{"role": "user", "content": "Second request"}]
        )
        assert result2.choices[0].message.content == "Test response"
        
        # Check statistics
        stats = multiplexer.get_stats()
        # Primary model should have been rate limited at least once
        assert stats["gpt-4"]["rateLimited"] >= 1
        # Fallback should have handled the requests
        assert stats["claude-3-sonnet"]["success"] == 2
    
    @pytest.mark.asyncio
    async def test_streaming_support_mock(self, multiplexer):
        """Test that streaming parameters are passed through correctly."""
        client = MockOpenAIClient("openai")
        multiplexer.add_model(client, 5, "gpt-4")
        
        # Mock the create method to verify streaming parameter is passed
        original_create = client.chat.completions.create
        
        async def mock_create(**kwargs):
            # Verify that stream parameter is passed through
            assert "stream" in kwargs
            assert kwargs["stream"] is True
            return await original_create(**kwargs)
        
        client.chat.completions.create = mock_create
        
        result = await multiplexer.chat.completions.create(
            messages=[{"role": "user", "content": "Test streaming"}],
            stream=True
        )
        
        assert result.choices[0].message.content == "Test response"
    
    @pytest.mark.asyncio
    async def test_error_handling_with_mixed_errors(self, multiplexer):
        """Test handling of mixed error types across models."""
        client1 = MockOpenAIClient("client1")
        client2 = MockOpenAIClient("client2")

        # Configure different error types
        async def rate_limit_error(**kwargs):
            error = Exception("Rate limit exceeded")
            error.status_code = 429
            raise error

        async def server_error(**kwargs):
            error = Exception("Internal server error")
            error.status_code = 500
            raise error

        client1.chat.completions.create = rate_limit_error
        client2.chat.completions.create = server_error

        # Only add the two failing models to ensure we get an error
        multiplexer.add_model(client1, 3, "model1")
        multiplexer.add_model(client2, 3, "model2")

        # Should fail over from rate limit to server error, then raise server error
        # (since server errors are not retried)
        with pytest.raises(Exception):
            await multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": "Test"}]
            )

        stats = multiplexer.get_stats()
        # Should have attempted at least one model and failed
        total_attempts = sum(
            stats[model]["rateLimited"] + stats[model]["failed"] + stats[model]["success"]
            for model in stats
        )
        assert total_attempts >= 1

        # At least one model should have failed (either rate limited or server error)
        total_failures = sum(
            stats[model]["rateLimited"] + stats[model]["failed"]
            for model in stats
        )
        assert total_failures >= 1
    
    @pytest.mark.asyncio
    async def test_complex_weight_distribution(self, multiplexer):
        """Test complex weight distribution with primary and fallback models."""
        # Primary models with different weights
        primary1 = MockOpenAIClient("primary1")
        primary2 = MockOpenAIClient("primary2")
        
        # Fallback models
        fallback1 = MockOpenAIClient("fallback1")
        fallback2 = MockOpenAIClient("fallback2")
        
        multiplexer.add_model(primary1, 7, "gpt-4")  # 70% of primary traffic
        multiplexer.add_model(primary2, 3, "gpt-3.5")  # 30% of primary traffic
        
        multiplexer.add_fallback_model(fallback1, 6, "claude-3")  # 60% of fallback traffic
        multiplexer.add_fallback_model(fallback2, 4, "gemini-pro")  # 40% of fallback traffic
        
        # Test normal operation (should use primary models)
        results = []
        for _ in range(20):
            result = await multiplexer.chat.completions.create(
                messages=[{"role": "user", "content": "Test"}]
            )
            results.append(result)
        
        stats = multiplexer.get_stats()
        
        # Should only use primary models
        assert stats["gpt-4"]["success"] + stats["gpt-3.5"]["success"] == 20
        assert stats["claude-3"]["success"] == 0
        assert stats["gemini-pro"]["success"] == 0
        
        # gpt-4 should be used more than gpt-3.5 due to higher weight
        assert stats["gpt-4"]["success"] > stats["gpt-3.5"]["success"]

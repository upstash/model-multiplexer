"""Test helper class for the Multiplexer, similar to the TypeScript MultiplexerTest."""

import asyncio
import logging
from typing import Optional

from .multiplexer import Multiplexer
from .types import OpenAICompatibleClient

logger = logging.getLogger(__name__)


class MultiplexerTest:
    """Test helper class for the Multiplexer."""
    
    def __init__(self) -> None:
        self.multiplexer = Multiplexer()
    
    def add_model(
        self, 
        client: OpenAICompatibleClient, 
        weight: int, 
        model_name: str
    ) -> "MultiplexerTest":
        """Add a model and return self for chaining."""
        self.multiplexer.add_model(client, weight, model_name)
        return self
    
    def add_fallback_model(
        self, 
        client: OpenAICompatibleClient, 
        weight: int, 
        model_name: str
    ) -> "MultiplexerTest":
        """Add a fallback model and return self for chaining."""
        self.multiplexer.add_fallback_model(client, weight, model_name)
        return self
    
    async def test_simple_addition(self) -> bool:
        """Test the multiplexer with a simple addition prompt."""
        try:
            message = await self.multiplexer.chat.completions.create(
                model="placeholder",
                messages=[
                    {
                        "role": "user",
                        "content": "What is 1+1? Answer with just the number.",
                    },
                ],
            )
            
            # Check if it's a streaming response or regular response
            if hasattr(message, 'choices') and message.choices:
                response_content = message.choices[0].message.content.strip()
                return response_content == "2"
            else:
                logger.error("Expected ChatCompletion, but received a stream or invalid response.")
                return False
                
        except Exception as error:
            logger.error(f"Error testing multiplexer: {error}")
            return False
    
    @staticmethod
    async def test_single_model(
        client: OpenAICompatibleClient, 
        model_name: str
    ) -> bool:
        """
        Test a single OpenAI-compatible client and model with a simple addition prompt.
        
        Args:
            client: An initialized OpenAI or compatible client instance.
            model_name: The specific model name to test.
            
        Returns:
            True if the model responds correctly with "2", False otherwise.
        """
        logger.info(f"Testing model: {model_name}...")
        try:
            message = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "user",
                        "content": "What is 1+1? Answer with just the number.",
                    },
                ],
            )
            
            # Check if it's a streaming response or regular response
            if hasattr(message, 'choices') and message.choices:
                response_content = message.choices[0].message.content.strip()
                result = response_content == "2"
                logger.info(f"[{model_name}] Response: '{response_content}'. Correct: {result}")
                return result
            else:
                logger.error(f"[{model_name}] Expected ChatCompletion, but received a stream or invalid response.")
                return False
                
        except Exception as error:
            logger.error(f"[{model_name}] Error testing model: {error}")
            return False
    
    async def cleanup(self) -> None:
        """Clean up resources."""
        await self.multiplexer.async_reset()
    
    async def __aenter__(self) -> "MultiplexerTest":
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.cleanup()

#!/usr/bin/env python3
"""
Model testing script similar to the TypeScript MultiplexerTester.

This script tests individual models to verify they work correctly before
using them in the multiplexer.

Before running this script, set the following environment variables:
export OPENAI_API_KEY="your-openai-key"
export ANTHROPIC_API_KEY="your-anthropic-key"
export GEMINI_API_KEY="your-gemini-key"
"""

import asyncio
import os
import sys
import logging
from typing import Dict, List, NamedTuple, Optional

# Add the parent directory to the path so we can import the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model_multiplexer.test_helper import MultiplexerTest

try:
    from openai import AsyncOpenAI
except ImportError:
    print("OpenAI package is required. Install it with: pip install openai>=1.0.0")
    sys.exit(1)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ModelInfo(NamedTuple):
    """Information about a model to test."""
    client: AsyncOpenAI
    name: str


class TestResults:
    """Container for test results."""
    
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors: List[str] = []


def get_env_var(name: str) -> Optional[str]:
    """Get environment variable with helpful error message."""
    value = os.getenv(name)
    if not value:
        logger.warning(f"{name} environment variable not set")
    return value


async def create_test_clients() -> Dict[str, AsyncOpenAI]:
    """Create OpenAI-compatible clients for testing."""
    clients = {}
    
    # OpenAI client
    openai_key = get_env_var("OPENAI_API_KEY")
    if openai_key:
        clients["openai"] = AsyncOpenAI(
            api_key=openai_key,
            timeout=120.0,  # Increased timeout for potentially slower models
        )
    
    # Anthropic client
    anthropic_key = get_env_var("ANTHROPIC_API_KEY")
    if anthropic_key:
        clients["anthropic"] = AsyncOpenAI(
            api_key=anthropic_key,
            base_url="https://api.anthropic.com/v1/",
            timeout=120.0,
        )
    
    # Gemini client
    gemini_key = get_env_var("GEMINI_API_KEY")
    if gemini_key:
        clients["gemini"] = AsyncOpenAI(
            api_key=gemini_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            timeout=120.0,
        )
    
    return clients


async def run_single_model_tests() -> bool:
    """Run tests on individual models."""
    results = TestResults()
    
    try:
        # Initialize clients
        clients = await create_test_clients()
        
        if not clients:
            logger.error("No API keys found. Please set environment variables.")
            return False
        
        # Define all models to test
        models_to_test: List[ModelInfo] = []
        
        # Anthropic models
        if "anthropic" in clients:
            models_to_test.extend([
                ModelInfo(clients["anthropic"], "claude-3-5-sonnet-20240620"),
                ModelInfo(clients["anthropic"], "claude-3-5-sonnet-20241022"),
                ModelInfo(clients["anthropic"], "claude-3-opus-20240229"),
            ])
        
        # OpenAI models
        if "openai" in clients:
            models_to_test.extend([
                ModelInfo(clients["openai"], "gpt-4o"),
                ModelInfo(clients["openai"], "gpt-4o-mini"),
            ])
        
        # Google models
        if "gemini" in clients:
            models_to_test.extend([
                ModelInfo(clients["gemini"], "gemini-1.5-pro"),
            ])
        
        logger.info(f"--- Starting Single Model Tests ({len(models_to_test)} models) ---")
        
        for model_info in models_to_test:
            try:
                result = await MultiplexerTest.test_single_model(
                    model_info.client,
                    model_info.name
                )
                if result:
                    results.passed += 1
                else:
                    results.failed += 1
                    results.errors.append(f"{model_info.name}: Failed to return '2'")
                    
            except Exception as error:
                results.failed += 1
                error_msg = str(error) if str(error) else "Unknown error"
                results.errors.append(f"{model_info.name}: {error_msg}")
                logger.error(f"Error testing {model_info.name}: {error}")
            
            # Add a delay between calls to avoid rate limiting
            await asyncio.sleep(1.0)
        
        # Print summary
        logger.info("--- Test Summary ---")
        logger.info(f"Passed: {results.passed}")
        logger.info(f"Failed: {results.failed}")
        
        if results.errors:
            logger.info("--- Errors ---")
            for error in results.errors:
                logger.info(f"- {error}")
        
        logger.info("--------------------")
        
        return results.failed == 0  # Return True if all tests passed
        
    except Exception as error:
        logger.error(f"Failed to run single model tests: {error}")
        return False


async def run_multiplexer_test() -> bool:
    """Run a test using the multiplexer with multiple models."""
    logger.info("--- Starting Multiplexer Test ---")
    
    try:
        clients = await create_test_clients()
        
        if len(clients) < 2:
            logger.warning("Need at least 2 API keys to test multiplexer effectively")
            return False
        
        async with MultiplexerTest() as tester:
            # Add available models
            if "anthropic" in clients:
                tester.add_model(clients["anthropic"], 5, "claude-3-5-sonnet-20241022")
            
            if "openai" in clients:
                tester.add_model(clients["openai"], 3, "gpt-4o")
                tester.add_fallback_model(clients["openai"], 2, "gpt-4o-mini")
            
            if "gemini" in clients:
                tester.add_fallback_model(clients["gemini"], 2, "gemini-1.5-flash")
            
            # Run the test
            result = await tester.test_simple_addition()
            
            if result:
                logger.info("Multiplexer test PASSED")
                
                # Show statistics
                stats = tester.multiplexer.get_stats()
                logger.info("Model usage statistics:")
                for model_name, model_stats in stats.items():
                    logger.info(f"  {model_name}: {model_stats}")
                
                return True
            else:
                logger.error("Multiplexer test FAILED")
                return False
                
    except Exception as error:
        logger.error(f"Multiplexer test failed with error: {error}")
        return False


async def main():
    """Main test function."""
    logger.info("Starting Model Multiplexer Tests")
    
    # Test individual models
    single_model_success = await run_single_model_tests()
    
    # Test multiplexer
    multiplexer_success = await run_multiplexer_test()
    
    # Overall result
    overall_success = single_model_success and multiplexer_success
    
    if overall_success:
        logger.info("🎉 All tests passed!")
        return 0
    else:
        logger.error("❌ Some tests failed!")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)

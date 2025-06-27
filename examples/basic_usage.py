#!/usr/bin/env python3
"""
Basic usage example for the Model Multiplexer.

This example demonstrates how to use the Model Multiplexer to combine quotas
from multiple LLM providers and automatically handle rate limits.

Before running this example, set the following environment variables:
export OPENAI_API_KEY="your-openai-key"
export ANTHROPIC_API_KEY="your-anthropic-key"
export GEMINI_API_KEY="your-gemini-key"
"""

import asyncio
import os
import sys
from typing import Optional

# Add the parent directory to the path so we can import the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model_multiplexer import Multiplexer

try:
    from openai import AsyncOpenAI
except ImportError:
    print("OpenAI package is required. Install it with: pip install openai>=1.0.0")
    sys.exit(1)


def get_env_var(name: str) -> Optional[str]:
    """Get environment variable with helpful error message."""
    value = os.getenv(name)
    if not value:
        print(f"Warning: {name} environment variable not set")
    return value


async def create_clients():
    """Create OpenAI-compatible clients for different providers."""
    clients = {}
    
    # OpenAI client
    openai_key = get_env_var("OPENAI_API_KEY")
    if openai_key:
        clients["openai"] = AsyncOpenAI(
            api_key=openai_key,
            base_url="https://api.openai.com/v1",
        )
    
    # Claude client (using OpenAI-compatible endpoint)
    anthropic_key = get_env_var("ANTHROPIC_API_KEY")
    if anthropic_key:
        clients["claude"] = AsyncOpenAI(
            api_key=anthropic_key,
            base_url="https://api.anthropic.com/v1/",
        )
    
    # Gemini client (using OpenAI-compatible endpoint)
    gemini_key = get_env_var("GEMINI_API_KEY")
    if gemini_key:
        clients["gemini"] = AsyncOpenAI(
            api_key=gemini_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/",
        )
    
    return clients


async def run_chat_completion(multiplexer: Multiplexer):
    """Run a chat completion request using the multiplexer."""
    print("\nSending chat completion request...")
    
    try:
        completion = await multiplexer.chat.completions.create(
            model="placeholder",  # This will be overridden by the selected model
            messages=[
                {"role": "system", "content": "You are a funny assistant."},
                {"role": "user", "content": "Tell me a joke. Max 10 words."},
            ],
            temperature=0.5,
            max_tokens=1000,
        )
        
        print("Chat completion received:")
        print(completion.choices[0].message.content)
        
    except Exception as error:
        print(f"Error during chat completion: {error}")


async def run_multiple_requests(multiplexer: Multiplexer, count: int = 5):
    """Run multiple requests to demonstrate load balancing."""
    print(f"\nRunning {count} requests to demonstrate load balancing...")
    
    tasks = []
    for i in range(count):
        task = multiplexer.chat.completions.create(
            model="placeholder",
            messages=[
                {"role": "user", "content": f"What is {i+1} + {i+1}? Answer with just the number."},
            ],
            temperature=0.1,
            max_tokens=10,
        )
        tasks.append(task)
    
    try:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        successful_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                print(f"Request {i+1} failed: {result}")
            else:
                response = result.choices[0].message.content.strip()
                successful_results.append(response)
                print(f"Request {i+1} response: {response}")
        
        print(f"\nSuccessful requests: {len(successful_results)}/{count}")
        
    except Exception as error:
        print(f"Error during multiple requests: {error}")


async def demonstrate_rate_limit_handling(multiplexer: Multiplexer):
    """Demonstrate rate limit handling (this is just for illustration)."""
    print("\nDemonstrating rate limit handling...")
    print("(In a real scenario, you would see automatic failover when rate limits are hit)")
    
    # In a real scenario with actual rate limits, you would see:
    # 1. Primary model hits rate limit
    # 2. Automatic failover to next available model
    # 3. Temporary disabling of rate-limited model
    # 4. Automatic re-enabling after cooldown period
    
    print("Rate limit handling is automatic and transparent to your application!")


async def main():
    """Main example function."""
    print("Initializing Model Multiplexer...")
    
    # Create clients for different providers
    clients = await create_clients()
    
    if not clients:
        print("No API keys found. Please set environment variables:")
        print("export OPENAI_API_KEY='your-openai-key'")
        print("export ANTHROPIC_API_KEY='your-anthropic-key'")
        print("export GEMINI_API_KEY='your-gemini-key'")
        return
    
    # Initialize multiplexer
    async with Multiplexer() as multiplexer:
        try:
            # Add primary models (more expensive/capable models)
            if "claude" in clients:
                multiplexer.add_model(clients["claude"], 5, "claude-3-5-sonnet-20241022")
                multiplexer.add_model(clients["claude"], 3, "claude-3-opus-20240229")
            
            if "gemini" in clients:
                multiplexer.add_model(clients["gemini"], 4, "gemini-1.5-pro")
            
            # Add fallback models (cheaper models, possibly higher quotas)
            if "openai" in clients:
                multiplexer.add_fallback_model(clients["openai"], 5, "gpt-4o-mini")
                multiplexer.add_fallback_model(clients["openai"], 3, "gpt-3.5-turbo")
            
            if "gemini" in clients:
                multiplexer.add_fallback_model(clients["gemini"], 3, "gemini-1.5-flash")
            
            print(f"Added {len(multiplexer._weighted_models)} primary models")
            print(f"Added {len(multiplexer._fallback_models)} fallback models")
            
            # Run examples
            await run_chat_completion(multiplexer)
            await run_multiple_requests(multiplexer)
            await demonstrate_rate_limit_handling(multiplexer)
            
            # Show usage statistics
            print("\nModel usage statistics:")
            stats = multiplexer.get_stats()
            for model_name, model_stats in stats.items():
                print(f"  {model_name}:")
                print(f"    Success: {model_stats['success']}")
                print(f"    Rate Limited: {model_stats['rateLimited']}")
                print(f"    Failed: {model_stats['failed']}")
            
        except Exception as error:
            print(f"Error initializing Model Multiplexer: {error}")
            return
    
    print("\nExample completed successfully!")


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())

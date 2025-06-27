# Model Multiplexer (Python)

**Eliminate 429 Rate Limit Errors Forever** 🚀

A lightweight Python library that combines the quotas of multiple LLM providers (and models) with a single unified API. Never hit rate limits again by automatically distributing your requests across OpenAI, Claude, Gemini, and other providers.

## The Problem: Rate Limits Kill Your App

- ❌ **Error 429**: "Rate limit exceeded" stops your application
- ❌ **Quota exhaustion**: Single provider limits constrain your throughput
- ❌ **Unpredictable failures**: Rate limits hit at the worst possible moments
- ❌ **Manual failover**: Switching providers requires code changes

## The Solution: Combined Quotas

- ✅ **10x Higher Throughput**: Combine OpenAI + Claude + Gemini quotas  
- ✅ **Zero 429 Errors**: Automatic failover when one provider hits limits  
- ✅ **Seamless Integration**: Drop-in replacement for OpenAI SDK  
- ✅ **Smart Load Balancing**: Weight-based distribution across providers

## Key Benefits

- 🚀 **Quota Multiplication**: Combine rate limits from multiple providers for massive throughput
- 🛡️ **429 Error Elimination**: Automatic failover prevents rate limit failures
- ⚡ **Zero Downtime**: Seamless switching between providers when limits hit
- 🔌 **OpenAI SDK Compatible**: Works with existing OpenAI SDK code
- 🎯 **Zero Dependencies**: Lightweight with no runtime dependencies
- 📊 **Usage Analytics**: Track which providers are hitting limits

## How Quota Combining Works

```
Single Model:        [GPT-4: 10K RPM] ❌ 429 Error at 10,001 requests
Single Model (two keys):        [GPT-4: 10K RPM] + [GPT-4: 10K RPM] = 20,000 RPM ✅
Multiple Providers:  [OpenAI: 10K] + [Claude: 15K] + [Gemini: 20K] = 45,000 RPM ✅
Multiple Models:     [GPT-4: 10K] + [GPT-4-mini: 50K] + [Claude: 15K] = 75,000 RPM ✅✅
```

## Installation

```bash
pip install model-multiplexer
```

The package requires Python 3.8+ and automatically installs the OpenAI Python SDK as a dependency.

## Quick Start

```python
import asyncio
import os
from model_multiplexer import Multiplexer
from openai import AsyncOpenAI

async def main():
    # Create client instances
    claude = AsyncOpenAI(
        api_key=os.getenv("ANTHROPIC_API_KEY"),
        base_url="https://api.anthropic.com/v1/",
    )

    openai = AsyncOpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url="https://api.openai.com/v1",
    )

    openai_2 = AsyncOpenAI(
        api_key=os.getenv("OPENAI_API_KEY_2"),
        base_url="https://api.openai.com/v1",
    )

    gemini = AsyncOpenAI(
        api_key=os.getenv("GEMINI_API_KEY"),
        base_url="https://generativelanguage.googleapis.com/v1beta/",
    )

    # Initialize multiplexer
    async with Multiplexer() as multiplexer:
        # Add models with weights and specific model names
        multiplexer.add_model(claude, 5, "claude-3-5-sonnet-20241022")
        multiplexer.add_model(openai, 3, "gpt-4o")
        multiplexer.add_model(openai_2, 3, "gpt-4o")

        multiplexer.add_fallback_model(openai, 3, "gpt-4o-mini")
        multiplexer.add_fallback_model(gemini, 3, "gemini-1.5-flash")

        # Use like a regular OpenAI client
        completion = await multiplexer.chat.completions.create(
            model="placeholder",  # Will be overridden by selected model
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "What is the capital of France?"},
            ],
        )

        print(completion.choices[0].message.content)
        print("Model usage stats:", multiplexer.get_stats())

# Run the async function
asyncio.run(main())
```

### How Primary and Fallback Models Work

The multiplexer operates with a **two-tier system**:

#### **Primary Models** (`add_model`)

- **First choice**: Always used when available
- **Weight-based selection**: Higher weights = higher probability of selection
- **Example**: In the code above, `claude-3-5-sonnet-20241022` (weight: 5) and `gpt-4o` (weight: 3) are primary models

#### **Fallback Models** (`add_fallback_model`)

- **Backup safety net**: Only used when ALL primary models hit rate limits
- **Example**: `gpt-4o-mini` and `gemini-1.5-flash` (both weight: 3) only activate if both primary models are rate-limited

#### **Request Flow**

1. **Normal operation**: Multiplexer selects from primary models (claude-3-5-sonnet-20241022 or gpt-4o) based on weights (5:3 ratio)
2. **Rate limit hit**: If a primary model returns 429, it's temporarily disabled (e.g., Claude hits limit)
3. **Automatic failover**: Traffic continues flowing to remaining active primary models (e.g., all traffic goes to GPT-4o)
4. **Emergency fallback**: If ALL primary models hit limits, fallback models activate (GPT-4o-mini + Gemini-1.5-flash with equal weights)
5. **Recovery**: Rate-limited models automatically re-enable after cooldown period

## API Examples

### Creating a Multiplexer

```python
from model_multiplexer import Multiplexer

# Create multiplexer instance
multiplexer = Multiplexer()

# Or use as async context manager (recommended)
async with Multiplexer() as multiplexer:
    # Your code here
    pass
```

### Adding Models

```python
# Add a primary model
multiplexer.add_model(client: AsyncOpenAI, weight: int, model_name: str)

# Add a fallback model
multiplexer.add_fallback_model(client: AsyncOpenAI, weight: int, model_name: str)
```

**Parameters:**

- `client`: AsyncOpenAI-compatible client instance
- `weight`: Positive integer for weight-based selection (higher = more likely to be selected)
- `model_name`: Specific model name to use (e.g., "gpt-4o-mini", "claude-3-5-sonnet-20241022")

### Getting Statistics

```python
stats = multiplexer.get_stats()
print("Model usage stats:", stats)
# Returns: Dict[str, Dict[str, int]] with success, rateLimited, and failed counts
```

**Example Response:**

```python
{
    'claude-3-5-sonnet-20241022': {'success': 847, 'rateLimited': 3, 'failed': 1},
    'gpt-4o': {'success': 521, 'rateLimited': 1, 'failed': 0},
    'claude-3-opus-20240229': {'success': 312, 'rateLimited': 0, 'failed': 0},
    'gemini-1.5-pro': {'success': 289, 'rateLimited': 0, 'failed': 0},
    'gpt-4o-mini': {'success': 3, 'rateLimited': 0, 'failed': 0},
    'gemini-1.5-flash': {'success': 1, 'rateLimited': 0, 'failed': 0}
}
```

### Resetting the Multiplexer

```python
await multiplexer.reset()  # Clears all models and resets state
```

## Streaming Support

```python
async def stream_example():
    stream = await multiplexer.chat.completions.create(
        model="placeholder",  # Will be overridden
        messages=[{"role": "user", "content": "Write a poem about AI."}],
        stream=True,
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")
```

## Testing

The package includes comprehensive unit and integration tests. To run tests:

```bash
# Install development dependencies
pip install -r requirements-dev.txt

# Run tests
pytest

# Run tests with coverage
pytest --cov=model_multiplexer

# Run specific test file
pytest tests/test_multiplexer.py
```


## Development

To set up the development environment:

```bash
# Clone the repository
git clone https://github.com/upstash/model-multiplexer.git
cd model-multiplexer

# Install in development mode
pip install -e .
pip install -r requirements-dev.txt

# Run tests
pytest

# Run linting and formatting
make lint
make format
make type-check
```

## More Examples

Check out the [examples](./examples) directory for more detailed usage patterns:

- `examples/basic_usage.py` - Complete usage example with multiple providers
- `examples/test_models.py` - Test individual models and multiplexer functionality

## API Reference

### Multiplexer Class

#### Methods

- `add_model(client, weight, model_name)` - Add a primary model
- `add_fallback_model(client, weight, model_name)` - Add a fallback model
- `get_stats()` - Get usage statistics
- `reset()` - Reset multiplexer state
- `async_reset()` - Async version of reset

#### Properties

- `chat.completions.create()` - OpenAI-compatible chat completions interface

### Context Manager Support

```python
async with Multiplexer() as multiplexer:
    # Automatically cleans up resources on exit
    pass
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite: `pytest`
6. Run linting: `make lint`
7. Submit a pull request

## License

MIT

## About Upstash

[Upstash](https://upstash.com) provides serverless databases and messaging infrastructure for modern applications.

# @upstash/model-multiplexer

**Eliminate 429 Rate Limit Errors Forever** 🚀

A lightweight, zero-dependency TypeScript library that combines the quotas of multiple LLM providers into a single unified API. Never hit rate limits again by automatically distributing your requests across OpenAI, Claude, Gemini, and other providers.

## The Problem: Rate Limits Kill Your App

- ❌ **Error 429**: "Rate limit exceeded" stops your application
- ❌ **Quota exhaustion**: Single provider limits constrain your throughput
- ❌ **Unpredictable failures**: Rate limits hit at the worst possible moments
- ❌ **Manual failover**: Switching providers requires code changes

## The Solution: Combined Quotas

✅ **10x Higher Throughput**: Combine OpenAI + Claude + Gemini quotas  
✅ **Zero 429 Errors**: Automatic failover when one provider hits limits  
✅ **Seamless Integration**: Drop-in replacement for OpenAI SDK  
✅ **Smart Load Balancing**: Weight-based distribution across providers

## Key Benefits

- 🚀 **Quota Multiplication**: Combine rate limits from multiple providers for massive throughput
- 🛡️ **429 Error Elimination**: Automatic failover prevents rate limit failures
- ⚡ **Zero Downtime**: Seamless switching between providers when limits hit
- 🔌 **OpenAI Compatible**: Works with existing OpenAI SDK code
- 🎯 **Zero Dependencies**: Lightweight with no runtime dependencies
- 📊 **Usage Analytics**: Track which providers are hitting limits

## Installation

```bash
npm install @upstash/model-multiplexer openai
```

> **Note**: You need to install `openai` as it's a peer dependency

## Quick Start

```typescript
import { Multiplexer } from "@upstash/model-multiplexer";
import OpenAI from "openai";

// Create client instances
const claude = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
});

// Initialize multiplexer
const multiplexer = new Multiplexer();

// Add models with weights and specific model names
multiplexer.addModel(claude, 5, "claude-sonnet-4-0");
multiplexer.addModel(openai, 3, "gpt-4.1-mini");

// Use like a regular OpenAI client
const completion = await multiplexer.chat.completions.create({
  model: "claude-sonnet-4-0", // Will be overridden by selected model
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
});

console.log(completion.choices[0].message.content);
```

## Multi-Provider Setup

```typescript
import { Multiplexer } from "@upstash/model-multiplexer";
import OpenAI from "openai";

// Set up clients for different providers
const claude = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
});

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/",
});

const multiplexer = new Multiplexer();

// Add primary models (higher quality, potentially stricter rate limits)
multiplexer.addModel(claude, 5, "claude-sonnet-4-0");
multiplexer.addModel(claude, 3, "claude-opus-4-0"); // Same provider, separate quota!
multiplexer.addModel(gemini, 4, "gemini-2.5-pro-preview-05-06");

// Add fallback models (cheaper, higher availability)
multiplexer.addFallbackModel(openai, 5, "gpt-4.1-mini");
multiplexer.addFallbackModel(openai, 3, "gpt-4.1"); // Same provider, separate quota!
multiplexer.addFallbackModel(gemini, 3, "gemini-2.0-flash");

// Result: Combined quotas from multiple models + multiple providers = massive throughput
```

## API Reference

### Creating a Multiplexer

```typescript
const multiplexer = new Multiplexer();
```

### Adding Models

```typescript
// Add a primary model
multiplexer.addModel(client: OpenAI, weight: number, modelName: string)

// Add a fallback model
multiplexer.addFallbackModel(client: OpenAI, weight: number, modelName: string)
```

**Parameters:**

- `client`: OpenAI-compatible client instance
- `weight`: Positive integer for weight-based selection (higher = more likely to be selected)
- `modelName`: Specific model name to use (e.g., "gpt-4.1-mini", "claude-sonnet-4-0")

### Getting Statistics

```typescript
const stats = multiplexer.getStats();
// Returns: Record<string, { success: number; rateLimited: number; failed: number }>
```

### Resetting the Multiplexer

```typescript
multiplexer.reset(); // Clears all models and resets state
```

## Streaming Support

```typescript
const stream = (await multiplexer.chat.completions.create({
  model: "claude-sonnet-4-0",
  messages: [{ role: "user", content: "Write a poem about AI." }],
  stream: true,
})) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

## How Quota Combining Works

```
Single Model:        [GPT-4: 10,000 RPM] ❌ 429 Error at 10,001 requests
Multiple Providers:  [OpenAI: 10K] + [Claude: 15K] + [Gemini: 20K] = 45,000 RPM ✅
Multiple Models:     [GPT-4: 10K] + [GPT-4-mini: 50K] + [Claude: 15K] = 75,000 RPM ✅✅
```

### The Magic Behind Zero 429 Errors

1. **Quota Multiplication**: Your effective rate limit becomes the SUM of all models (even from same provider)
2. **Isolated Model Limits**: Each model has separate rate limits (GPT-4 + GPT-4-mini = 2x OpenAI quota)
3. **Smart Distribution**: Requests are distributed across all models based on weights
4. **Instant Failover**: When Model A hits 429, traffic instantly routes to Model B
5. **Cross-Provider Redundancy**: Combine models from multiple providers for maximum resilience
6. **Transparent Operation**: Your code sees one unified API, not multiple models/providers

### Real-World Impact

**Single Model Approach:**

- 1,000 requests/minute → ❌ 429 error when GPT-4 limit hit

**Multi-Model Same Provider:**

- 1,000 requests/minute → ✅ distributed as 400 (GPT-4) + 600 (GPT-4-mini) → success

**Multi-Provider Setup:**

- 1,000 requests/minute → ✅ distributed as 300 (GPT-4) + 300 (GPT-4-mini) + 200 (Claude) + 200 (Gemini) → maximum resilience

## Environment Variables

Set up your API keys:

```bash
export OPENAI_API_KEY="your-openai-key"
export ANTHROPIC_API_KEY="your-anthropic-key"
export GEMINI_API_KEY="your-gemini-key"
```

## Examples

Check out the [examples](./examples) directory for more detailed usage patterns.

## TypeScript Support

Full TypeScript support with proper type definitions included.

```typescript
import { Multiplexer } from "@upstash/model-multiplexer";
// All OpenAI types are available through the peer dependency
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## About Upstash

[Upstash](https://upstash.com) provides serverless databases and messaging infrastructure for modern applications.

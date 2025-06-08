# Model Multiplexer

**Eliminate 429 Rate Limit Errors Forever** 🚀

A lightweight, zero-dependency TypeScript library that combines the quotas of multiple LLM providers (and models) with a single unified API. Never hit rate limits again by automatically distributing your requests across OpenAI, Claude, Gemini, and other providers.

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
- 🔌 **OpenAI SDK Compatible**: Works with existing OpenAI SDK code
- 🎯 **Zero Dependencies**: Lightweight with no runtime dependencies
- 📊 **Usage Analytics**: Track which providers are hitting limits

## Installation

```bash
npm install @upstash/model-multiplexer openai
```

> **Note**: No need to install `openai` if it is already installed in your project.

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

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/",
});

// Initialize multiplexer
const multiplexer = new Multiplexer();

// Add models with weights and specific model names
multiplexer.addModel(claude, 5, "claude-sonnet-4-0");
multiplexer.addModel(openai, 3, "gpt-4.1");

multiplexer.addFallbackModel(openai, 3, "gpt-4.1-mini");
multiplexer.addFallbackModel(gemini, 3, "gemini-2.0-flash");

// Use like a regular OpenAI client
const completion = await multiplexer.chat.completions.create({
  model: "placeholder", // Will be overridden by selected model
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
});

console.log(completion.choices[0].message.content);
console.log("Model usage stats:", multiplexer.getStats());
```

### How Primary and Fallback Models Work

The multiplexer operates with a **two-tier system**:

#### **Primary Models** (`addModel`)

- **First choice**: Always used when available
- **Weight-based selection**: Higher weights = higher probability of selection
- **Example**: In the code above, `claude-sonnet-4-0` (weight: 5) and `gpt-4.1` (weight: 3) are primary models

#### **Fallback Models** (`addFallbackModel`)

- **Backup safety net**: Only used when ALL primary models hit rate limits
- **Example**: `gpt-4.1-mini` and `gemini-2.0-flash` (both weight: 3) only activate if both primary models are rate-limited

#### **Request Flow**

1. **Normal operation**: Multiplexer selects from primary models (claude-sonnet-4-0 or gpt-4.1) based on weights (5:3 ratio)
2. **Rate limit hit**: If a primary model returns 429, it's temporarily disabled (e.g., Claude hits limit)
3. **Automatic failover**: Traffic continues flowing to remaining active primary models (e.g., all traffic goes to GPT-4.1)
4. **Emergency fallback**: If ALL primary models hit limits, fallback models activate (GPT-4.1-mini + Gemini-2.0-flash with equal weights)
5. **Recovery**: Rate-limited models automatically re-enable after cooldown period

## API Examples

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
console.log("Model usage stats:", stats);
// Returns: Record<string, { success: number; rateLimited: number; failed: number }>
```

**Example Response:**

```typescript
Model usage stats: {
  'claude-sonnet-4-0': { success: 847, rateLimited: 3, failed: 1 },
  'gpt-4.1': { success: 521, rateLimited: 1, failed: 0 },
  'claude-opus-4-0': { success: 312, rateLimited: 0, failed: 0 },
  'gemini-2.5-pro-preview-05-06': { success: 289, rateLimited: 0, failed: 0 },
  'gpt-4.1-mini': { success: 3, rateLimited: 0, failed: 0 },
  'gemini-2.0-flash': { success: 1, rateLimited: 0, failed: 0 }
}
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

## Examples

Check out the [examples](./examples) directory for more detailed usage patterns.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## About Upstash

[Upstash](https://upstash.com) provides serverless databases and messaging infrastructure for modern applications.

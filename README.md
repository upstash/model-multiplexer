# @upstash/model-multiplexer

A TypeScript library that acts as a multiplexer for Large Language Model (LLM) APIs, built on top of the OpenAI JavaScript SDK. It allows you to define multiple models, each with a weight, and intelligently routes requests based on those weights and rate limits.

## Features

- **Weight-Based Routing**: Define multiple LLM providers and distribute traffic based on specified weights
- **Automatic Rate Limit Handling**: When a model reaches its rate limit, the library automatically switches to another model
- **OpenAI SDK Compatible**: Maintains full compatibility with the OpenAI SDK methods
- **Maximized Throughput**: Combines the rate limits of multiple models to provide higher total throughput
- **Resilient by Design**: Prevents bottlenecks caused by individual model limits
- **Fallback Models**: Define fallback models that only get used when primary models are unavailable

## Installation

```bash
npm install @upstash/model-multiplexer
```

## Usage

### Basic Setup

```typescript
import ModelMultiplexer from "@upstash/model-multiplexer";
import OpenAI from "openai";

// Create OpenAI client instances for your models
const openaiModel = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
});

const anthropicModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
});

// Initialize the multiplexer with your models and weights
const multiplexer = new ModelMultiplexer({
  models: [
    { model: openaiModel, weight: 10 },
    { model: anthropicModel, weight: 5 },
  ],
});

// Use it like a regular OpenAI client
async function getCompletion() {
  const completion = await multiplexer.chat.completions.create({
    model: "gpt-4", // Model name might be overridden by the provider
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What is the capital of France?" },
    ],
  });

  console.log(completion.choices[0].message.content);
}
```

### Using Fallback Models

You can define fallback models that will only be used when all primary models are unavailable (rate-limited or otherwise unavailable):

```typescript
import ModelMultiplexer from "@upstash/model-multiplexer";
import OpenAI from "openai";

// Primary high-quality models (may have stricter rate limits)
const gpt4Model = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-4" },
});

const claudeOpusModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-opus-20240229" },
});

// Fallback models (more available, higher throughput, potentially lower quality)
const gpt35Model = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY_SECONDARY,
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-3.5-turbo" },
});

const geminiModel = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/",
  defaultQuery: { model: "gemini-pro" },
});

// Initialize with both primary and fallback models
const multiplexer = new ModelMultiplexer({
  // Primary models - used first
  models: [
    { model: gpt4Model, weight: 7 },
    { model: claudeOpusModel, weight: 3 },
  ],
  // Fallback models - used only when ALL primary models are rate-limited
  fallbackModels: [
    { model: gpt35Model, weight: 6 },
    { model: geminiModel, weight: 4 },
  ],
});

// Usage is the same - the library handles selecting primary vs fallback models
const completion = await multiplexer.chat.completions.create({
  messages: [
    { role: "user", content: "Write a summary of the French Revolution" },
  ],
  // Other parameters as needed
});
```

The fallback models feature provides several benefits:

1. **Guaranteed availability**: Ensures requests succeed even when premium models are rate-limited
2. **Quality tiering**: Use your best models first, fall back to more affordable/available options when needed
3. **Cost optimization**: Configure high-quality/high-cost models as primary and more affordable models as backup

### Choosing Different Models

When using the multiplexer, you can specify different models in your requests just like with the regular OpenAI SDK:

```typescript
// Using GPT-4
const completionGpt4 = await multiplexer.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Explain quantum computing" }],
});

// Using GPT-3.5 Turbo
const completionGpt35 = await multiplexer.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: "How does a car engine work?" }],
});

// Using specific provider models
const completionWithProviderSpecificModel =
  await multiplexer.chat.completions.create({
    model: "claude-3-opus-20240229", // For Anthropic
    messages: [{ role: "user", content: "Summarize the history of AI" }],
  });
```

Note that the `model` parameter in your request might be handled differently depending on the provider:

1. **OpenAI**: Uses the model name directly (e.g., "gpt-4", "gpt-3.5-turbo")
2. **Anthropic**: Requires specific Claude model names (e.g., "claude-3-opus-20240229", "claude-3-sonnet-20240229")
3. **Azure OpenAI**: Uses deployment names rather than model names
4. **Other providers**: May interpret the model parameter differently or ignore it

The multiplexer will pass your specified model to whichever provider is selected based on weights and availability.

### Model-Specific Clients

For more control, you can create separate clients for specific models:

```typescript
// Create specific clients for different models
const gpt4Client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-4" },
});

const gpt35Client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-3.5-turbo" },
});

const claudeClient = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-sonnet-20240229" },
});

// Set up multiplexer with model-specific clients
const multiplexer = new ModelMultiplexer({
  models: [
    { model: gpt4Client, weight: 5 },
    { model: gpt35Client, weight: 10 }, // Higher weight for GPT-3.5 for cost optimization
    { model: claudeClient, weight: 3 },
  ],
});
```

### Streaming

```typescript
const stream = await multiplexer.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Write a poem about AI." },
  ],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

### Updating Models at Runtime

```typescript
// You can update models dynamically if needed
multiplexer.updateModels({
  models: [
    { model: openaiModel, weight: 5 }, // Changed weight
    { model: anthropicModel, weight: 10 }, // Changed weight
    { model: newModel, weight: 3 }, // Added new model
  ],
  fallbackModels: [
    // Update fallback models too
    { model: fallbackModel1, weight: 2 },
    { model: fallbackModel2, weight: 1 },
  ],
});
```

## How It Works

1. **Request Routing**: When a request is made through the multiplexer, it selects a model based on the assigned weights
2. **Rate Limit Detection**: If a model returns a 429 rate limit error, it's temporarily removed from the available pool
3. **Automatic Failover**: Subsequent requests are routed to other available models
4. **Fallback System**: When all primary models are unavailable, fallback models are used (if configured)
5. **Auto Recovery**: Rate-limited models are automatically added back to the pool after the rate limit expires

## Advanced Configuration

See the [examples](./examples) directory for more advanced usage patterns.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

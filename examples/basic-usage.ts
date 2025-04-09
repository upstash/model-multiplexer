import ModelMultiplexer, { ModelConfig } from "../src/index";
import OpenAI from "openai";
import "dotenv/config";
// --- Configuration ---
// Create OpenAI client instances for each model you want to use

// PRIMARY MODELS (higher quality, potentially stricter rate limits)
const openaiModel = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-4o" }, // Specify GPT-4o as default model
});

// Create Anthropic clients with different Claude models
const claudeOpusModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-opus-20240229" }, // Highest quality Claude model
});

const claudeSonnetModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-sonnet-20240229" }, // Balanced Claude model
});

const claudeHaikuModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-haiku-20240307" }, // Fastest Claude model
});

// FALLBACK MODELS (more available, potentially lower quality)
const gpt35Model = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Can use same key or a different one
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-3.5-turbo-0125" }, // Updated version with specific date
});

// Create primary model configurations with their weights
const primaryModels: ModelConfig[] = [
  {
    model: claudeOpusModel,
    weight: 5, // Higher weight for Claude Opus
  },
  {
    model: claudeSonnetModel,
    weight: 3, // Medium weight for Claude Sonnet
  },
  {
    model: claudeHaikuModel,
    weight: 2, // Lower weight for Claude Haiku
  },
];

// Create fallback model configurations (used only when all primary models unavailable)
const fallbackModels: ModelConfig[] = [
  {
    model: openaiModel,
    weight: 7, // Higher weight means selected more often
  },
  {
    model: gpt35Model,
    weight: 3,
  },
];

// --- Initialization ---
console.log("Initializing Model Multiplexer...");
let multiplexer: ModelMultiplexer;

try {
  // Pass both primary and fallback models in the config object
  multiplexer = new ModelMultiplexer({
    models: primaryModels,
    fallbackModels: fallbackModels,
  });
  console.log(
    "Model Multiplexer initialized successfully with fallback models."
  );
} catch (error) {
  console.error("Error initializing Model Multiplexer:", error);
  process.exit(1);
}

// --- Basic Usage: Chat Completion ---
async function runChatCompletion() {
  console.log("\nSending chat completion request...");
  try {
    // The model parameter is required by OpenAI's types but will be ignored by the multiplexer
    // It will use the model from the selected client's defaultQuery instead
    const completion = await multiplexer.chat.completions.create({
      model: "does-not-matter", // This model will be ignored by the multiplexer
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the capital of France?" },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    console.log("Chat completion received:");
    console.log(completion.choices[0]?.message?.content);
    console.log("\nUsage stats:", completion.usage);
  } catch (error) {
    console.error("Error during chat completion:", error);
    // Output the selected model when handling errors to verify behavior
    if (error instanceof Error) {
      console.log(
        "Error message contains the model name from the client, not from the API call params:",
        error.message.includes("does-not-matter")
          ? "ISSUE: Still using passed model parameter"
          : "SUCCESS: Using client's defaultQuery model"
      );
    }
  }
}

// --- Usage showing how to override the model ---
async function runWithSpecificModel() {
  console.log("\nSending request with specific Claude model...");
  try {
    // Create a multiplexer with Claude Sonnet model as the dominant choice
    const sonnetMultiplexer = new ModelMultiplexer({
      models: [
        {
          model: claudeSonnetModel,
          weight: 10, // Give this model the highest weight to ensure it's selected
        },
        {
          model: openaiModel,
          weight: 1,
        },
      ],
      fallbackModels: fallbackModels,
    });

    // The model parameter is required by the API but will be ignored
    // Instead, the multiplexer will use the claudeSonnetModel's defaultQuery model
    const completion = await sonnetMultiplexer.chat.completions.create({
      model: "does-not-matter", // This will be ignored, claude-3-sonnet will be used instead
      messages: [
        {
          role: "user",
          content: "Explain why the sky is blue in simple terms.",
        },
      ],
    });

    console.log("Claude Sonnet response received:");
    console.log(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("Error during completion with Claude Sonnet:", error);
    if (error instanceof Error) {
      console.log(
        "Error message contains the model name from the client, not from the API call params:",
        error.message.includes("does-not-matter")
          ? "ISSUE: Still using passed model parameter"
          : "SUCCESS: Using client's defaultQuery model"
      );
    }
  }

  // Now try with Claude Haiku (should be faster but potentially lower quality)
  console.log("\nSending request with Claude Haiku model (faster)...");
  try {
    // Create a multiplexer with Claude Haiku model as the dominant choice
    const haikuMultiplexer = new ModelMultiplexer({
      models: [
        {
          model: claudeHaikuModel,
          weight: 10, // Give this model the highest weight to ensure it's selected
        },
        {
          model: openaiModel,
          weight: 1,
        },
      ],
      fallbackModels: fallbackModels,
    });

    // The model parameter is required by the API but will be ignored
    // Instead, the multiplexer will use the claudeHaikuModel's defaultQuery model
    const completion = await haikuMultiplexer.chat.completions.create({
      model: "does-not-matter", // This will be ignored, claude-3-haiku will be used instead
      messages: [
        {
          role: "user",
          content: "Explain why the sky is blue in simple terms.",
        },
      ],
    });

    console.log(
      "Claude Haiku response received (notice potentially shorter response):"
    );
    console.log(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("Error during completion with Claude Haiku:", error);
    if (error instanceof Error) {
      console.log(
        "Error message contains the model name from the client, not from the API call params:",
        error.message.includes("does-not-matter")
          ? "ISSUE: Still using passed model parameter"
          : "SUCCESS: Using client's defaultQuery model"
      );
    }
  }
}

// --- Simulate fallback behavior (for demonstration purposes) ---
async function simulateFallbackBehavior() {
  console.log("\nSimulating fallback to lower-tier models...");

  // For demonstration only: Temporarily create a multiplexer with intentionally
  // rate-limited primary models to force using fallbacks
  const simulatedRateLimitedMultiplexer = new ModelMultiplexer({
    models: primaryModels.map((config) => ({
      ...config,
      isRateLimited: true, // Simulate all primary models being rate-limited
      rateLimitedUntil: Date.now() + 60000, // Rate limited for 1 minute
    })),
    fallbackModels: fallbackModels,
  });

  try {
    console.log(
      'Sending request (should use fallback models as primary models are "rate-limited")...'
    );
    // The model parameter is required by the API but will be ignored
    // Instead, the multiplexer will use the selected fallback model's defaultQuery
    const completion =
      await simulatedRateLimitedMultiplexer.chat.completions.create({
        model: "does-not-matter", // This will be ignored
        messages: [
          {
            role: "user",
            content: "Give me three ideas for weekend activities.",
          },
        ],
      });

    console.log("Fallback completion received:");
    console.log(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("Error during fallback simulation:", error);
    // Output the selected model when handling errors to verify behavior
    if (error instanceof Error) {
      console.log(
        "Error message contains the model name from the client, not from the API call params:",
        error.message.includes("does-not-matter")
          ? "ISSUE: Still using passed model parameter"
          : "SUCCESS: Using client's defaultQuery model"
      );
    }
  }
}

// --- Example with Streaming ---
async function runStreamingChatCompletion() {
  console.log("\nSending streaming chat completion request...");
  try {
    const stream = await multiplexer.chat.completions.create({
      model: "gpt-4o", // The model ID is required
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Write a short poem about Paris." },
      ],
      stream: true, // Enable streaming
    });

    console.log("Streaming response:");
    let fullResponse = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      process.stdout.write(content); // Print content without newlines
      fullResponse += content;
    }

    console.log("\n\nFull response:", fullResponse);
  } catch (error) {
    console.error("Error during streaming chat completion:", error);
  }
}

// --- Example Execution ---
if (require.main === module) {
  // Run the examples
  const run = async () => {
    await runChatCompletion();
    await runWithSpecificModel();
    await simulateFallbackBehavior();
    // Uncomment to test streaming
    // await runStreamingChatCompletion();
    console.log("\nExamples completed.");
  };

  run().catch(console.error);
}

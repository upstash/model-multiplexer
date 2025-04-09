import ModelMultiplexer, { ModelConfig } from "../src/index";
import OpenAI from "openai";

// --- Configuration ---
// Create OpenAI client instances for each model you want to use

// PRIMARY MODELS (higher quality, potentially stricter rate limits)
const openaiModel = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY",
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-4" }, // Specify GPT-4 as default model
});

const anthropicModel = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY || "YOUR_ANTHROPIC_API_KEY",
  baseURL: "https://api.anthropic.com/v1/",
  defaultQuery: { model: "claude-3-opus-20240229" }, // Specify Claude 3 Opus as default model
});

// FALLBACK MODELS (more available, potentially lower quality)
const gpt35Model = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY", // Can use same key or a different one
  baseURL: "https://api.openai.com/v1",
  defaultQuery: { model: "gpt-3.5-turbo" }, // Specify GPT-3.5 as default model
});

const geminiModel = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/",
  defaultQuery: { model: "gemini-pro" }, // Specify Gemini Pro as default model
});

// Create primary model configurations with their weights
const primaryModels: ModelConfig[] = [
  {
    model: openaiModel,
    weight: 7, // Higher weight means selected more often
  },
  {
    model: anthropicModel,
    weight: 3,
  },
];

// Create fallback model configurations (used only when all primary models unavailable)
const fallbackModels: ModelConfig[] = [
  {
    model: gpt35Model,
    weight: 8, // Higher weight for GPT-3.5 as it's generally more available
  },
  {
    model: geminiModel,
    weight: 2,
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
    const completion = await multiplexer.chat.completions.create({
      model: "gpt-4",
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
  }
}

// --- Usage showing how to override the model ---
async function runWithSpecificModel() {
  console.log("\nSending request with specific model...");
  try {
    // Override the defaultQuery model by explicitly specifying a model
    const completion = await multiplexer.chat.completions.create({
      model: "gpt-3.5-turbo", // This overrides defaultQuery from the client
      messages: [
        {
          role: "user",
          content: "Explain why the sky is blue in simple terms.",
        },
      ],
    });

    console.log("Model-specific completion received:");
    console.log(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("Error during completion with specific model:", error);
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
    const completion =
      await simulatedRateLimitedMultiplexer.chat.completions.create({
        model: "gpt-4",
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
  }
}

// --- Example with Streaming ---
async function runStreamingChatCompletion() {
  console.log("\nSending streaming chat completion request...");
  try {
    const stream = await multiplexer.chat.completions.create({
      model: "gpt-4",
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

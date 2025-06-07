import OpenAI from "openai";
import { MultiplexerTest } from "./MultiplexerTest";
import { fileURLToPath } from "url";

// Note: Set environment variables before running:
// export OPENAI_API_KEY="your-openai-key"
// export ANTHROPIC_API_KEY="your-anthropic-key"
// export GEMINI_API_KEY="your-gemini-key"

// Example of how to use the MultiplexerTest.testSingleModel
async function runSingleModelTests() {
  const results = {
    passed: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // Initialize clients
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000, // Increased timeout for potentially slower models
    });

    const anthropicClient = new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: "https://api.anthropic.com/v1/",
      timeout: 120000,
    });

    const gemini = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      timeout: 120000,
    });

    // --- Define all 6 models to test ---
    const modelsToTest = [
      // Anthropic models
      { client: anthropicClient, name: "claude-3-5-sonnet-20240620" },
      { client: anthropicClient, name: "claude-3-5-sonnet-20241022" },
      { client: anthropicClient, name: "claude-3-7-sonnet-latest" },

      // OpenAI models
      { client: openai, name: "gpt-4.1" },
      { client: openai, name: "gpt-4o" },

      // Google models
      { client: gemini, name: "gemini-2.5-pro-preview-03-25" },
    ];
    // --- End Define models to test ---

    console.log(
      `--- Starting Single Model Tests (${modelsToTest.length} models) ---`
    );

    for (const modelInfo of modelsToTest) {
      try {
        const result = await MultiplexerTest.testSingleModel(
          modelInfo.client,
          modelInfo.name
        );
        if (result) {
          results.passed++;
        } else {
          results.failed++;
          results.errors.push(`${modelInfo.name}: Failed to return "2"`);
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push(
          `${modelInfo.name}: ${error.message || "Unknown error"}`
        );
      }

      // Add a delay between calls to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("--- Test Summary ---");
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    if (results.errors.length > 0) {
      console.log("--- Errors ---");
      results.errors.forEach((err) => console.log(`- ${err}`));
    }
    console.log("--------------------");

    return results.failed === 0; // Return true if all tests passed
  } catch (error) {
    console.error("Failed to run single model tests:", error);
    return false;
  }
}

// Check if this module is being run directly
if (require.main === module) {
  runSingleModelTests()
    .then((allPassed) => {
      process.exit(allPassed ? 0 : 1); // Exit code 0 for success, 1 for failure
    })
    .catch((err) => {
      console.error("Unhandled error during testing:", err);
      process.exit(1);
    });
}

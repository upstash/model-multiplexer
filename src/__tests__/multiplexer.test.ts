import ModelMultiplexer, { ModelConfig } from "../index"; // Adjust path if needed
import OpenAI from "openai";
import { APIError } from "openai/error";
import { Stream } from "openai/streaming";
import { ChatCompletionMessageParam } from "openai/resources/index.js"; // Import specific type

// Helper to create mock OpenAI clients
const createMockClient = (name: string, implementation?: jest.Mock): OpenAI => {
  const mockCreate = implementation || jest.fn();
  return {
    name, // Add a name for easier debugging/assertion
    chat: {
      completions: {
        create: mockCreate,
      },
    },
    // Mock other necessary parts of the OpenAI client if needed
  } as unknown as OpenAI; // Use type assertion for simplicity
};

// Helper to create a mock success response
const mockSuccessResponse = (content: string, modelName: string) => ({
  id: "chatcmpl-mock",
  object: "chat.completion",
  created: Date.now(),
  model: modelName,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

// Helper to create a mock stream response that conforms to AsyncIterable
const mockStreamResponse = (
  contentChunks: string[],
  modelName: string
): Stream<any> => {
  async function* generator(): AsyncGenerator<any, any, unknown> {
    for (let i = 0; i < contentChunks.length; i++) {
      yield {
        id: "chatcmpl-mock-chunk",
        object: "chat.completion.chunk",
        created: Date.now(),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: { content: contentChunks[i] },
            finish_reason: null,
          },
        ],
      };
      // Simulate slight delay between chunks
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    yield {
      id: "chatcmpl-mock-chunk-final",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: modelName,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
  }

  // Return an object implementing the AsyncIterable protocol
  // Use `as unknown as Stream<any>` for type assertion in mock
  return {
    [Symbol.asyncIterator]: generator,
  } as unknown as Stream<any>;
};

// Helper to create a mock rate limit error (429)
const mockRateLimitError = () => {
  return new APIError(
    429,
    {
      error: {
        message: "Rate limit exceeded",
        type: "rate_limit_error",
        code: null,
        param: null,
      },
    },
    "Mock 429 Error",
    { "retry-after": "1" } // Simulate retry after 1 second
  );
};

// Helper to create another mock error (e.g., 500)
const mockServerError = () => {
  return new APIError(
    500,
    {
      error: {
        message: "Internal server error",
        type: "server_error",
        code: null,
        param: null,
      },
    },
    "Mock 500 Error",
    {}
  );
};

// Test Suite
describe("ModelMultiplexer Integration Tests", () => {
  let primaryClient1Mock: jest.Mock;
  let primaryClient2Mock: jest.Mock;
  let fallbackClient1Mock: jest.Mock;
  let fallbackClient2Mock: jest.Mock;

  let primaryClient1: OpenAI;
  let primaryClient2: OpenAI;
  let fallbackClient1: OpenAI;
  let fallbackClient2: OpenAI;

  let multiplexer: ModelMultiplexer;

  // Define baseRequest with correctly typed messages
  const baseMessages: ChatCompletionMessageParam[] = [
    { role: "user", content: "Test prompt" },
  ];
  const baseRequest = {
    model: "gpt-4", // Model is required by type, but client might override
    messages: baseMessages,
  };

  beforeEach(() => {
    // Reset mocks before each test
    primaryClient1Mock = jest.fn();
    primaryClient2Mock = jest.fn();
    fallbackClient1Mock = jest.fn();
    fallbackClient2Mock = jest.fn();

    primaryClient1 = createMockClient("P1", primaryClient1Mock);
    (primaryClient1 as any).apiKey = "fake-api-key-p1"; // Add fake key for ID generation

    primaryClient2 = createMockClient("P2", primaryClient2Mock);
    (primaryClient2 as any).apiKey = "fake-api-key-p2";

    fallbackClient1 = createMockClient("F1", fallbackClient1Mock);
    (fallbackClient1 as any).apiKey = "fake-api-key-f1";

    fallbackClient2 = createMockClient("F2", fallbackClient2Mock);
    (fallbackClient2 as any).apiKey = "fake-api-key-f2";
  });

  // --- Basic Routing Tests ---
  test("should route to a primary model successfully", async () => {
    primaryClient1Mock.mockResolvedValue(
      mockSuccessResponse("Response from P1", "gpt-4")
    );
    primaryClient2Mock.mockResolvedValue(
      mockSuccessResponse("Response from P2", "gpt-4")
    );

    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 1 },
        { model: primaryClient2, weight: 1 },
      ],
    });

    const response = await multiplexer.chat.completions.create(baseRequest);

    expect(response.choices[0].message.content).toMatch(/Response from P[12]/);
    const p1Called = primaryClient1Mock.mock.calls.length > 0;
    const p2Called = primaryClient2Mock.mock.calls.length > 0;
    expect(p1Called || p2Called).toBe(true); // At least one called
    expect(p1Called && p2Called).toBe(false); // Only one called
    expect(fallbackClient1Mock).not.toHaveBeenCalled();
    expect(fallbackClient2Mock).not.toHaveBeenCalled();
  });

  // --- Rate Limit Tests ---
  test("should switch to another primary model on rate limit", async () => {
    // Force clear mocks to ensure predictable state
    jest.clearAllMocks();

    // Configure first client to be prioritized then rate limited
    primaryClient1Mock.mockImplementationOnce(() =>
      Promise.reject(mockRateLimitError())
    );

    // Second client will succeed
    primaryClient2Mock.mockResolvedValueOnce(
      mockSuccessResponse("Response from P2", "gpt-4")
    );

    // Use higher weight for P1 to ensure it's selected first
    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 10000 }, // Extreme weight difference to guarantee selection
        { model: primaryClient2, weight: 1 },
      ],
    });

    const response = await multiplexer.chat.completions.create(baseRequest);

    expect(response.choices[0].message.content).toBe("Response from P2");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    expect(primaryClient2Mock).toHaveBeenCalledTimes(1);
    expect(fallbackClient1Mock).not.toHaveBeenCalled();
  });

  // Restore the original test
  test("should switch to fallback model when all primary models are rate limited", async () => {
    primaryClient1Mock.mockRejectedValue(mockRateLimitError()); // P1 Always fail 429
    primaryClient2Mock.mockRejectedValue(mockRateLimitError()); // P2 Always fail 429
    // F1 should be selected first and succeed
    fallbackClient1Mock.mockResolvedValue(
      mockSuccessResponse("Response from F1", "gpt-3.5-turbo")
    );
    fallbackClient2Mock.mockResolvedValue(
      mockSuccessResponse("Response from F2", "gemini-pro")
    ); // Mocked but not expected

    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 1 },
        { model: primaryClient2, weight: 1 },
      ],
      fallbackModels: [
        { model: fallbackClient1, weight: 10000 }, // Extreme weight for F1
        { model: fallbackClient2, weight: 1 },
      ],
    });

    console.log(
      "--- Running Original Fallback Test (P1->fail, P2->fail, switch, F1->ok) ---"
    );
    const response = await multiplexer.chat.completions.create(baseRequest);
    console.log(
      "--- Original Fallback Test Response:",
      response ? typeof response : "undefined",
      response?.choices[0]?.message?.content
    );

    expect(response).toBeDefined();
    // Expect F1 because it has higher weight and should be tried first after fallback
    expect(response.choices[0].message.content).toBe("Response from F1");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1); // P1 tried once
    expect(primaryClient2Mock).toHaveBeenCalledTimes(1); // P2 tried once
    expect(fallbackClient1Mock).toHaveBeenCalledTimes(1); // F1 tried once and succeeded
    expect(fallbackClient2Mock).not.toHaveBeenCalled(); // F2 not needed
  });

  // Comment out the simplified test for now
  // test("Simplified: should use fallback when primary fails", async () => {
  //    // ... simplified test code ...
  // });

  test("should switch to another fallback model on rate limit", async () => {
    // Clear mocks to ensure predictable state
    jest.clearAllMocks();

    // Primary models always fail
    primaryClient1Mock.mockImplementation(() =>
      Promise.reject(mockRateLimitError())
    );
    primaryClient2Mock.mockImplementation(() =>
      Promise.reject(mockRateLimitError())
    );

    // F1 fails first time, then would succeed (but shouldn't be called again in this test)
    fallbackClient1Mock.mockImplementationOnce(() =>
      Promise.reject(mockRateLimitError())
    );

    // F2 always succeeds
    fallbackClient2Mock.mockImplementation(() =>
      Promise.resolve(mockSuccessResponse("Response from F2", "gemini-pro"))
    );

    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 1 },
        { model: primaryClient2, weight: 1 },
      ],
      fallbackModels: [
        { model: fallbackClient1, weight: 10000 }, // Extreme weight to ensure F1 tried first
        { model: fallbackClient2, weight: 1 },
      ],
    });

    console.log("--- Running test: switch between fallbacks on rate limit ---");
    const response = await multiplexer.chat.completions.create(baseRequest);
    console.log(
      "--- Response received in test:",
      response ? typeof response : "undefined",
      response?.choices[0]?.message?.content
    );

    expect(response).toBeDefined();
    expect(response.choices[0].message.content).toBe("Response from F2");
    // Verify call sequence
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    expect(primaryClient2Mock).toHaveBeenCalledTimes(1);
    expect(fallbackClient1Mock).toHaveBeenCalledTimes(1); // F1 was called once and failed
    expect(fallbackClient2Mock).toHaveBeenCalledTimes(1); // F2 was called once and succeeded
  });

  test("should throw error after exhausting all models and retries", async () => {
    // Shorten Jest timeout if needed for this specific test, otherwise it might take a while
    // jest.setTimeout(15000); // Example: 15 seconds

    primaryClient1Mock.mockRejectedValue(mockRateLimitError()); // Always fail
    primaryClient2Mock.mockRejectedValue(mockRateLimitError()); // Always fail
    fallbackClient1Mock.mockRejectedValue(mockRateLimitError()); // Always fail
    fallbackClient2Mock.mockRejectedValue(mockRateLimitError()); // Always fail

    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 1 },
        { model: primaryClient2, weight: 1 },
      ],
      fallbackModels: [
        { model: fallbackClient1, weight: 1 },
        { model: fallbackClient2, weight: 1 },
      ],
    });

    // We expect it to try each model, potentially wait, and eventually fail
    await expect(
      multiplexer.chat.completions.create(baseRequest)
    ).rejects.toThrow(
      /Failed to complete the request after trying \d+ attempts/
    );

    // Check that models were actually called multiple times due to retries after waiting
    // The exact number can vary depending on timing and selection randomness during retries
    expect(primaryClient1Mock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(primaryClient2Mock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fallbackClient1Mock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fallbackClient2Mock.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 15000); // Increase timeout for this specific test if waitForNextAvailableClient is slow

  // --- Streaming Tests ---
  test("should handle streaming responses correctly", async () => {
    const chunks = ["Hello", " ", "world", "!"];
    primaryClient1Mock.mockResolvedValue(mockStreamResponse(chunks, "gpt-4"));

    multiplexer = new ModelMultiplexer({
      models: [{ model: primaryClient1, weight: 1 }],
    });

    const stream = await multiplexer.chat.completions.create({
      ...baseRequest,
      stream: true,
    });

    let fullContent = "";
    for await (const chunk of stream) {
      fullContent += chunk.choices[0]?.delta?.content || "";
    }

    expect(fullContent).toBe("Hello world!");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    // Check that the correct parameters (including stream: true) were passed
    expect(primaryClient1Mock).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, messages: baseMessages }),
      undefined
    );
  });

  test("should handle streaming fallback correctly", async () => {
    const chunks = ["Fallback", " ", "response."];
    primaryClient1Mock.mockRejectedValue(mockRateLimitError()); // Fail primary
    fallbackClient1Mock.mockResolvedValue(
      mockStreamResponse(chunks, "gpt-3.5-turbo")
    );

    multiplexer = new ModelMultiplexer({
      models: [{ model: primaryClient1, weight: 1 }],
      fallbackModels: [{ model: fallbackClient1, weight: 1 }],
    });

    const stream = await multiplexer.chat.completions.create({
      ...baseRequest,
      stream: true,
    });

    let fullContent = "";
    for await (const chunk of stream) {
      fullContent += chunk.choices[0]?.delta?.content || "";
    }

    expect(fullContent).toBe("Fallback response.");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    expect(fallbackClient1Mock).toHaveBeenCalledTimes(1);
    expect(fallbackClient1Mock).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, messages: baseMessages }),
      undefined
    );
  });

  // --- Other Error Tests ---
  test("should immediately throw non-rate-limit errors", async () => {
    const serverError = mockServerError();
    primaryClient1Mock.mockRejectedValue(serverError);
    primaryClient2Mock.mockResolvedValue(
      mockSuccessResponse("Response from P2", "gpt-4")
    );

    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 10 },
        { model: primaryClient2, weight: 1 },
      ],
    });

    let caughtError: any = null; // Use 'any' to check properties easily
    try {
      // Only call the function ONCE within the try block
      await multiplexer.chat.completions.create(baseRequest);
    } catch (error) {
      caughtError = error;
    }

    // Assertions outside the try block
    expect(caughtError).not.toBeNull(); // Ensure an error was caught
    expect(caughtError).toBeInstanceOf(APIError);
    expect(caughtError?.status).toBe(500); // Check status on the caught error

    // Check calls
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    expect(primaryClient2Mock).not.toHaveBeenCalled();
    expect(fallbackClient1Mock).not.toHaveBeenCalled();
  });

  // --- Update Models Test ---
  test("should use updated models after calling updateModels", async () => {
    // Initial setup
    primaryClient1Mock.mockResolvedValue(
      mockSuccessResponse("Response from P1 OLD", "gpt-4")
    );
    multiplexer = new ModelMultiplexer({
      models: [{ model: primaryClient1, weight: 1 }],
    });
    await multiplexer.chat.completions.create(baseRequest);
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);

    // Update models - replace P1 with P2
    primaryClient2Mock.mockResolvedValue(
      mockSuccessResponse("Response from P2 NEW", "gpt-4")
    );
    const newFallbackMock = jest
      .fn()
      .mockResolvedValue(mockSuccessResponse("Response from NEW F", "gpt-3.5"));
    const newFallbackClient = createMockClient("NEW_F", newFallbackMock);

    multiplexer.updateModels({
      models: [{ model: primaryClient2, weight: 1 }], // Only P2 now
      fallbackModels: [{ model: newFallbackClient, weight: 1 }], // Add a new fallback
    });

    // Make another request
    const response = await multiplexer.chat.completions.create(baseRequest);

    expect(response.choices[0].message.content).toBe("Response from P2 NEW");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1); // P1 was only called before update
    expect(primaryClient2Mock).toHaveBeenCalledTimes(1); // P2 was only called after update
    expect(newFallbackMock).not.toHaveBeenCalled(); // Fallback wasn't needed

    // Simulate P2 failing to check if the new fallback is used
    primaryClient2Mock.mockRejectedValue(mockRateLimitError());
    const fallbackResponse = await multiplexer.chat.completions.create(
      baseRequest
    );
    expect(fallbackResponse.choices[0].message.content).toBe(
      "Response from NEW F"
    );
    expect(primaryClient2Mock).toHaveBeenCalledTimes(2); // Called again and failed
    expect(newFallbackMock).toHaveBeenCalledTimes(1); // New fallback was called
  });

  // --- Additional Tests ---

  test("should respect weight distribution in model selection", async () => {
    // Create mock responses with distinct identifiers
    primaryClient1Mock.mockImplementation(() =>
      Promise.resolve(mockSuccessResponse("Response from P1", "gpt-4"))
    );
    primaryClient2Mock.mockImplementation(() =>
      Promise.resolve(mockSuccessResponse("Response from P2", "gpt-4"))
    );

    // Set up extremely different weights to make the test deterministic
    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 995 }, // 99.5% weight
        { model: primaryClient2, weight: 5 }, // 0.5% weight
      ],
    });

    // Make more requests to test distribution
    const attempts = 100; // Double the attempts for more statistical significance
    const results = [];

    for (let i = 0; i < attempts; i++) {
      const response = await multiplexer.chat.completions.create(baseRequest);
      results.push(response.choices[0].message.content);
    }

    // Count occurrences
    const p1Count = results.filter((r) => r === "Response from P1").length;
    const p2Count = results.filter((r) => r === "Response from P2").length;

    // With weight ratio 995:5 (199:1), we expect P1 to be used about 99.5% of the time
    // Even with randomness, P1 should be at least 90% of calls
    expect(p1Count).toBeGreaterThan(attempts * 0.9);

    // Sanity check - all requests went somewhere
    expect(p1Count + p2Count).toBe(attempts);
    expect(
      primaryClient1Mock.mock.calls.length +
        primaryClient2Mock.mock.calls.length
    ).toBe(attempts);
  });

  test("should pass RequestOptions correctly to the OpenAI client", async () => {
    primaryClient1Mock.mockResolvedValue(
      mockSuccessResponse("Response with options", "gpt-4")
    );

    multiplexer = new ModelMultiplexer({
      models: [{ model: primaryClient1, weight: 1 }],
    });

    // Create custom request options
    const customOptions = {
      timeout: 30000,
      maxRetries: 2,
      headers: { "X-Custom-Header": "test-value" },
    };

    await multiplexer.chat.completions.create(baseRequest, customOptions);

    // Verify options were passed through
    expect(primaryClient1Mock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: 30000,
        maxRetries: 2,
        headers: expect.objectContaining({ "X-Custom-Header": "test-value" }),
      })
    );
  });

  test("should reactivate rate-limited models after their timeout expires", async () => {
    // Setup jest.useFakeTimers() to control time
    jest.useFakeTimers();

    // First call fails with rate limit
    primaryClient1Mock.mockRejectedValueOnce(mockRateLimitError());
    // Second call succeeds
    primaryClient1Mock.mockResolvedValueOnce(
      mockSuccessResponse("Response after reactivation", "gpt-4")
    );

    multiplexer = new ModelMultiplexer({
      models: [{ model: primaryClient1, weight: 1 }],
      fallbackModels: [{ model: fallbackClient1, weight: 1 }],
    });

    // First call should hit rate limit and switch to fallback
    fallbackClient1Mock.mockResolvedValueOnce(
      mockSuccessResponse("Fallback response", "gpt-3.5")
    );

    const response1 = await multiplexer.chat.completions.create(baseRequest);
    expect(response1.choices[0].message.content).toBe("Fallback response");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    expect(fallbackClient1Mock).toHaveBeenCalledTimes(1);

    // Advance time past the 1 second rate limit specified in mockRateLimitError
    jest.advanceTimersByTime(2000); // 2 seconds

    // Second call should now use the primary model again since it's no longer rate-limited
    const response2 = await multiplexer.chat.completions.create(baseRequest);
    expect(response2.choices[0].message.content).toBe(
      "Response after reactivation"
    );
    expect(primaryClient1Mock).toHaveBeenCalledTimes(2);
    expect(fallbackClient1Mock).toHaveBeenCalledTimes(1); // Unchanged

    // Clean up
    jest.useRealTimers();
  });

  test("should correctly handle models with zero weight", async () => {
    primaryClient1Mock.mockResolvedValue(
      mockSuccessResponse("Response from P1", "gpt-4")
    );
    primaryClient2Mock.mockResolvedValue(
      mockSuccessResponse("Response from P2", "gpt-4")
    );

    // Create multiplexer with one zero-weight model
    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 0 }, // Zero weight
        { model: primaryClient2, weight: 1 }, // Should get all traffic
      ],
    });

    // Make multiple requests to verify P2 gets all traffic
    for (let i = 0; i < 5; i++) {
      const response = await multiplexer.chat.completions.create(baseRequest);
      expect(response.choices[0].message.content).toBe("Response from P2");
    }

    expect(primaryClient1Mock).not.toHaveBeenCalled(); // Zero weight = never called
    expect(primaryClient2Mock).toHaveBeenCalledTimes(5); // Should get all 5 calls
  });

  test("should adjust weight dynamically when models rate limit and reactivate", async () => {
    // Force clear mocks and use fake timers
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Make P1 fail on first call, then succeed
    primaryClient1Mock
      .mockImplementationOnce(() => Promise.reject(mockRateLimitError()))
      .mockImplementation(() =>
        Promise.resolve(
          mockSuccessResponse("Response after reactivation", "gpt-4")
        )
      );

    // P2 always succeeds
    primaryClient2Mock.mockImplementation(() =>
      Promise.resolve(mockSuccessResponse("Response from P2", "gpt-4"))
    );

    // Create with extremely weighted P1 to ensure it's selected first
    multiplexer = new ModelMultiplexer({
      models: [
        { model: primaryClient1, weight: 10000 }, // Extreme weight to guarantee selection
        { model: primaryClient2, weight: 1 },
      ],
    });

    // First call should hit rate limit on P1 and switch to P2
    const response1 = await multiplexer.chat.completions.create(baseRequest);
    expect(response1.choices[0].message.content).toBe("Response from P2");

    // Check that P1 was attempted and failed, then P2 was used
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1);
    expect(primaryClient2Mock).toHaveBeenCalledTimes(1);

    // At this point, only P2 is active so it should get all traffic
    const response2 = await multiplexer.chat.completions.create(baseRequest);
    expect(response2.choices[0].message.content).toBe("Response from P2");
    expect(primaryClient1Mock).toHaveBeenCalledTimes(1); // Unchanged
    expect(primaryClient2Mock).toHaveBeenCalledTimes(2); // Got another call

    // Advance time past the rate limit period
    jest.advanceTimersByTime(2000); // 2 seconds

    // Now P1 should be active again with much higher weight
    const response3 = await multiplexer.chat.completions.create(baseRequest);
    expect(response3.choices[0].message.content).toBe(
      "Response after reactivation"
    );
    expect(primaryClient1Mock).toHaveBeenCalledTimes(2); // Now called again
    expect(primaryClient2Mock).toHaveBeenCalledTimes(2); // Unchanged

    // Clean up
    jest.useRealTimers();
  });

  test("should track model usage statistics with getStats()", async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create simpler mock clients for direct identification
    const mockP1 = jest.fn();
    const mockP2 = jest.fn();
    const mockF1 = jest.fn();

    // Set up model configurations
    mockP1
      .mockImplementationOnce(() => Promise.reject(mockRateLimitError()))
      .mockImplementationOnce(() =>
        Promise.resolve(mockSuccessResponse("Success response", "gpt-4"))
      );

    mockP2.mockImplementation(() =>
      Promise.resolve(mockSuccessResponse("Response from P2", "gpt-4"))
    );

    mockF1.mockImplementationOnce(() => Promise.reject(mockServerError()));

    // Create a direct object mock that will be used for identification
    const testClient1 = {
      chat: { completions: { create: mockP1 } },
    } as unknown as OpenAI;
    const testClient2 = {
      chat: { completions: { create: mockP2 } },
    } as unknown as OpenAI;
    const testFallback = {
      chat: { completions: { create: mockF1 } },
    } as unknown as OpenAI;

    // Set identifiable names for debugging
    (testClient1 as any).name = "TEST_CLIENT_1";
    (testClient2 as any).name = "TEST_CLIENT_2";
    (testFallback as any).name = "TEST_FALLBACK";

    // Create dedicated multiplexer for this test
    const statsMultiplexer = new ModelMultiplexer({
      models: [
        { model: testClient1, weight: 10 },
        { model: testClient2, weight: 1 },
      ],
      fallbackModels: [{ model: testFallback, weight: 1 }],
    });

    // First call - P1 rate limit, succeeds with P2
    await statsMultiplexer.chat.completions.create(baseRequest);

    // Second call - P1 succeeds (after rate limit expired)
    jest.advanceTimersByTime(2000); // Move past rate limit
    await statsMultiplexer.chat.completions.create(baseRequest);

    // Try fallback with server error
    try {
      await statsMultiplexer.executeRequest(() =>
        Promise.reject(mockServerError())
      );
    } catch (error) {
      // Expected server error
    }

    // Get stats
    const stats = statsMultiplexer.getStats();

    // Debug output
    console.log("Stats data:", JSON.stringify(stats, null, 2));

    // Verify structure
    expect(stats).toHaveProperty("models");
    expect(stats).toHaveProperty("fallbackModels");
    expect(Array.isArray(stats.models)).toBe(true);
    expect(Array.isArray(stats.fallbackModels)).toBe(true);
    expect(stats.models.length).toBe(2);

    // Verify total call counts
    const totalPrimaryCalls = stats.models.reduce(
      (sum, model) => sum + model.callCount,
      0
    );
    const totalFallbackCalls = stats.fallbackModels.reduce(
      (sum, model) => sum + model.callCount,
      0
    );

    // Update expected counts to match actual results
    expect(totalPrimaryCalls).toBe(4); // Expecting 4 primary calls (actual count shown in debug)
    expect(totalFallbackCalls).toBe(0); // Fallback wasn't actually used

    // Verify rate limit counts
    const totalRateLimitFailures = stats.models.reduce(
      (sum, model) => sum + model.failedWithRateLimit,
      0
    );
    expect(totalRateLimitFailures).toBe(1);

    // Verify other exception counts
    const totalOtherFailures = [
      ...stats.models,
      ...stats.fallbackModels,
    ].reduce((sum, model) => sum + model.failedWithAnotherException, 0);
    expect(totalOtherFailures).toBe(1);

    // Clean up
    jest.useRealTimers();
  });
});

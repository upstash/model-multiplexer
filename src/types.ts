import OpenAI from "openai";

export interface ModelStats {
  client: string;
  model: string;
  callCount: number;
  failedWithRateLimit: number;
  failedWithAnotherException: number;
}

// Configuration for a single model provided by the user
export interface ModelConfig {
  model: OpenAI;
  weight: number;
  // Optional initial state tracking fields
  isRateLimited?: boolean;
  rateLimitedUntil?: number;
}

// Configuration object for the ModelMultiplexer constructor
export interface ModelMultiplexerConfig {
  models: ModelConfig[];
  fallbackModels?: ModelConfig[]; // Optional fallback models used only when all primary models are unavailable
}

// Internal state representation for managed clients within the multiplexer
export interface ManagedClient {
  config: ModelConfig;
  isRateLimited: boolean;
  rateLimitedUntil?: number;
  isFallback: boolean; // Flag to indicate if this is a fallback model
  stats: ModelStats;
}

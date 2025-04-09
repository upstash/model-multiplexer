// Re-export the main class
export { ModelMultiplexer } from "./multiplexer";

// Re-export necessary types for users
export type { ModelConfig, ModelMultiplexerConfig, ModelStats } from "./types";

// Export the main class as the default export for convenience
import { ModelMultiplexer as MultiplexerClass } from "./multiplexer";
export default MultiplexerClass;

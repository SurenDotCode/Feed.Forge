import { registerRoot } from "remotion";
import { FeedForgeVideo } from "./compositions/FeedForgeVideo";

// Re-export for programmatic rendering
export { FeedForgeVideo };

registerRoot(FeedForgeVideo);

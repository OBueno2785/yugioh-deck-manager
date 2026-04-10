const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch all packages in the monorepo
config.watchFolders = [workspaceRoot];

// Resolve modules from workspace root first, then project
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Resolve "source" field (TypeScript source) before "main" (compiled dist)
config.resolver.resolverMainFields = ["react-native", "source", "browser", "main"];

// Enable package exports (needed for @yugioh/core react-native condition)
config.resolver.unstable_enablePackageExports = true;

// Resolve .js imports to .ts files — needed because @yugioh/core uses
// ESM-style ".js" extensions in TypeScript imports (e.g. "./probability.js")
// but the actual files are ".ts". Metro won't find them without this.
const defaultResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to default resolution
    }
  }
  if (defaultResolver) {
    return defaultResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });

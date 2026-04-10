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

// Enable package exports
config.resolver.unstable_enablePackageExports = true;

// Apply NativeWind first, then wrap its resolver
const nativeWindConfig = withNativeWind(config, { input: "./global.css" });

// Resolve .js imports → .ts files for @yugioh/core (uses ESM .js extensions in TS source)
const upstreamResolve = nativeWindConfig.resolver.resolveRequest;
nativeWindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith(".js")) {
    try {
      const stripped = moduleName.slice(0, -3);
      if (upstreamResolve) {
        return upstreamResolve(context, stripped, platform);
      }
      return context.resolveRequest(context, stripped, platform);
    } catch {
      // fall through to original name
    }
  }
  if (upstreamResolve) {
    return upstreamResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = nativeWindConfig;

// electron-builder afterPack hook.
//
// 1. Prunes onnxruntime-node's binaries down to the target platform/arch. The
//    npm package ships every platform (plus a 240 MB CUDA provider on Linux
//    that the app never loads); keeping only bin/napi-v6/<platform>/<arch>
//    saves several hundred MB per artifact.
// 2. Ad-hoc signs macOS builds (runs after the prune so the signature covers
//    the final file set).
//
// CI has no Apple signing certificate, so regular signing is skipped — but
// electron-builder's repackaging invalidates the Electron binaries' original
// signatures. An app with an *invalid* signature is rejected by Gatekeeper on
// Apple silicon as "damaged", with no way to open it. Ad-hoc signing ("-")
// restores a valid signature, which downgrades the failure to the normal
// un-notarized flow ("Apple could not verify…") that users can allow once via
// System Settings → Privacy & Security.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Execution-provider libraries the app never loads (system CUDA/TensorRT). */
const DROP_PROVIDERS = /^libonnxruntime_providers_(cuda|tensorrt)\.so$/;

function pruneOnnxRuntime(context) {
  const platform = context.electronPlatformName; // linux | win32 | darwin
  const arch =
    ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch] ?? "x64";
  const resources =
    platform === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const bin = join(
    resources,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6",
  );
  if (!existsSync(bin)) {
    console.log(
      "[after-pack] onnxruntime-node binaries not found, nothing to prune",
    );
    return;
  }
  for (const p of readdirSync(bin)) {
    if (p !== platform) {
      rmSync(join(bin, p), { recursive: true, force: true });
      console.log(`[after-pack] removed onnxruntime binaries for ${p}`);
      continue;
    }
    for (const a of readdirSync(join(bin, p))) {
      if (a !== arch) {
        rmSync(join(bin, p, a), { recursive: true, force: true });
        console.log(`[after-pack] removed onnxruntime binaries for ${p}/${a}`);
        continue;
      }
      for (const f of readdirSync(join(bin, p, a))) {
        if (DROP_PROVIDERS.test(f)) {
          rmSync(join(bin, p, a, f), { force: true });
          console.log(`[after-pack] removed ${f}`);
        }
      }
    }
  }

  // The arch name above is a guess at electron-builder's enum, and the package
  // does not ship every platform/arch pair (darwin is arm64 only). Getting it
  // wrong deletes the binding the app needs and still exits 0, producing an
  // artifact that only fails once a user runs it — so prove it survived.
  const kept = join(bin, platform, arch);
  if (!existsSync(join(kept, "onnxruntime_binding.node"))) {
    throw new Error(
      `[after-pack] pruning left no onnxruntime binding at ${kept} — ` +
        `check the platform/arch mapping for ${platform}/${context.arch}`,
    );
  }
  console.log(`[after-pack] kept onnxruntime binaries for ${platform}/${arch}`);
}

export default async function afterPack(context) {
  pruneOnnxRuntime(context);
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  // If a real signing certificate is configured, leave signing to electron-builder.
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    return;
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  console.log(`[mac-adhoc-sign] ad-hoc signing: ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  // Verify the signature is now valid (a failure fails the whole build).
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
  console.log(`[mac-adhoc-sign] signature verified`);
}

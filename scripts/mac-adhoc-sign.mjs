// electron-builder afterPack hook: ad-hoc signs macOS builds.
//
// CI has no Apple signing certificate, so regular signing is skipped — but
// electron-builder's repackaging invalidates the Electron binaries' original
// signatures. An app with an *invalid* signature is rejected by Gatekeeper on
// Apple silicon as "damaged", with no way to open it. Ad-hoc signing ("-")
// restores a valid signature, which downgrades the failure to the normal
// un-notarized flow ("Apple could not verify…") that users can allow once via
// System Settings → Privacy & Security.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export default async function afterPack(context) {
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

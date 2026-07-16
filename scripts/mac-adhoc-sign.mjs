// electron-builder の afterPack フック: macOS ビルドを ad-hoc 署名する。
//
// CI には Apple の署名証明書がないため通常の署名はスキップしているが、
// electron-builder がバンドルを組み替えた時点で Electron 本体の署名が
// 無効になる。署名が「無効」なアプリは Apple Silicon の Gatekeeper が
// 「アプリケーションが壊れています」と表示し、起動する手段がない。
// ad-hoc 署名(-)で署名を有効な状態に戻すと、未公証アプリ向けの
// 「開発元を確認できません」フローに変わり、システム設定の
// 「プライバシーとセキュリティ」から許可すれば起動できるようになる。
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  // 本物の署名証明書が設定されている場合は electron-builder の署名に任せる。
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
  // 署名が有効になったことを検証する(失敗すればビルドごと失敗させる)。
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
  console.log(`[mac-adhoc-sign] signature verified`);
}

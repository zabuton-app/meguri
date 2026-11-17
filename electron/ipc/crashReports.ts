// Crash reports kept from earlier runs (#544): listed in Settings → About and
// announced once at the launch that found them.
import { shell } from "electron";
import fs from "node:fs";
import {
  deleteCrashReport,
  listCrashReports,
  toCrashReportDto,
} from "../core/crashReports.js";
import { handle } from "../core/ipcHandler.js";
import type { IpcContext } from "./context.js";

export function registerCrashReportHandlers(ctx: IpcContext): void {
  const { reportsDir, dumpsDir, issueForm, newReportId } = ctx.crashReports;

  handle("crash_reports_list", () =>
    listCrashReports(reportsDir).map((r) =>
      toCrashReportDto(r, issueForm, newReportId),
    ),
  );

  handle("crash_report_delete", ({ id }) => {
    deleteCrashReport(reportsDir, dumpsDir, id);
  });

  // For a maintainer who asks for a dump through a private channel: the dumps
  // are never attached to an issue.
  handle("crash_reports_open_folder", async () => {
    fs.mkdirSync(dumpsDir, { recursive: true });
    const error = await shell.openPath(dumpsDir);
    if (error) throw new Error(error);
  });
}

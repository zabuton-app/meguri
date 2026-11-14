// The window gets the web permissions the app uses and no others (#273).
// Asked through the Permissions API and Notification, which answer from the
// permission handlers alone: the Clipboard API would also fail for a window
// without focus, which parallel workers on one display can take away.
import { test, expect } from "./fixtures/app";

test.describe("Permissions", () => {
  test("grants clipboard write and fullscreen", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const { state } = await navigator.permissions.query({
        name: "clipboard-write" as PermissionName,
      });
      await document.documentElement.requestFullscreen();
      const fullscreen = document.fullscreenElement !== null;
      await document.exitFullscreen();
      return { clipboardWrite: state, fullscreen };
    });
    expect(result).toEqual({ clipboardWrite: "granted", fullscreen: true });
  });

  test("denies what the app does not use", async ({ window }) => {
    const result = await window.evaluate(async () => {
      const state = async (name: string) =>
        (await navigator.permissions.query({ name: name as PermissionName }))
          .state;
      return {
        notificationRequest: await Notification.requestPermission(),
        notifications: await state("notifications"),
        clipboardRead: await state("clipboard-read"),
        microphone: await state("microphone"),
      };
    });
    expect(result).toEqual({
      notificationRequest: "denied",
      notifications: "denied",
      clipboardRead: "denied",
      microphone: "denied",
    });
  });
});

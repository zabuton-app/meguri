// The folder a confirmation excludes, shown where it is on disk (#529).
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { ExcludeFolderDetails } from "@/components/ExcludeFolderDetails";
import { renderWithProviders } from "@/test/renderWithProviders";

const pathText = () =>
  screen.getByText("Folder").nextElementSibling?.textContent;

describe("ExcludeFolderDetails", () => {
  it("shows the folder under the workspace root, its name picked out", () => {
    renderWithProviders(
      <ExcludeFolderDetails root="/media" folder="work/LYD" count={1} />,
    );
    expect(pathText()).toBe("/media/work/LYD");
    expect(screen.getByText("LYD", { selector: "mark" })).toBeTruthy();
    expect(screen.getByText(/The 1 file in it is hidden now\./)).toBeTruthy();
    expect(screen.getByText(/Folders named “LYD” elsewhere/)).toBeTruthy();
  });

  it("writes the path as the root is written, on Windows too", () => {
    renderWithProviders(
      <ExcludeFolderDetails root="D:\media\" folder="work/LYD" count={2} />,
    );
    expect(pathText()).toBe("D:\\media\\work\\LYD");
  });

  it("falls back to the path inside the workspace without the root", () => {
    renderWithProviders(
      <ExcludeFolderDetails root={null} folder="LYD" count={2} />,
    );
    expect(pathText()).toBe("LYD");
  });
});

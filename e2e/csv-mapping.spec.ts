import { expect, test } from "./fixtures";

// Synthetic files only. Accounts are created here and removed at the end, so the shared worker
// user's own account keeps the mapping other specs rely on.

const columns = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Match the columns" });
const select = (page: import("@playwright/test").Page, name: string) => columns(page).getByRole("combobox", { name, exact: true });

async function chooseAccount(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name }).click();
}

async function upload(page: import("@playwright/test").Page, name: string, text: string) {
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf-8") });
}

test("another bank's CSV is read after matching its columns, and the choices come back next time", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const [a] = await sql`insert into accounts (user_id, name) values (${workerUser.id}, ${`E2E Map A ${stamp}`}) returning id`;
  const [c] = await sql`insert into accounts (user_id, name) values (${workerUser.id}, ${`E2E Map C ${stamp}`}) returning id`;
  try {
    const file = (tag: string) =>
      [
        "Compte,123456",
        "Date,Description,Amount",
        `2025-09-30,Rent ${tag},"-1,200.50"`,
        `2025-10-01,Salary ${tag},"2,500.00"`,
        `2025-10-02,Coffee ${tag},-3.20`,
      ].join("\n");

    await page.goto("/import");
    await chooseAccount(page, `E2E Map A ${stamp}`);
    await upload(page, `bank-a-${stamp}.csv`, file(`A${stamp}`));

    // Guessed from the header names: no "remembered" note, every field filled in.
    await expect(columns(page)).toBeVisible();
    await expect(select(page, "Date")).toHaveValue("Date");
    await expect(select(page, "Label")).toHaveValue("Description");
    await expect(select(page, "Amount")).toHaveValue("Amount");
    await expect(select(page, "Dates")).toHaveValue("YYYY-MM-DD");
    await expect(select(page, "Amounts")).toHaveValue(".");
    await expect(columns(page).getByText("Last import's settings")).toHaveCount(0);
    const firstRow = columns(page).getByRole("region", { name: "First row" });
    await expect(firstRow.getByText(/Rent A\d+/)).toBeVisible();
    await expect(firstRow.getByText(/1,200\.50/)).toBeVisible();

    await columns(page).getByRole("button", { name: "Continue" }).click();
    const preview = page.getByRole("region", { name: "Import preview" });
    await expect(preview.getByTestId("import-new-count")).toHaveText("3");
    await page.getByRole("button", { name: "Import 3 transactions" }).click();
    await expect(page.getByRole("region", { name: "Import result" }).getByText("3 imported")).toBeVisible();

    // Same account, same layout: remembered.
    await page.getByRole("button", { name: "Import another file" }).click();
    await chooseAccount(page, `E2E Map A ${stamp}`);
    await upload(page, `bank-a2-${stamp}.csv`, file(`B${stamp}`));
    await expect(columns(page).getByText("Last import's settings")).toBeVisible();
    await expect(select(page, "Label")).toHaveValue("Description");
    await columns(page).getByRole("button", { name: "Cancel" }).click();

    // Another account starts from the latest mapping used anywhere.
    await chooseAccount(page, `E2E Map C ${stamp}`);
    await upload(page, `bank-c-${stamp}.csv`, file(`C${stamp}`));
    await expect(columns(page).getByText("Last import's settings")).toBeVisible();
    await expect(select(page, "Amount")).toHaveValue("Amount");
  } finally {
    await sql`delete from accounts where id in (${a.id}, ${c.id})`;
  }
});

test("a file with unknown headers needs its columns chosen, and a wrong date format is fixed in one tap", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const [b] = await sql`insert into accounts (user_id, name) values (${workerUser.id}, ${`E2E Map B ${stamp}`}) returning id`;
  try {
    await page.goto("/import");
    await chooseAccount(page, `E2E Map B ${stamp}`);
    await upload(page, `bank-b-${stamp}.csv`, `Quand,Quoi,Combien\n30/09/2025,Loyer ${stamp},-12.50\n01/10/2025,Cafe ${stamp},-3.20\n`);

    await expect(columns(page).getByText("New file format")).toBeVisible();
    await expect(select(page, "Date")).toHaveValue("");
    await expect(columns(page).getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(columns(page).getByText("It will show here once date, label and amount are chosen.")).toBeVisible();

    await select(page, "Date").selectOption("Quand");
    await select(page, "Label").selectOption("Quoi");
    await select(page, "Amount").selectOption("Combien");
    await expect(columns(page).getByRole("button", { name: "Continue" })).toBeEnabled();
    await expect(columns(page).getByRole("region", { name: "First row" }).getByText(`Loyer ${stamp}`)).toBeVisible();

    // A wrong format shows what is wrong on the first row and offers the right one.
    await select(page, "Dates").selectOption("YYYY-MM-DD");
    await expect(columns(page).getByText("Unreadable date: “30/09/2025”")).toBeVisible();
    await columns(page).getByRole("button", { name: "Use DD/MM/YYYY" }).click();
    await expect(columns(page).getByRole("region", { name: "First row" }).getByText(`Loyer ${stamp}`)).toBeVisible();

    await columns(page).getByRole("button", { name: "Continue" }).click();
    const preview = page.getByRole("region", { name: "Import preview" });
    await expect(preview.getByTestId("import-new-count")).toHaveText("2");

    // Back to the columns from the preview: the same choices, and Cancel returns to the preview.
    await preview.getByRole("button", { name: "Change columns" }).click();
    await expect(select(page, "Date")).toHaveValue("Quand");
    await columns(page).getByRole("button", { name: "Cancel" }).click();
    await expect(preview.getByTestId("import-new-count")).toHaveText("2");

    await page.getByRole("button", { name: "Import 2 transactions" }).click();
    await expect(page.getByRole("region", { name: "Import result" }).getByText("2 imported")).toBeVisible();
  } finally {
    await sql`delete from accounts where id = ${b.id}`;
  }
});

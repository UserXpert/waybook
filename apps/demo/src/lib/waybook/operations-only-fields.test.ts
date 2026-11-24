import assert from "node:assert/strict";
import test from "node:test";
import { assertNoOperationalFreeText } from "./operations-only-fields";

test("operations-only forms tolerate blank legacy fields and leave operational fields alone", () => {
  const data = new FormData();
  data.append("notes", "  ");
  data.append("method", "bank_transfer");
  assert.doesNotThrow(() => assertNoOperationalFreeText(data, "notes", "internalNotes"));
});

test("operations-only forms reject repeated note values and files without reflecting data", () => {
  const data = new FormData();
  data.append("notes", "");
  data.append("notes", "synthetic client detail");
  const error = { message: "Free-text notes are unavailable. Refresh and use the available operational fields." };
  assert.throws(() => assertNoOperationalFreeText(data, "notes"), error);

  data.delete("notes");
  data.append("notes", new Blob(["synthetic client attachment"]), "notes.txt");
  assert.throws(() => assertNoOperationalFreeText(data, "notes"), error);
});

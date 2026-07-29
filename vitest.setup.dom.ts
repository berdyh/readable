import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom keeps one document for the whole file, so a component left mounted by
// one test is still in the tree for the next one — queries then match the
// previous test's output and pass for the wrong reason.
afterEach(() => {
  cleanup();
});

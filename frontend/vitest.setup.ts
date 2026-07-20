import "@testing-library/jest-dom/vitest";

// `@testing-library/react` 16.3.2 already registers its own beforeAll/afterAll
// act-environment boundary and automatic afterEach cleanup when each React test
// imports the package. Do not duplicate either here: the explicit flag and
// cleanup previously present were harmless but redundant and obscured the real
// warning fixes (correct act/waitFor boundaries plus safe QueryCache-to-React
// scheduling). Console output remains unsuppressed so lifecycle warnings fail
// the verbose review scan visibly.

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/lib", "<rootDir>/db", "<rootDir>/services"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
};

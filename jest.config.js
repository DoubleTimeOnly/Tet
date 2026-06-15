/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/lib", "<rootDir>/db", "<rootDir>/services"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
};

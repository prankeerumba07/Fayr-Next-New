/**
 * Jest configuration for the Fayr backend.
 *
 * Unit specs live next to the code they test (src/**\/*.spec.ts) and run fully
 * in-memory — Prisma and external services are mocked, so `npm test` needs no
 * database and no network. End-to-end specs (added in a later step) will live in
 * a separate `test/` project.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};

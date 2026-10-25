import "dotenv/config";

// Runs in every test worker before any test file is imported. Code under test
// that reaches the app's own client (`@/server/db`, which reads DATABASE_URL)
// without the test mocking it must never land on the development or production
// database: point DATABASE_URL at the guarded test database, or at an address
// that can't connect when there is none. The global setup (main process) still
// sees the real values and refuses a TEST_DATABASE_URL equal to DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://no-database@127.0.0.1:1/refused";

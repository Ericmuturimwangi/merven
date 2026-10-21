import { createAuthClient } from "better-auth/react";

// Sign-in goes through the HTTP handler so Better Auth's rate limiting applies.
export const authClient = createAuthClient();
